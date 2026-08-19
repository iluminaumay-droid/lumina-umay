import { Router, Request, Response, NextFunction } from 'express';
import { db } from '../db/database.js';
import { MercadoPagoService } from '../services/mercadopago.service.js';
import { SlotService } from '../services/slot.service.js';
import { EmailService } from '../services/email.service.js';
import { syncOrderToSupabase, syncSlotToSupabase, syncWebhookToSupabase } from '../db/supabase.js';
import { Order } from '../types/checkout.types.js';

export const webhookRouter = Router();

function parseUtcToCdmx(utcIso: string): { date: string; time_start: string; time_end: string } {
  const utcDate = new Date(utcIso);
  const cdmxDate = new Date(utcDate.getTime() - 6 * 60 * 60 * 1000);
  const date = cdmxDate.toISOString().slice(0, 10);
  const hours = String(cdmxDate.getUTCHours()).padStart(2, '0');
  const minutes = String(cdmxDate.getUTCMinutes()).padStart(2, '0');

  const endDate = new Date(utcDate.getTime() + 45 * 60 * 1000 - 6 * 60 * 60 * 1000);
  const endHours = String(endDate.getUTCHours()).padStart(2, '0');
  const endMinutes = String(endDate.getUTCMinutes()).padStart(2, '0');

  return {
    date,
    time_start: `${hours}:${minutes}`,
    time_end: `${endHours}:${endMinutes}`,
  };
}

/**
 * POST /api/webhooks/mercadopago
 * Verifies HMAC SHA-256 signature, enforces idempotency, checks payment status,
 * updates order/slot state machine, and triggers email notifications.
 */
