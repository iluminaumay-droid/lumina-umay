import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { db, closeDatabase } from '../../src/server/db/database.js';
import { SlotService } from '../../src/server/services/slot.service.js';
import { EmailService } from '../../src/server/services/email.service.js';
import { createApp } from '../../src/server/app.js';
import { config } from '../../src/server/config.js';

describe('Milestone 2 Concurrency, Race Condition & Adversarial Stress Suite', () => {
  const app = createApp();
  const testSecret = 'secret_webhook_test_key_123';

  // Helper to generate legitimate HMAC SHA-256 webhook headers
  function generateValidSignature(paymentId: string, requestId: string = `req_${uuidv4()}`): {
    'x-signature': string;
    'x-request-id': string;
  } {
    const ts = Math.floor(SlotService.getCurrentTime().getTime() / 1000).toString();
    const manifest = `id:${paymentId};request-id:${requestId};ts:${ts};`;
    const hmac = crypto.createHmac('sha256', testSecret).update(manifest).digest('hex');
    return {
      'x-signature': `ts=${ts},v1=${hmac}`,
      'x-request-id': requestId,
    };
  }

  // Helper to seed a slot with specific parameters
  function seedTestSlot(
    slotId: string,
    offsetHours: number = 48,
    status: 'available' | 'locked' | 'booked' = 'available',
    lockToken?: string,
    lockExpiresInMinutes?: number
  ) {
    const startTime = new Date(Date.now() + offsetHours * 3600 * 1000).toISOString();
    const endTime = new Date(Date.now() + offsetHours * 3600 * 1000 + 45 * 60 * 1000).toISOString();
    let lockedAt: string | null = null;
    let lockExpiresAt: string | null = null;

    if (status === 'locked') {
      lockedAt = SlotService.getCurrentIso();
      const expMinutes = lockExpiresInMinutes !== undefined ? lockExpiresInMinutes : 15;
      lockExpiresAt = new Date(SlotService.getCurrentTime().getTime() + expMinutes * 60 * 1000).toISOString();
    }

    db.prepare(`
      INSERT INTO slots (id, start_time, end_time, status, locked_at, lock_expires_at, lock_token)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(slotId, startTime, endTime, status, lockedAt, lockExpiresAt, lockToken || null);
  }

  beforeEach(() => {
    config.mpWebhookSecret = testSecret;
    SlotService.resetVirtualTime();
    EmailService.clearCapturedEmails();
    db.prepare(`DELETE FROM webhook_events`).run();
    db.prepare(`DELETE FROM orders`).run();
    db.prepare(`DELETE FROM slots`).run();
  });

  afterAll(() => {
    SlotService.stopSweeper();
    closeDatabase();
  });

  // =========================================================================
  // 1. RAPID CONCURRENT PREFERENCE CREATIONS ON THE SAME CALL SLOT
  // =========================================================================

  describe('1. Rapid Concurrent Preference Creations on the Same Call Slot', () => {
    it('Adv-M2.1: 100 simultaneous create-preference calls on an unlocked slot yield exactly 1 order lock and 99 HTTP 409s', async () => {
      const slotId = 'm2-adv-pref-slot-1';
      seedTestSlot(slotId, 24, 'available');

      const concurrencyLevel = 100;
      const requests = Array.from({ length: concurrencyLevel }, (_, i) =>
        request(app)
          .post('/api/checkout/create-preference')
          .send({
            tier_id: 'llamada',
            category: 'Amor',
            customer_name: `Contender ${i}`,
            customer_email: `contender${i}@example.com`,
            customer_birthdate: '1990-01-15',
            question: `Consulta concurrente ${i}`,
            slot_id: slotId,
          })
      );

      const responses = await Promise.all(requests);

      const successes = responses.filter((r) => r.status === 200);
      const conflicts = responses.filter((r) => r.status === 409);
      const otherErrors = responses.filter((r) => r.status !== 200 && r.status !== 409);

      expect(otherErrors.length).toBe(0);
      expect(successes.length).toBe(1);
      expect(conflicts.length).toBe(concurrencyLevel - 1);

      // Verify the winning order in DB
      const winningOrderId = successes[0].body.order_id;
      expect(winningOrderId).toBeDefined();

      const ordersInDb = db.prepare(`SELECT * FROM orders WHERE slot_id = ?`).all(slotId) as any[];
      expect(ordersInDb.length).toBe(1);
      expect(ordersInDb[0].id).toBe(winningOrderId);
      expect(ordersInDb[0].amount_mxn).toBe(450);
      expect(ordersInDb[0].status).toBe('pending');

      // Verify slot is locked and lock token matches the order
      const slotInDb = SlotService.getSlotById(slotId);
      expect(slotInDb?.status).toBe('locked');
      expect(slotInDb?.lock_token).toBe(ordersInDb[0].lock_token);
    });

    it('Adv-M2.2: Concurrent checkout on pre-locked slot — legitimate token owner wins, 50 unauthorized attempts rejected', async () => {
      const slotId = 'm2-adv-prelocked-slot';
      seedTestSlot(slotId, 24, 'available');
      const legitLock = SlotService.acquireSoftLock(slotId, 15);
      const legitToken = legitLock.lock_token;

      const attempts = 51;
      const requests = Array.from({ length: attempts }, (_, i) => {
        const isLegit = i === 0;
        return request(app)
          .post('/api/checkout/create-preference')
          .send({
            tier_id: 'llamada',
            category: 'Trabajo/Dinero',
            customer_name: isLegit ? 'Legitimate Owner' : `Attacker ${i}`,
            customer_email: isLegit ? 'owner@example.com' : `attacker${i}@example.com`,
            customer_birthdate: '1992-06-20',
            question: 'Consulta laboral de urgencia',
            slot_id: slotId,
            lock_token: isLegit ? legitToken : `fraudulent-token-${i}`,
          });
      });

      const responses = await Promise.all(requests);

      const successes = responses.filter((r) => r.status === 200);
      const conflicts = responses.filter((r) => r.status === 409);

      expect(successes.length).toBe(1);
      expect(conflicts.length).toBe(50);
      expect(successes[0].body.order_id).toBeDefined();

      // Ensure only 1 order created in DB
      const orders = db.prepare(`SELECT * FROM orders WHERE slot_id = ?`).all(slotId) as any[];
      expect(orders.length).toBe(1);
      expect(orders[0].customer_email).toBe('owner@example.com');
    });

    it('Adv-M2.3: Massive Multi-Slot Preference Grid (10 slots x 15 contenders = 150 requests)', async () => {
      const slotCount = 10;
      const contendersPerSlot = 15;
      const slotIds: string[] = [];

      for (let s = 0; s < slotCount; s++) {
        const sId = `grid-slot-${s}`;
        slotIds.push(sId);
        seedTestSlot(sId, 24 + s, 'available');
      }

      const allRequests: Promise<any>[] = [];
      for (const sId of slotIds) {
        for (let c = 0; c < contendersPerSlot; c++) {
          allRequests.push(
            request(app)
              .post('/api/checkout/create-preference')
              .send({
                tier_id: 'llamada',
                category: 'Familia',
                customer_name: `User ${sId}-${c}`,
                customer_email: `user_${sId}_${c}@example.com`,
                customer_birthdate: '1988-11-11',
                question: `Pregunta para ${sId}`,
                slot_id: sId,
              })
          );
        }
      }

      const responses = await Promise.all(allRequests);

      const successes = responses.filter((r) => r.status === 200);
      const conflicts = responses.filter((r) => r.status === 409);
      if (successes.length !== slotCount) {
        console.log('Adv-M2.3 debug - first 5 responses:', responses.slice(0, 5).map(r => ({ status: r.status, body: r.body })));
      }

      expect(successes.length).toBe(slotCount); // Exactly 10 winners
      expect(conflicts.length).toBe(slotCount * (contendersPerSlot - 1)); // Exactly 140 conflicts

      // Verify DB invariant: exactly 10 orders created, 1 per slot
      const allOrders = db.prepare(`SELECT * FROM orders`).all() as any[];
      expect(allOrders.length).toBe(slotCount);

      for (const sId of slotIds) {
        const slotOrders = allOrders.filter((o) => o.slot_id === sId);
        expect(slotOrders.length).toBe(1);
        expect(slotOrders[0].amount_mxn).toBe(450);

        const dbSlot = SlotService.getSlotById(sId);
        expect(dbSlot?.status).toBe('locked');
      }
    });
  });

  // =========================================================================
  // 2. RACE CONDITIONS: EXPIRATION, COMPETING LOCKS & LATE WEBHOOKS
  // =========================================================================

  describe('2. Race Conditions between Expiration, Competing Locks & Late Webhooks', () => {
    it('Adv-M2.4: Late Webhook Arrival on re-booked slot triggers OVERBOOKED_NEEDS_RESCHEDULING quarantine', async () => {
      const slotId = 'm2-late-webhook-slot';
      seedTestSlot(slotId, 24, 'available');

      // 1. User 1 locks slot and creates preference
      const prefRes1 = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: 'llamada',
          category: 'Amor',
          customer_name: 'Slow User 1',
          customer_email: 'slow1@example.com',
          customer_birthdate: '1990-01-01',
          question: 'Consulta tardía',
          slot_id: slotId,
        });

      const order1Id = prefRes1.body.order_id;
      expect(prefRes1.status).toBe(200);

      // 2. Advance time past 15 min TTL (e.g. 16 minutes / 960 seconds)
      SlotService.advanceTime(960);

      // 3. User 2 discovers open slot, creates preference, pays, and receives approved webhook
      const prefRes2 = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: 'llamada',
          category: 'Amor',
          customer_name: 'Fast User 2',
          customer_email: 'fast2@example.com',
          customer_birthdate: '1992-02-02',
          question: 'Consulta a tiempo',
          slot_id: slotId,
        });

      const order2Id = prefRes2.body.order_id;
      expect(prefRes2.status).toBe(200);

      const pay2Id = 'mp_pay_fast_user2';
      const sig2 = generateValidSignature(pay2Id);

      const webhookRes2 = await request(app)
        .post('/api/webhooks/mercadopago')
        .set(sig2)
        .send({
          type: 'payment',
          data: {
            id: pay2Id,
            external_reference: order2Id,
            status: 'approved',
            transaction_amount: 450,
          },
        });

      expect(webhookRes2.status).toBe(200);

      // Slot is now permanently BOOKED for User 2
      const slotAfterUser2 = SlotService.getSlotById(slotId);
      expect(slotAfterUser2?.status).toBe('booked');

      const order2InDb = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(order2Id) as any;
      expect(order2InDb.status).toBe('APPROVED');

      // 4. Late Webhook for User 1 arrives with approved payment
      const pay1Id = 'mp_pay_slow_user1_late';
      const sig1 = generateValidSignature(pay1Id);

      const webhookRes1 = await request(app)
        .post('/api/webhooks/mercadopago')
        .set(sig1)
        .send({
          type: 'payment',
          data: {
            id: pay1Id,
            external_reference: order1Id,
            status: 'approved',
            transaction_amount: 450,
          },
        });

      expect(webhookRes1.status).toBe(200);
      expect(webhookRes1.body.status).toBe('OVERBOOKED_NEEDS_RESCHEDULING');

      // 5. Verify User 1 order is quarantined, User 2 order remains APPROVED, slot remains BOOKED
      const order1InDb = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(order1Id) as any;
      expect(order1InDb.status).toBe('OVERBOOKED_NEEDS_RESCHEDULING');

      const slotFinal = SlotService.getSlotById(slotId);
      expect(slotFinal?.status).toBe('booked');

      // 6. Verify order status query returns appropriate Mexican Spanish rescheduling message
      const statusCheck1 = await request(app).get(`/api/orders/${order1Id}/status`);
      expect(statusCheck1.status).toBe(200);
      expect(statusCheck1.body.status).toBe('OVERBOOKED_NEEDS_RESCHEDULING');
      expect(statusCheck1.body.turnaround_message).toContain('reprogramar');
    });

    it('Adv-M2.5: Dead-heat simultaneous webhooks for two expired-hold orders on the same slot', async () => {
      const slotId = 'm2-dead-heat-slot';
      seedTestSlot(slotId, 24, 'available');

      // Order A created
      const prefA = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: 'llamada',
          category: 'Otro',
          customer_name: 'User A',
          customer_email: 'userA@example.com',
          customer_birthdate: '1985-05-05',
          question: 'Pregunta A',
          slot_id: slotId,
        });
      const orderAId = prefA.body.order_id;

      // Expire hold
      SlotService.advanceTime(1000);

      // Order B created
      const prefB = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: 'llamada',
          category: 'Otro',
          customer_name: 'User B',
          customer_email: 'userB@example.com',
          customer_birthdate: '1986-06-06',
          question: 'Pregunta B',
          slot_id: slotId,
        });
      const orderBId = prefB.body.order_id;

      // Both users completed payment at MP and both webhooks fire simultaneously
      const payA = 'mp_pay_dead_heat_A';
      const payB = 'mp_pay_dead_heat_B';
      const sigA = generateValidSignature(payA);
      const sigB = generateValidSignature(payB);

      const [resA, resB] = await Promise.all([
        request(app)
          .post('/api/webhooks/mercadopago')
          .set(sigA)
          .send({
            type: 'payment',
            data: { id: payA, external_reference: orderAId, status: 'approved', transaction_amount: 450 },
          }),
        request(app)
          .post('/api/webhooks/mercadopago')
          .set(sigB)
          .send({
            type: 'payment',
            data: { id: payB, external_reference: orderBId, status: 'approved', transaction_amount: 450 },
          }),
      ]);

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);

      const orderA = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderAId) as any;
      const orderB = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderBId) as any;

      const statuses = [orderA.status, orderB.status];
      expect(statuses).toContain('APPROVED');
      expect(statuses).toContain('OVERBOOKED_NEEDS_RESCHEDULING');

      // Slot must be booked and not corrupted
      const slot = SlotService.getSlotById(slotId);
      expect(slot?.status).toBe('booked');
    });

    it('Adv-M2.6: Webhook payment rejection immediately unlocks slot for 50 concurrent waiting contenders', async () => {
      const slotId = 'm2-recover-slot';
      seedTestSlot(slotId, 24, 'available');

      // User 1 creates preference
      const pref1 = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: 'llamada',
          category: 'Amor',
          customer_name: 'Failing User 1',
          customer_email: 'fail1@example.com',
          customer_birthdate: '1991-03-10',
          question: 'Consulta que será rechazada',
          slot_id: slotId,
        });
      const order1Id = pref1.body.order_id;

      // Payment is rejected
      const payRejectId = 'mp_pay_rejected_999';
      const sigReject = generateValidSignature(payRejectId);

      const rejectRes = await request(app)
        .post('/api/webhooks/mercadopago')
        .set(sigReject)
        .send({
          type: 'payment',
          data: {
            id: payRejectId,
            external_reference: order1Id,
            status: 'rejected',
          },
        });

      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.status).toBe('REJECTED');

      // Slot should be immediately available
      const slotAfterReject = SlotService.getSlotById(slotId);
      expect(slotAfterReject?.status).toBe('available');
      expect(slotAfterReject?.lock_token).toBeNull();

      // 50 contenders race to lock the recovered slot
      const contenders = 50;
      const raceRequests = Array.from({ length: contenders }, (_, i) =>
        request(app)
          .post('/api/checkout/create-preference')
          .send({
            tier_id: 'llamada',
            category: 'Trabajo/Dinero',
            customer_name: `Recover Contender ${i}`,
            customer_email: `rec${i}@example.com`,
            customer_birthdate: '1993-04-04',
            question: 'Aprovechar horario liberado',
            slot_id: slotId,
          })
      );

      const raceResponses = await Promise.all(raceRequests);
      const winners = raceResponses.filter((r) => r.status === 200);
      const conflicts = raceResponses.filter((r) => r.status === 409);

      expect(winners.length).toBe(1);
      expect(conflicts.length).toBe(contenders - 1);
    });
  });

  // =========================================================================
  // 3. RACE CONDITIONS: SIMULTANEOUS DUPLICATE WEBHOOK CALLS (IDENTICAL PAYMENT ID)
  // =========================================================================

  describe('3. Simultaneous Duplicate Webhook Calls (Identical mp_payment_id)', () => {
    it('Adv-M2.7: 100 simultaneous duplicate approved webhooks execute idempotently and trigger emails exactly once', async () => {
      // Create a 5_cartas order
      const prefRes = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: '5_cartas',
          category: 'Trabajo/Dinero',
          customer_name: 'Fernanda Castillo',
          customer_email: 'fernanda@example.com',
          customer_birthdate: '1987-12-05',
          question: '¿Cómo evolucionará mi nuevo negocio?',
          core_focus: 'Saber si la inversión dará frutos este año',
        });

      const orderId = prefRes.body.order_id;
      expect(prefRes.status).toBe(200);

      const paymentId = 'mp_pay_concurrency_100_dupes';
      const sig = generateValidSignature(paymentId);

      const duplicatesCount = 100;
      const duplicateRequests = Array.from({ length: duplicatesCount }, () =>
        request(app)
          .post('/api/webhooks/mercadopago')
          .set(sig)
          .send({
            type: 'payment',
            data: {
              id: paymentId,
              external_reference: orderId,
              status: 'approved',
              transaction_amount: 500,
            },
          })
      );

      const responses = await Promise.all(duplicateRequests);

      // All 100 requests must return HTTP 200 OK
      const status200s = responses.filter((r) => r.status === 200);
      expect(status200s.length).toBe(duplicatesCount);

      // Verify order status is APPROVED in DB
      const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as any;
      expect(order.status).toBe('APPROVED');
      expect(order.mp_payment_id).toBe(paymentId);
      expect(order.email_sent).toBe(1);
      expect(order.customer_email_sent).toBe(1);

      // Exactly 1 webhook event recorded in SQLite
      const events = db.prepare(`SELECT * FROM webhook_events WHERE mp_payment_id = ?`).all(paymentId);
      expect(events.length).toBe(1);
      expect((events[0] as any).status).toBe('processed');

      // Exactly 2 emails captured: 1 to Claudia + 1 to Customer
      const capturedEmails = EmailService.getCapturedEmails();
      expect(capturedEmails.length).toBe(2);

      const claudiaMail = capturedEmails.find((m) => m.to.includes('claudia') || m.subject.includes('Nueva Consulta'));
      const customerMail = capturedEmails.find((m) => m.to.includes('fernanda@example.com'));

      expect(claudiaMail).toBeDefined();
      expect(customerMail).toBeDefined();
    });

    it('Adv-M2.8: 50 duplicate webhooks interleaved with 50 simultaneous order status polling requests', async () => {
      const prefRes = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: '1_carta',
          category: 'Amor',
          customer_name: 'Mauricio Ochmann',
          customer_email: 'mauricio@example.com',
          customer_birthdate: '1977-11-16',
          question: '¿Debo tomar esa decisión sentimental?',
        });

      const orderId = prefRes.body.order_id;
      const paymentId = 'mp_pay_interleaved_50';
      const sig = generateValidSignature(paymentId);

      const operations: Promise<any>[] = [];

      // 50 duplicate webhooks
      for (let i = 0; i < 50; i++) {
        operations.push(
          request(app)
            .post('/api/webhooks/mercadopago')
            .set(sig)
            .send({
              type: 'payment',
              data: {
                id: paymentId,
                external_reference: orderId,
                status: 'approved',
                transaction_amount: 150,
              },
            })
        );
      }

      // 50 concurrent status polls
      for (let i = 0; i < 50; i++) {
        operations.push(request(app).get(`/api/orders/${orderId}/status`));
      }

      const results = await Promise.all(operations);

      // All 100 requests must succeed with HTTP 200
      expect(results.every((r) => r.status === 200)).toBe(true);

      // Verify order is APPROVED
      const finalOrder = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as any;
      expect(finalOrder.status).toBe('APPROVED');

      // Verify webhook events table has exactly 1 entry
      const events = db.prepare(`SELECT * FROM webhook_events WHERE mp_payment_id = ?`).all(paymentId);
      expect(events.length).toBe(1);

      // Verify emails sent exactly once (2 emails)
      expect(EmailService.getCapturedEmails().length).toBe(2);
    });

    it('Adv-M2.9: 50 simultaneous duplicate rejection webhooks execute safely and release slot without side effects', async () => {
      const slotId = 'm2-dupe-reject-slot';
      seedTestSlot(slotId, 24, 'available');

      const prefRes = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: 'llamada',
          category: 'Familia',
          customer_name: 'Reject Customer',
          customer_email: 'reject@example.com',
          customer_birthdate: '1984-02-14',
          question: 'Consulta familiar rechazada',
          slot_id: slotId,
        });

      const orderId = prefRes.body.order_id;
      const paymentId = 'mp_pay_dupe_rejection_1';
      const sig = generateValidSignature(paymentId);

      const requests = Array.from({ length: 50 }, () =>
        request(app)
          .post('/api/webhooks/mercadopago')
          .set(sig)
          .send({
            type: 'payment',
            data: {
              id: paymentId,
              external_reference: orderId,
              status: 'rejected',
            },
          })
      );

      const responses = await Promise.all(requests);
      expect(responses.every((r) => r.status === 200)).toBe(true);

      const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as any;
      expect(order.status).toBe('REJECTED');

      const slot = SlotService.getSlotById(slotId);
      expect(slot?.status).toBe('available');
      expect(slot?.lock_token).toBeNull();

      // No notification emails should have been sent
      expect(EmailService.getCapturedEmails().length).toBe(0);
    });
  });

  // =========================================================================
  // 4. DATABASE LOCKS, TRANSACTIONS & SYSTEM INTEGRITY UNDER CHAOS LOAD
  // =========================================================================

  describe('4. Database Locks, Transactions & System Integrity under Chaos Load', () => {
    it('Adv-M2.10: 120 Mixed Concurrent Chaos Operations execute with ACID consistency and 0 double-bookings', async () => {
      // Seed 5 slots
      const testSlots = ['chaos-slot-1', 'chaos-slot-2', 'chaos-slot-3', 'chaos-slot-4', 'chaos-slot-5'];
      testSlots.forEach((sId, idx) => seedTestSlot(sId, 24 + idx, 'available'));

      // Pre-create 10 orders across tiers
      const preOrders: { id: string; tier: string; slotId?: string }[] = [];
      const tiers = ['1_carta', '3_cartas', '5_cartas', 'llamada'];

      for (let i = 0; i < 10; i++) {
        const tier = tiers[i % tiers.length];
        const sId = tier === 'llamada' ? testSlots[i % testSlots.length] : undefined;
        const res = await request(app)
          .post('/api/checkout/create-preference')
          .send({
            tier_id: tier,
            category: 'Amor',
            customer_name: `Pre User ${i}`,
            customer_email: `pre${i}@example.com`,
            customer_birthdate: '1990-01-01',
            question: `Pregunta inicial ${i}`,
            core_focus: tier === '5_cartas' ? 'Foco profundo' : undefined,
            slot_id: sId,
          });

        if (res.status === 200) {
          preOrders.push({ id: res.body.order_id, tier, slotId: sId });
        }
      }

      expect(preOrders.length).toBeGreaterThan(0);

      // Dispatch 120 simultaneous mixed operations
      const mixedOps: Promise<any>[] = [];

      // Op Type 1: 30 new preference creations (random async tiers & calls)
      for (let i = 0; i < 30; i++) {
        const tier = tiers[i % tiers.length];
        const sId = tier === 'llamada' ? testSlots[i % testSlots.length] : undefined;
        mixedOps.push(
          request(app)
            .post('/api/checkout/create-preference')
            .send({
              tier_id: tier,
              category: 'Trabajo/Dinero',
              customer_name: `Chaos User ${i}`,
              customer_email: `chaos${i}@example.com`,
              customer_birthdate: '1989-09-09',
              question: `Chaos question ${i}`,
              core_focus: tier === '5_cartas' ? 'Foco de prueba' : undefined,
              slot_id: sId,
            })
        );
      }

      // Op Type 2: 30 webhooks for pre-created orders (approved/rejected)
      for (let i = 0; i < 30; i++) {
        const targetOrder = preOrders[i % preOrders.length];
        const payId = `mp_pay_chaos_${i}_${targetOrder.id}`;
        const isApproved = i % 4 !== 0; // 75% approved, 25% rejected
        const sig = generateValidSignature(payId);

        mixedOps.push(
          request(app)
            .post('/api/webhooks/mercadopago')
            .set(sig)
            .send({
              type: 'payment',
              data: {
                id: payId,
                external_reference: targetOrder.id,
                status: isApproved ? 'approved' : 'rejected',
                transaction_amount: 350,
              },
            })
        );
      }

      // Op Type 3: 30 status polls on random order IDs
      for (let i = 0; i < 30; i++) {
        const targetOrder = preOrders[i % preOrders.length];
        mixedOps.push(request(app).get(`/api/orders/${targetOrder.id}/status`));
      }

      // Op Type 4: 30 slot queries and lock attempts
      for (let i = 0; i < 30; i++) {
        const sId = testSlots[i % testSlots.length];
        if (i % 2 === 0) {
          mixedOps.push(request(app).get('/api/slots'));
        } else {
          mixedOps.push(request(app).post(`/api/slots/${sId}/lock`));
        }
      }

      const results = await Promise.all(mixedOps);
      expect(results.length).toBe(120);

      // Verify no 500 server crashes occurred
      const serverCrashes = results.filter((r) => r.status >= 500);
      expect(serverCrashes.length).toBe(0);

      // Strict Data Integrity Verification:
      // 1. Double Booking Check: No slot may be booked by multiple orders
      const doubleBookings = db
        .prepare(
          `SELECT slot_id, count(*) as booked_count
           FROM orders
           WHERE status IN ('APPROVED', 'paid', 'approved') AND slot_id IS NOT NULL
           GROUP BY slot_id
           HAVING count(*) > 1`
        )
        .all();

      expect(doubleBookings.length).toBe(0);

      // 2. Pricing Invariant Check: All orders in DB must have positive prices matching spec
      const orders = db.prepare(`SELECT tier_id, amount_mxn FROM orders`).all() as any[];
      const validPrices: Record<string, number> = {
        '1_carta': 150,
        '3_cartas': 350,
        '5_cartas': 500,
        'llamada': 450,
        'call_session': 450,
      };

      orders.forEach((o) => {
        expect(validPrices[o.tier_id]).toBe(o.amount_mxn);
      });
    });

    it('Adv-M2.11: Adversarial Webhook Attack Storm (Tampered Signatures, Replay Timestamps & SQL Injections)', async () => {
      // Create a pending order
      const prefRes = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: '1_carta',
          category: 'Amor',
          customer_name: 'Target Customer',
          customer_email: 'target@example.com',
          customer_birthdate: '1990-01-01',
          question: 'Consulta protegida',
        });
      const targetOrderId = prefRes.body.order_id;
      expect(prefRes.status).toBe(200);

      const attacks = [
        // Tampered signature hash
        {
          headers: { 'x-signature': 'ts=1700000000,v1=deadbeef1234567890abcdef' },
          payload: { type: 'payment', data: { id: 'attack_1', external_reference: targetOrderId, status: 'approved' } },
          expectedStatus: 401,
        },
        // Replay attack: timestamp 20 minutes in the past
        {
          headers: (() => {
            const oldTs = (Math.floor(Date.now() / 1000) - 1200).toString();
            const manifest = `id:attack_2;request-id:req_replay;ts:${oldTs};`;
            const hmac = crypto.createHmac('sha256', testSecret).update(manifest).digest('hex');
            return { 'x-signature': `ts=${oldTs},v1=${hmac}`, 'x-request-id': 'req_replay' };
          })(),
          payload: { type: 'payment', data: { id: 'attack_2', external_reference: targetOrderId, status: 'approved' } },
          expectedStatus: 401,
        },
        // SQL Injection in external_reference
        {
          headers: generateValidSignature('attack_3'),
          payload: {
            type: 'payment',
            data: {
              id: 'attack_3',
              external_reference: `${targetOrderId}' OR '1'='1`,
              status: 'approved',
            },
          },
          expectedStatus: 200, // Handled safely as unlinked order
        },
        // SQL Injection in payment ID with invalid signature
        {
          headers: { 'x-signature': 'invalid_signature_test' },
          payload: {
            type: 'payment',
            data: {
              id: `pay_fake'; DROP TABLE orders; --`,
              external_reference: targetOrderId,
              status: 'approved',
            },
          },
          expectedStatus: 401,
        },
      ];

      for (const attack of attacks) {
        const res = await request(app)
          .post('/api/webhooks/mercadopago')
          .set(attack.headers)
          .send(attack.payload);

        expect(res.status).toBe(attack.expectedStatus);
      }

      // Target order must still be pending and uncorrupted
      const targetOrderInDb = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(targetOrderId) as any;
      expect(targetOrderInDb.status).toBe('pending');
      expect(targetOrderInDb.email_sent).toBe(0);

      // Ensure orders table is intact
      const count = (db.prepare(`SELECT count(*) as cnt FROM orders`).get() as any).cnt;
      expect(count).toBeGreaterThan(0);
    });

    it('Adv-M2.12: Anti-Spoofing Proof — Direct status polling or client URL spoofing cannot confirm payment', async () => {
      // Create preference
      const prefRes = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: '3_cartas',
          category: 'Amor',
          customer_name: 'Spoof Attacker',
          customer_email: 'attacker@example.com',
          customer_birthdate: '1995-05-05',
          question: 'Intento de spoofing',
        });

      expect(prefRes.status).toBe(200);
      const orderId = prefRes.body.order_id;
      expect(orderId).toBeDefined();

      // 1. Client simulates returning from Mercado Pago success URL: /checkout/success?order_id=...
      // The client status endpoint is polled 20 times
      for (let i = 0; i < 20; i++) {
        const statusRes = await request(app).get(`/api/orders/${orderId}/status`);
        expect(statusRes.status).toBe(200);
        expect(statusRes.body.status).toBe('PENDING'); // MUST remain PENDING
      }

      // 2. Ensure database has NOT changed status to paid/approved
      const orderInDb = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as any;
      expect(orderInDb.status).toBe('pending');
      expect(orderInDb.email_sent).toBe(0);
      expect(EmailService.getCapturedEmails().length).toBe(0);
    });
  });
});
