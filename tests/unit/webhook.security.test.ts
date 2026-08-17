import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { db, closeDatabase } from '../../src/server/db/database.js';
import { SlotService } from '../../src/server/services/slot.service.js';
import { MercadoPagoService } from '../../src/server/services/mercadopago.service.js';
import { EmailService } from '../../src/server/services/email.service.js';
import { createApp } from '../../src/server/app.js';
import { config } from '../../src/server/config.js';

describe('Webhook Security & Idempotency Unit Tests', () => {
  const app = createApp();
  const testSlotId = 'webhook-test-slot-100';

  beforeEach(() => {
    SlotService.resetVirtualTime();
    EmailService.clearCapturedEmails();
    db.prepare(`DELETE FROM webhook_events`).run();
    db.prepare(`DELETE FROM orders`).run();
    db.prepare(`DELETE FROM slots`).run();

    const futureStart = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const futureEnd = new Date(Date.now() + 48 * 60 * 60 * 1000 + 45 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO slots (id, start_time, end_time, status)
      VALUES (?, ?, ?, 'available')
    `).run(testSlotId, futureStart, futureEnd);
  });

  afterAll(() => {
    SlotService.stopSweeper();
    closeDatabase();
  });

  describe('1. HMAC SHA-256 Signature Verification', () => {
    const testSecret = 'secret_webhook_test_key_123';

    it('successfully validates a legitimate HMAC SHA-256 signature', () => {
      const dataId = '1234567890';
      const requestId = 'req_test_uuid_abc';
      const ts = Math.floor(Date.now() / 1000).toString();

      const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
      const hmac = crypto.createHmac('sha256', testSecret).update(manifest).digest('hex');
      const signatureHeader = `ts=${ts},v1=${hmac}`;

      const check = MercadoPagoService.verifySignature(signatureHeader, requestId, dataId, testSecret);
      expect(check.isValid).toBe(true);
    });

    it('rejects tampered signature hash', () => {
      const dataId = '1234567890';
      const requestId = 'req_test_uuid_abc';
      const ts = Math.floor(Date.now() / 1000).toString();
      const tamperedHmac = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const signatureHeader = `ts=${ts},v1=${tamperedHmac}`;

      const check = MercadoPagoService.verifySignature(signatureHeader, requestId, dataId, testSecret);
      expect(check.isValid).toBe(false);
      expect(check.reason).toContain('mismatch');
    });

    it('rejects timestamp outside 5-minute tolerance window (replay attack protection)', () => {
      const dataId = '1234567890';
      const requestId = 'req_test_uuid_abc';
      const expiredTs = (Math.floor(Date.now() / 1000) - 600).toString(); // 10 minutes ago

      const manifest = `id:${dataId};request-id:${requestId};ts:${expiredTs};`;
      const hmac = crypto.createHmac('sha256', testSecret).update(manifest).digest('hex');
      const signatureHeader = `ts=${expiredTs},v1=${hmac}`;

      const check = MercadoPagoService.verifySignature(signatureHeader, requestId, dataId, testSecret);
      expect(check.isValid).toBe(false);
      expect(check.reason).toContain('tolerance window');
    });

    it('HTTP API: rejects tampered signature with HTTP 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/webhooks/mercadopago')
        .set('x-signature', 'invalid_signature_test_tampered')
        .send({
          type: 'payment',
          data: { id: 'mp_pay_fake_001', status: 'approved' },
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Firma de webhook no válida');
    });
  });

  describe('2. Webhook Idempotency & Deduplication', () => {
    it('handles 5 duplicate approved webhooks safely and sends emails exactly once', async () => {
      const prefRes = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: '3_cartas',
          category: 'Amor',
          customer_name: 'Camila Sodi',
          customer_email: 'camila.sodi@example.com',
          customer_birthdate: '1993-07-20',
          question: '¿Qué depara el destino amoroso?',
        });

      const orderId = prefRes.body.order_id;
      const paymentId = 'mp_pay_unit_idempotency_1';

      // Send 5 duplicate webhooks
      for (let i = 0; i < 5; i++) {
        const webhookRes = await request(app)
          .post('/api/webhooks/mercadopago')
          .send({
            type: 'payment',
            data: {
              id: paymentId,
              external_reference: orderId,
              status: 'approved',
              transaction_amount: 350,
            },
          });

        expect(webhookRes.status).toBe(200);
        expect(webhookRes.body.success).toBe(true);
      }

      // Check database
      const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as any;
      expect(order.status).toBe('APPROVED');
      expect(order.email_sent).toBe(1);

      const events = db.prepare(`SELECT * FROM webhook_events WHERE mp_payment_id = ?`).all(paymentId);
      expect(events.length).toBe(1);

      // Check captured emails (1 to Claudia + 1 to Customer = 2)
      const emails = EmailService.getCapturedEmails();
      expect(emails.length).toBe(2);
    });
  });

  describe('3. Slot Lifecycle Transitions on Webhook Notifications', () => {
    it('approved payment transitions slot to BOOKED', async () => {
      const lockRes = SlotService.acquireSoftLock(testSlotId, 15);

      const prefRes = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: 'llamada',
          category: 'Trabajo/Dinero',
          customer_name: 'Gabriel Soto',
          customer_email: 'gabriel.soto@example.com',
          customer_birthdate: '1987-04-17',
          question: 'Consulta laboral',
          slot_id: testSlotId,
          lock_token: lockRes.lock_token,
        });

      const orderId = prefRes.body.order_id;

      const webhookRes = await request(app)
        .post('/api/webhooks/mercadopago')
        .send({
          type: 'payment',
          data: {
            id: 'mp_pay_call_approved_1',
            external_reference: orderId,
            status: 'approved',
          },
        });

      expect(webhookRes.status).toBe(200);

      const slot = SlotService.getSlotById(testSlotId);
      expect(slot?.status).toBe('booked');
      expect(slot?.lock_expires_at).toBeNull();

      const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as any;
      expect(order.status).toBe('APPROVED');
    });

    it('rejected payment releases slot back to AVAILABLE', async () => {
      const lockRes = SlotService.acquireSoftLock(testSlotId, 15);

      const prefRes = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: 'llamada',
          category: 'Familia',
          customer_name: 'Lucero Hogaza',
          customer_email: 'lucero@example.com',
          customer_birthdate: '1980-08-29',
          question: 'Consulta familiar',
          slot_id: testSlotId,
          lock_token: lockRes.lock_token,
        });

      const orderId = prefRes.body.order_id;

      const webhookRes = await request(app)
        .post('/api/webhooks/mercadopago')
        .send({
          type: 'payment',
          data: {
            id: 'mp_pay_call_rejected_1',
            external_reference: orderId,
            status: 'rejected',
          },
        });

      expect(webhookRes.status).toBe(200);

      const slot = SlotService.getSlotById(testSlotId);
      expect(slot?.status).toBe('available');
      expect(slot?.lock_token).toBeNull();

      const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as any;
      expect(order.status).toBe('REJECTED');
    });
  });

  describe('4. Late Payment Overbooking Defense', () => {
    it('marks order as OVERBOOKED_NEEDS_RESCHEDULING when slot hold expired and was booked by another user', async () => {
      // User 1 locks slot and creates preference
      const lock1 = SlotService.acquireSoftLock(testSlotId, 15);
      const pref1 = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: 'llamada',
          category: 'Amor',
          customer_name: 'Late Customer 1',
          customer_email: 'late1@example.com',
          customer_birthdate: '1990-01-01',
          question: 'Consulta tardía',
          slot_id: testSlotId,
          lock_token: lock1.lock_token,
        });
      const order1Id = pref1.body.order_id;

      // 16 minutes pass (lock expires)
      SlotService.advanceTime(960);

      // User 2 acquires slot and completes payment
      const lock2 = SlotService.acquireSoftLock(testSlotId, 15);
      const pref2 = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: 'llamada',
          category: 'Amor',
          customer_name: 'Prompt Customer 2',
          customer_email: 'prompt2@example.com',
          customer_birthdate: '1992-02-02',
          question: 'Consulta puntual',
          slot_id: testSlotId,
          lock_token: lock2.lock_token,
        });
      const order2Id = pref2.body.order_id;

      // User 2 webhook arrives -> APPROVED
      await request(app)
        .post('/api/webhooks/mercadopago')
        .send({
          type: 'payment',
          data: {
            id: 'mp_pay_user2_success',
            external_reference: order2Id,
            status: 'approved',
          },
        });

      // User 1 late webhook arrives -> Overbooked defense triggered
      const lateRes = await request(app)
        .post('/api/webhooks/mercadopago')
        .send({
          type: 'payment',
          data: {
            id: 'mp_pay_user1_late',
            external_reference: order1Id,
            status: 'approved',
          },
        });

      expect(lateRes.status).toBe(200);

      const order1 = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(order1Id) as any;
      expect(order1.status).toBe('OVERBOOKED_NEEDS_RESCHEDULING');

      const order2 = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(order2Id) as any;
      expect(order2.status).toBe('APPROVED');

      const statusRes1 = await request(app).get(`/api/orders/${order1Id}/status`);
      expect(statusRes1.body.status).toBe('OVERBOOKED_NEEDS_RESCHEDULING');
      expect(statusRes1.body.turnaround_message).toContain('reprogramar');
    });
  });
});