webhookRouter.post('/mercadopago', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const signatureHeader = req.headers['x-signature'] as string | undefined;
    const requestIdHeader = req.headers['x-request-id'] as string | undefined;
    const body = req.body || {};

    const paymentId =
      body?.data?.id ||
      body?.id ||
      (req.query['data.id'] as string) ||
      (req.query.id as string) ||
      `mp_pay_${Date.now()}`;

    const eventType = body?.action || body?.type || (req.query.topic as string) || 'payment';

    // 1. HMAC SHA-256 Signature Verification
    const sigResult = MercadoPagoService.verifySignature(
      signatureHeader,
      requestIdHeader,
      String(paymentId)
    );

    if (!sigResult.isValid) {
      return res.status(401).json({
        success: false,
        error: 'Firma de webhook no válida',
        details: sigResult.reason,
      });
    }

    // 2. Fast-Path Webhook Idempotency Pre-Check (Deduplication)
    const existingEvent = db
      .prepare(
        `SELECT id, status FROM webhook_events WHERE (id = ? OR mp_payment_id = ?) AND status = 'processed'`
      )
      .get(`evt_${paymentId}`, String(paymentId));

    if (existingEvent) {
      return res.status(200).json({
        success: true,
        message: 'Webhook ya procesado (idempotente)',
      });
    }

    // 3. Fetch authoritative payment status
    const payment = await MercadoPagoService.fetchPaymentDetails(String(paymentId), body);
    const orderId =
      payment.external_reference ||
      body?.data?.external_reference ||
      body?.external_reference ||
      body?.order_id;

    const nowIso = SlotService.getCurrentIso();

    if (!orderId) {
      // Record unlinked notification in webhook_events safely with INSERT OR IGNORE
      db.prepare(`
        INSERT OR IGNORE INTO webhook_events (id, mp_payment_id, event_type, payload, signature, status, processed_at)
        VALUES (?, ?, ?, ?, ?, 'ignored', ?)
      `).run(
        `evt_${paymentId}`,
        String(paymentId),
        eventType,
        JSON.stringify(body),
        signatureHeader || null,
        nowIso
      );

      return res.status(200).json({
        success: true,
        message: 'Notificación recibida sin orden vinculada',
      });
    }

    // 4. ATOMIC DATABASE TRANSACTION (BEGIN IMMEDIATE via db.transaction)
    const processResult = db.transaction(() => {
      // 4a. In-Transaction Idempotency Guard (handles concurrent duplicates resolving after fetchPaymentDetails)
      const inTxEvent = db
        .prepare(
          `SELECT id, status FROM webhook_events WHERE (id = ? OR mp_payment_id = ?) AND status = 'processed'`
        )
        .get(`evt_${paymentId}`, String(paymentId));

      if (inTxEvent) {
        return {
          isDuplicate: true,
          orderNotFound: false,
          orderId,
          finalStatus: 'PROCESSED',
          slotDetails: null,
          orderForEmail: null,
          shouldSendEmail: false,
        };
      }

      // 4b. Fetch Order
      const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as Order | undefined;
      if (!order) {
        db.prepare(`
          INSERT OR IGNORE INTO webhook_events (id, mp_payment_id, event_type, payload, signature, status, processed_at)
          VALUES (?, ?, ?, ?, ?, 'ignored', ?)
        `).run(
          `evt_${paymentId}`,
          String(paymentId),
          eventType,
          JSON.stringify(body),
          signatureHeader || null,
          nowIso
        );

        return {
          isDuplicate: false,
          orderNotFound: true,
          orderId,
          finalStatus: 'UNKNOWN',
          slotDetails: null,
          orderForEmail: null,
          shouldSendEmail: false,
        };
      }

      // 4c. Check if Order was already marked final by a previous concurrent transaction
      const orderStatusUpper = order.status.toUpperCase();
      if (['APPROVED', 'PAID', 'REJECTED', 'CANCELLED', 'OVERBOOKED_NEEDS_RESCHEDULING'].includes(orderStatusUpper)) {
        db.prepare(`
          INSERT OR IGNORE INTO webhook_events (id, mp_payment_id, event_type, payload, signature, status, processed_at)
          VALUES (?, ?, ?, ?, ?, 'processed', ?)
        `).run(
          `evt_${paymentId}`,
          String(paymentId),
          eventType,
          JSON.stringify(body),
          signatureHeader || null,
          nowIso
        );

        return {
          isDuplicate: true,
          orderNotFound: false,
          orderId: order.id,
          finalStatus: orderStatusUpper,
          slotDetails: null,
          orderForEmail: null,
          shouldSendEmail: false,
        };
      }

      let finalOrderStatus = orderStatusUpper;
      let slotDetails: { date: string; time_start: string; time_end: string } | null = null;
      let shouldSendEmail = false;

      // 4d. Payment Approved State Transition
      if (payment.status === 'approved') {
        finalOrderStatus = 'APPROVED';

        if (order.slot_id) {
          const slot = db.prepare(`SELECT * FROM slots WHERE id = ?`).get(order.slot_id) as any;
          if (slot) {
            slotDetails = parseUtcToCdmx(slot.start_time);

            // Check if another order has already booked/approved this slot
            const competingOrder = db
              .prepare(
                `SELECT id FROM orders WHERE slot_id = ? AND status IN ('APPROVED', 'paid', 'approved') AND id != ?`
              )
              .get(order.slot_id, order.id);

            if (competingOrder) {
              finalOrderStatus = 'OVERBOOKED_NEEDS_RESCHEDULING';
            } else {
              // Attempt atomic slot booking update
              const confirmStmt = db.prepare(`
                UPDATE slots
                SET status = 'booked',
                    locked_at = NULL,
                    lock_expires_at = NULL,
                    lock_token = NULL,
                    updated_at = ?
                WHERE id = ?
                  AND (
                    (status IN ('locked', 'SOFT_LOCKED') AND lock_token = ?)
                    OR status IN ('available', 'AVAILABLE')
                    OR (status IN ('locked', 'SOFT_LOCKED') AND lock_expires_at <= ?)
                  )
              `);

              const confirmResult = confirmStmt.run(
                nowIso,
                order.slot_id,
                order.lock_token || '',
                nowIso
              );

              if (confirmResult.changes === 0) {
                finalOrderStatus = 'OVERBOOKED_NEEDS_RESCHEDULING';
              }
            }
          }
        }

        db.prepare(`
          UPDATE orders
          SET status = ?,
              mp_payment_id = ?,
              updated_at = ?
          WHERE id = ?
        `).run(finalOrderStatus, String(paymentId), nowIso, order.id);

        db.prepare(`
          INSERT OR IGNORE INTO webhook_events (id, mp_payment_id, event_type, payload, signature, status, processed_at)
          VALUES (?, ?, ?, ?, ?, 'processed', ?)
        `).run(
          `evt_${paymentId}`,
          String(paymentId),
          eventType,
          JSON.stringify(body),
          signatureHeader || null,
          nowIso
        );

        shouldSendEmail = true;

      // 4e. Payment Rejected / Cancelled State Transition
      } else if (payment.status === 'rejected' || payment.status === 'cancelled') {
        finalOrderStatus = payment.status === 'rejected' ? 'REJECTED' : 'CANCELLED';

        if (order.slot_id && order.lock_token) {
          db.prepare(`
            UPDATE slots
            SET status = 'available',
                locked_at = NULL,
                lock_expires_at = NULL,
                lock_token = NULL,
                updated_at = ?
            WHERE id = ?
              AND status IN ('locked', 'SOFT_LOCKED')
              AND lock_token = ?
          `).run(nowIso, order.slot_id, order.lock_token);
        }

        db.prepare(`
          UPDATE orders
          SET status = ?,
              mp_payment_id = ?,
              updated_at = ?
          WHERE id = ?
        `).run(finalOrderStatus, String(paymentId), nowIso, order.id);

        db.prepare(`
          INSERT OR IGNORE INTO webhook_events (id, mp_payment_id, event_type, payload, signature, status, processed_at)
          VALUES (?, ?, ?, ?, ?, 'processed', ?)
        `).run(
          `evt_${paymentId}`,
          String(paymentId),
          eventType,
          JSON.stringify(body),
          signatureHeader || null,
          nowIso
        );
      }

      return {
        isDuplicate: false,
        orderNotFound: false,
        orderId: order.id,
        finalStatus: finalOrderStatus,
        slotDetails,
        orderForEmail: {
          ...order,
          status: finalOrderStatus,
          mp_payment_id: String(paymentId),
        },
        shouldSendEmail,
      };
    })();

    // 5. Post-Transaction Response & Email Dispatching
    if (processResult.isDuplicate) {
      return res.status(200).json({
        success: true,
        message: 'Webhook ya procesado (idempotente)',
        order_id: processResult.orderId,
        status: processResult.finalStatus,
      });
    }

    if (processResult.orderNotFound) {
      return res.status(200).json({
        success: true,
        message: 'Notificación recibida sin orden vinculada',
      });
    }

    if (processResult.shouldSendEmail && processResult.orderForEmail) {
      try {
        await EmailService.sendOrderNotificationToClaudia(
          processResult.orderForEmail,
          processResult.slotDetails
        );
        await EmailService.sendConfirmationToCustomer(
          processResult.orderForEmail,
          processResult.slotDetails
        );

        db.prepare(`
          UPDATE orders
          SET email_sent = 1,
              customer_email_sent = 1,
              updated_at = ?
          WHERE id = ?
        `).run(SlotService.getCurrentIso(), processResult.orderForEmail.id);
      } catch (emailError) {
        console.error('[Webhook] Error sending notification emails:', emailError);
      }
    }

    // Sync final state to Supabase in background
    if (processResult.orderForEmail) {
      syncOrderToSupabase(processResult.orderForEmail).catch(() => {});
      if (processResult.orderForEmail.slot_id) {
        const updatedSlot = db.prepare(`SELECT * FROM slots WHERE id = ?`).get(processResult.orderForEmail.slot_id) as any;
        if (updatedSlot) {
          syncSlotToSupabase(updatedSlot).catch(() => {});
        }
      }
    }
    syncWebhookToSupabase({
      id: `evt_${paymentId}`,
      mp_payment_id: String(paymentId),
      event_type: eventType,
      payload: body,
      signature: signatureHeader || null,
      status: processResult.orderNotFound ? 'ignored' : 'processed',
      processed_at: nowIso,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      order_id: processResult.orderId,
      status: processResult.finalStatus,
    });
  } catch (error) {
    return next(error);
  }
});
