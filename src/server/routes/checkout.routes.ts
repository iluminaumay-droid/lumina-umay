import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/database.js';
import { createPreferenceSchema } from '../validators/checkout.validator.js';
import { MercadoPagoService } from '../services/mercadopago.service.js';
import { SlotService } from '../services/slot.service.js';
import { syncOrderToSupabase } from '../db/supabase.js';
import { Order, TIER_CONFIG } from '../types/checkout.types.js';

export const checkoutRouter = Router();
export const ordersRouter = Router();

function parseUtcToCdmx(utcIso: string): { date: string; time_start: string } {
  const utcDate = new Date(utcIso);
  const cdmxDate = new Date(utcDate.getTime() - 6 * 60 * 60 * 1000);
  const date = cdmxDate.toISOString().slice(0, 10);
  const hours = String(cdmxDate.getUTCHours()).padStart(2, '0');
  const minutes = String(cdmxDate.getUTCMinutes()).padStart(2, '0');
  return {
    date,
    time_start: `${hours}:${minutes}`,
  };
}

/**
 * POST /api/checkout/create-preference
 * Validates inputs, handles slot lock verification for calls, stores pending order, and creates MP preference.
 */
checkoutRouter.post('/create-preference', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validatedData = createPreferenceSchema.parse(req.body);

    const rawTierId = validatedData.tier_id;
    const tierId = rawTierId === 'call_session' ? 'llamada' : rawTierId;
    const tierInfo = TIER_CONFIG[tierId] || TIER_CONFIG['1_carta'];
    const enforcedAmount = tierInfo.price;

    let finalSlotId: string | null = null;
    let finalLockToken: string | null = null;

    // Slot Concurrency & Soft-Lock Management for Call Sessions
    if (tierId === 'llamada') {
      const slotId = validatedData.slot_id!;
      const slot = SlotService.getSlotById(slotId);

      if (!slot) {
        return res.status(404).json({
          success: false,
          error: 'El horario seleccionado no fue encontrado. Por favor elige otro horario.',
        });
      }

      const slotStatus = slot.status.toUpperCase();
      if (slotStatus === 'BOOKED') {
        return res.status(409).json({
          success: false,
          error: 'Este horario ya ha sido confirmado y reservado permanentemente. Por favor elige otro horario.',
        });
      }

      const nowIso = SlotService.getCurrentIso();

      if (slotStatus === 'LOCKED' || slotStatus === 'SOFT_LOCKED') {
        if (slot.lock_expires_at && slot.lock_expires_at <= nowIso) {
          // Lock expired -> Re-claim atomic soft lock
          const newLock = SlotService.acquireSoftLock(slotId, 15);
          finalLockToken = newLock.lock_token;
        } else if (validatedData.lock_token && validatedData.lock_token.trim() === slot.lock_token) {
          // Valid ongoing lock held by this user
          finalLockToken = slot.lock_token;
        } else {
          // Locked by another user
          return res.status(409).json({
            success: false,
            error: 'El horario seleccionado ya fue apartado por otra persona. Por favor elige otro horario.',
          });
        }
      } else {
        // Slot is available -> Acquire soft lock
        const newLock = SlotService.acquireSoftLock(slotId, 15);
        finalLockToken = newLock.lock_token;
      }

      finalSlotId = slotId;
    }

    const orderId = `ord_${Date.now()}_${uuidv4().replace(/-/g, '').slice(0, 8)}`;
    const nowIso = SlotService.getCurrentIso();

    const newOrder: Order = {
      id: orderId,
      tier_id: tierId,
      category: validatedData.category,
      amount_mxn: enforcedAmount,
      customer_name: validatedData.customer_name.trim(),
      customer_email: validatedData.customer_email.trim(),
      customer_phone: validatedData.customer_phone?.trim() || null,
      customer_birthdate: validatedData.customer_birthdate.trim(),
      question: validatedData.question.trim(),
      involved_names: validatedData.involved_names?.trim() || null,
      core_focus: validatedData.core_focus?.trim() || null,
      slot_id: finalSlotId,
      lock_token: finalLockToken,
      mp_preference_id: null,
      mp_payment_id: null,
      status: 'pending',
      email_sent: 0,
      customer_email_sent: 0,
      notes: null,
      created_at: nowIso,
      updated_at: nowIso,
    };

    // Insert order in DB
    db.prepare(`
      INSERT INTO orders (
        id, tier_id, category, amount_mxn, customer_name, customer_email,
        customer_phone, customer_birthdate, question, involved_names,
        core_focus, slot_id, lock_token, status, email_sent, customer_email_sent,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 0, ?, ?)
    `).run(
      newOrder.id,
      newOrder.tier_id,
      newOrder.category,
      newOrder.amount_mxn,
      newOrder.customer_name,
      newOrder.customer_email,
      newOrder.customer_phone,
      newOrder.customer_birthdate,
      newOrder.question,
      newOrder.involved_names,
      newOrder.core_focus,
      newOrder.slot_id,
      newOrder.lock_token,
      newOrder.created_at,
      newOrder.updated_at
    );

    // Create MP Preference
    const protocol = req.protocol || 'http';
    const host = req.get('host') || `localhost:${req.app.get('port') || 3000}`;
    const baseUrl = `${protocol}://${host}`;

    const prefResult = await MercadoPagoService.createPreference(newOrder, baseUrl);

    // Update order with preference ID
    db.prepare(`
      UPDATE orders
      SET mp_preference_id = ?, updated_at = ?
      WHERE id = ?
    `).run(prefResult.id, SlotService.getCurrentIso(), newOrder.id);

    newOrder.mp_preference_id = prefResult.id;
    syncOrderToSupabase(newOrder).catch(() => {});

    return res.status(200).json({
      success: true,
      order_id: newOrder.id,
      preference_id: prefResult.id,
      init_point: prefResult.init_point,
      sandbox_init_point: prefResult.sandbox_init_point,
      amount: enforcedAmount,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * Helper to fetch and format order status response.
 */
function handleGetOrderStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const orderId = req.params.order_id || req.params.id;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        error: 'Identificador de pedido requerido',
      });
    }

    const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as Order | undefined;

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Pedido no encontrado',
      });
    }

    const tierInfo = TIER_CONFIG[order.tier_id] || {
      name: 'Lectura de Cartas',
      price: order.amount_mxn,
      isCall: false,
    };

    let turnaroundMessage = 'Responderemos en un plazo máximo de 24 horas a tu correo electrónico con tu lectura.';
    let slotData: any = null;

    const normalizedStatus = order.status.toUpperCase();

    if (order.tier_id === 'llamada' || order.tier_id === 'call_session') {
      if (order.slot_id) {
        const slot = SlotService.getSlotById(order.slot_id);
        if (slot) {
          const startCdmx = parseUtcToCdmx(slot.start_time);
          const endCdmx = parseUtcToCdmx(slot.end_time);

          slotData = {
            id: slot.id,
            date: startCdmx.date,
            time_start: startCdmx.time_start,
            time_end: endCdmx.time_start,
            status: slot.status.toUpperCase(),
          };

          if (normalizedStatus === 'OVERBOOKED_NEEDS_RESCHEDULING') {
            turnaroundMessage =
              'Tu pago fue recibido pero el horario seleccionado expiró y fue reservado por otro consultante. Claudia se pondrá en contacto contigo para reprogramar tu sesión.';
          } else {
            turnaroundMessage = `Sesión agendada para el ${startCdmx.date} de ${startCdmx.time_start} - ${endCdmx.time_start} hrs.`;
          }
        } else {
          turnaroundMessage = 'Sesión por llamada agendada.';
        }
      } else {
        turnaroundMessage = 'Sesión por llamada agendada.';
      }
    }

    return res.status(200).json({
      success: true,
      order_id: order.id,
      status: normalizedStatus,
      tier_id: order.tier_id,
      tier_name: tierInfo.name,
      turnaround_message: turnaroundMessage,
      slot: slotData,
      amount: order.amount_mxn,
    });
  } catch (error) {
    return next(error);
  }
}

// Mount order status on checkoutRouter and ordersRouter
checkoutRouter.get('/:order_id/status', handleGetOrderStatus);
ordersRouter.get('/:order_id/status', handleGetOrderStatus);
