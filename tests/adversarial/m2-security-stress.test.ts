import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { db, closeDatabase } from '../../src/server/db/database.js';
import { SlotService } from '../../src/server/services/slot.service.js';
import { MercadoPagoService } from '../../src/server/services/mercadopago.service.js';
import { EmailService } from '../../src/server/services/email.service.js';
import { createApp } from '../../src/server/app.js';
import { config } from '../../src/server/config.js';
import { isValidBirthdate } from '../../src/server/validators/checkout.validator.js';

describe('Milestone 2 Adversarial Stress Test Suite: Webhook Security, Replay Defense & Input Hardening', () => {
  const app = createApp();
  const testSecret = 'adv_secret_key_m2_998877665544332211';

  // Helper to create uniquely isolated slot
  function createTestSlot(idPrefix: string = 'adv-m2-slot'): { id: string; startTime: string; endTime: string } {
    const id = `${idPrefix}-${uuidv4().replace(/-/g, '').slice(0, 10)}`;
    const startTime = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const endTime = new Date(Date.now() + 48 * 60 * 60 * 1000 + 45 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO slots (id, start_time, end_time, status)
      VALUES (?, ?, ?, 'available')
    `).run(id, startTime, endTime);

    return { id, startTime, endTime };
  }

  // Helper to compute valid signature
  function generateSignature(dataId: string, requestId: string, ts: number | string, secret: string = testSecret): string {
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const hmac = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
    return `ts=${ts},v1=${hmac}`;
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
    config.mpWebhookSecret = '';
    SlotService.stopSweeper();
  });

  // =========================================================================
  // 1. TAMPERED X-SIGNATURE HEADERS & CRYPTOGRAPHIC STRESS
  // =========================================================================
  describe('1. Tampered x-signature Headers & Cryptographic Stress', () => {
    it('Sec-1.1: Accepts valid HMAC SHA-256 signature and rejects single-bit flipped v1 hash', () => {
      const dataId = 'pay_998877';
      const requestId = 'req_crypto_001';
      const ts = Math.floor(Date.now() / 1000);

      // Legitimate signature
      const validSig = generateSignature(dataId, requestId, ts, testSecret);
      const validCheck = MercadoPagoService.verifySignature(validSig, requestId, dataId, testSecret);
      expect(validCheck.isValid).toBe(true);

      // Tampered v1: replace first char of v1 hash
      const parts = validSig.split(',');
      const validHash = parts[1].replace('v1=', '');
      const tamperedChar = validHash[0] === 'a' ? 'b' : 'a';
      const tamperedHash = tamperedChar + validHash.slice(1);
      const tamperedSig = `ts=${ts},v1=${tamperedHash}`;

      const tamperedCheck = MercadoPagoService.verifySignature(tamperedSig, requestId, dataId, testSecret);
      expect(tamperedCheck.isValid).toBe(false);
      expect(tamperedCheck.reason).toContain('mismatch');
    });

    it('Sec-1.2: Rejects signature generated with incorrect secret key', () => {
      const dataId = 'pay_wrong_key';
      const requestId = 'req_crypto_002';
      const ts = Math.floor(Date.now() / 1000);

      const attackerSecret = 'attacker_forged_secret_key_666';
      const forgedSig = generateSignature(dataId, requestId, ts, attackerSecret);

      const check = MercadoPagoService.verifySignature(forgedSig, requestId, dataId, testSecret);
      expect(check.isValid).toBe(false);
      expect(check.reason).toContain('mismatch');
    });

    it('Sec-1.3: Rejects modified timestamp (even by 1s) when hash is fixed', () => {
      const dataId = 'pay_tamper_ts';
      const requestId = 'req_crypto_003';
      const ts = Math.floor(Date.now() / 1000);

      const validSig = generateSignature(dataId, requestId, ts, testSecret);
      const parts = validSig.split(',');
      const v1 = parts[1]; // original v1 computed with original ts

      // Modify ts by 1 second without updating hash
      const alteredSig = `ts=${ts + 1},${v1}`;

      const check = MercadoPagoService.verifySignature(alteredSig, requestId, dataId, testSecret);
      expect(check.isValid).toBe(false);
      expect(check.reason).toContain('mismatch');
    });

    it('Sec-1.4: Rejects non-numeric or malformed timestamps in x-signature', () => {
      const dataId = 'pay_malformed_ts';
      const requestId = 'req_crypto_004';

      const invalidTimestamps = ['abc', 'NaN', 'Infinity', '-Infinity', '12345.678', 'undefined', 'null', ''];

      for (const badTs of invalidTimestamps) {
        const sig = `ts=${badTs},v1=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`;
        const check = MercadoPagoService.verifySignature(sig, requestId, dataId, testSecret);
        expect(check.isValid).toBe(false);
      }
    });

    it('Sec-1.5: Rejects truncated, extended, or malformed v1 hash lengths without throwing exceptions', () => {
      const dataId = 'pay_bad_length';
      const requestId = 'req_crypto_005';
      const ts = Math.floor(Date.now() / 1000);

      const badHashes = [
        '',
        'abc',
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85', // 63 chars (1 short)
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85500', // 66 chars
        'Z'.repeat(64), // non-hex
      ];

      for (const badHash of badHashes) {
        const sig = `ts=${ts},v1=${badHash}`;
        const check = MercadoPagoService.verifySignature(sig, requestId, dataId, testSecret);
        expect(check.isValid).toBe(false);
      }
    });

    it('Sec-1.6: Rejects missing, empty, or whitespace-only headers when secret is configured', () => {
      const dataId = 'pay_missing_header';
      const requestId = 'req_crypto_006';

      const missingChecks = [
        MercadoPagoService.verifySignature(undefined, requestId, dataId, testSecret),
        MercadoPagoService.verifySignature('', requestId, dataId, testSecret),
        MercadoPagoService.verifySignature('   ', requestId, dataId, testSecret),
        MercadoPagoService.verifySignature('ts=123', requestId, dataId, testSecret),
        MercadoPagoService.verifySignature('v1=123', requestId, dataId, testSecret),
      ];

      for (const c of missingChecks) {
        expect(c.isValid).toBe(false);
      }
    });

    it('Sec-1.7: HTTP API: Returns 401 Unauthorized on webhook request with forged signature header', async () => {
      const forgedSig = `ts=${Math.floor(Date.now() / 1000)},v1=0000000000000000000000000000000000000000000000000000000000000000`;

      const res = await request(app)
        .post('/api/webhooks/mercadopago')
        .set('x-signature', forgedSig)
        .set('x-request-id', 'req_forged_http')
        .send({
          type: 'payment',
          data: { id: 'mp_pay_forged_attack', status: 'approved' },
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Firma de webhook no válida');
    });
  });

  // =========================================================================
  // 2. REPLAY ATTACK DEFENSE & IDEMPOTENCY
  // =========================================================================
  describe('2. Replay Attack Defense & 300s Window Tolerance', () => {
    it('Sec-2.1: Rejects valid HMAC signature with timestamp 301 seconds in the past (> 300s tolerance)', () => {
      const dataId = 'pay_replay_past';
      const requestId = 'req_replay_001';
      const staleTs = Math.floor(Date.now() / 1000) - 301; // 301s ago

      const signature = generateSignature(dataId, requestId, staleTs, testSecret);
      const check = MercadoPagoService.verifySignature(signature, requestId, dataId, testSecret);

      expect(check.isValid).toBe(false);
      expect(check.reason).toContain('tolerance window');
    });

    it('Sec-2.2: Rejects valid HMAC signature with timestamp 301 seconds in the future (> 300s tolerance)', () => {
      const dataId = 'pay_replay_future';
      const requestId = 'req_replay_002';
      const futureTs = Math.floor(Date.now() / 1000) + 301; // 301s in future

      const signature = generateSignature(dataId, requestId, futureTs, testSecret);
      const check = MercadoPagoService.verifySignature(signature, requestId, dataId, testSecret);

      expect(check.isValid).toBe(false);
      expect(check.reason).toContain('tolerance window');
    });

    it('Sec-2.3: Accepts valid HMAC signature within 300s window (e.g. 290 seconds in the past)', () => {
      const dataId = 'pay_valid_window';
      const requestId = 'req_replay_003';
      const withinToleranceTs = Math.floor(Date.now() / 1000) - 290; // 290s ago (< 300s)

      const signature = generateSignature(dataId, requestId, withinToleranceTs, testSecret);
      const check = MercadoPagoService.verifySignature(signature, requestId, dataId, testSecret);

      expect(check.isValid).toBe(true);
    });

    it('Sec-2.4: Sequential duplicate approved webhooks process idempotently and trigger emails exactly once', async () => {
      // 1. Create a legitimate order
      const prefRes = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: '1_carta',
          category: 'Amor',
          customer_name: 'Valeria Diaz',
          customer_email: 'valeria@example.com',
          customer_birthdate: '1995-03-15',
          question: '¿Encontraré el amor este año?',
        });

      expect(prefRes.status).toBe(200);
      const orderId = prefRes.body.order_id;
      const paymentId = 'mp_pay_seq_replay_10';
      const requestId = 'req_seq_replay_001';
      const ts = Math.floor(Date.now() / 1000);
      const sig = generateSignature(paymentId, requestId, ts, testSecret);

      // 2. Dispatch 5 duplicate webhooks in sequence
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post('/api/webhooks/mercadopago')
          .set('x-signature', sig)
          .set('x-request-id', requestId)
          .send({
            type: 'payment',
            data: {
              id: paymentId,
              external_reference: orderId,
              status: 'approved',
              transaction_amount: 150,
            },
          });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      }

      // Exactly 1 webhook event record created
      const events = db.prepare(`SELECT * FROM webhook_events WHERE mp_payment_id = ?`).all(paymentId);
      expect(events.length).toBe(1);

      // Order status updated to APPROVED
      const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as any;
      expect(order.status).toBe('APPROVED');
      expect(order.email_sent).toBe(1);
      expect(order.customer_email_sent).toBe(1);

      // Emails sent exactly once (1 Claudia + 1 Customer = 2)
      const capturedEmails = EmailService.getCapturedEmails();
      expect(capturedEmails.length).toBe(2);
    });
  });

  // =========================================================================
  // 3. PRICE INJECTION TAMPERING ATTEMPTS
  // =========================================================================
  describe('3. Price Injection Tampering Defense', () => {
    const maliciousPricePayloads = [
      { tier_id: '1_carta', price: 1, amount: 1, expected: 150 },
      { tier_id: '1_carta', price: 0, amount: 0, expected: 150 },
      { tier_id: '1_carta', price: -100, amount: -100, expected: 150 },
      { tier_id: '3_cartas', price: 0.01, amount: 0.01, expected: 350 },
      { tier_id: '3_cartas', custom_price: 10, unit_price: 10, expected: 350 },
      { tier_id: '5_cartas', amount: 1, core_focus: 'Claridad laboral', expected: 500 },
      { tier_id: '5_cartas', amount: -500, core_focus: 'Futuro', expected: 500 },
      { tier_id: 'llamada', price: 1, amount: 1, isCall: true, expected: 450 },
      { tier_id: 'llamada', price: 0, amount: 0, isCall: true, expected: 450 },
    ];

    maliciousPricePayloads.forEach((tc, idx) => {
      it(`Sec-3.${idx + 1}: Enforces server price $${tc.expected} MXN for tier '${tc.tier_id}' against client injection`, async () => {
        let slotId: string | undefined;
        let lockToken: string | undefined;

        if (tc.isCall) {
          const slot = createTestSlot('slot-price-test');
          slotId = slot.id;
          const lock = SlotService.acquireSoftLock(slotId, 15);
          lockToken = lock.lock_token;
        }

        const res = await request(app)
          .post('/api/checkout/create-preference')
          .send({
            tier_id: tc.tier_id,
            category: 'Trabajo/Dinero',
            customer_name: 'Attacker Price Manipulator',
            customer_email: 'attacker@evil.com',
            customer_birthdate: '1990-05-10',
            question: 'Consulta para verificar manipulación de precio',
            core_focus: tc.core_focus,
            slot_id: slotId,
            lock_token: lockToken,
            amount: tc.amount,
            price: tc.price,
            custom_price: (tc as any).custom_price,
            unit_price: (tc as any).unit_price,
          });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.amount).toBe(tc.expected);

        // Verify SQLite database stores strictly the server-enforced amount
        const orderInDb = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(res.body.order_id) as any;
        expect(orderInDb).toBeDefined();
        expect(orderInDb.amount_mxn).toBe(tc.expected);
      });
    });
  });

  // =========================================================================
  // 4. CATEGORY & BIRTHDATE INJECTION ATTEMPTS
  // =========================================================================
  describe('4. Category & Birthdate Injection Defense', () => {
    describe('4.1 Category Field Hardening', () => {
      const maliciousCategories = [
        `' OR '1'='1`,
        `Amor'; DROP TABLE orders; --`,
        `' UNION SELECT * FROM orders --`,
        `<script>alert("xss")</script>`,
        `NonExistentCategory`,
        `Tarot`,
        `love`,
        `work`,
        `AMOR`, // Case sensitive check
        `Amor `, // Trailing space check
        `1`,
        `true`,
      ];

      maliciousCategories.forEach((badCategory, idx) => {
        it(`Sec-4.1.${idx + 1}: Rejects invalid or SQLi category '${badCategory}' with HTTP 400`, async () => {
          const res = await request(app)
            .post('/api/checkout/create-preference')
            .send({
              tier_id: '1_carta',
              category: badCategory,
              customer_name: 'Injection Tester',
              customer_email: 'sqli@test.com',
              customer_birthdate: '1992-06-15',
              question: 'Test de inyección en categoría',
            });

          expect(res.status).toBe(400);
          expect(res.body.success).toBe(false);
          expect(res.body.error).toContain('categoría válida');
        });
      });
    });

    describe('4.2 Gregorian Birthdate Hardening & Injection Defense', () => {
      it('Sec-4.2.1: Validates Gregorian calendar boundaries and leap years accurately', () => {
        // Valid historical birthdates
        expect(isValidBirthdate('1990-01-01')).toBe(true);
        expect(isValidBirthdate('2000-02-29')).toBe(true); // 2000 is leap year
        expect(isValidBirthdate('2024-02-29')).toBe(true); // 2024 is leap year
        expect(isValidBirthdate('1985-12-31')).toBe(true);
        expect(isValidBirthdate('1900-01-01')).toBe(true);

        // Non-existent calendar dates
        expect(isValidBirthdate('2023-02-29')).toBe(false); // 2023 is NOT leap year
        expect(isValidBirthdate('2023-02-30')).toBe(false); // Feb 30 never exists
        expect(isValidBirthdate('2023-02-31')).toBe(false);
        expect(isValidBirthdate('2023-04-31')).toBe(false); // April has 30 days
        expect(isValidBirthdate('2023-06-31')).toBe(false); // June has 30 days
        expect(isValidBirthdate('2023-09-31')).toBe(false); // September has 30 days
        expect(isValidBirthdate('2023-11-31')).toBe(false); // November has 30 days
        expect(isValidBirthdate('1900-02-29')).toBe(false); // 1900 is NOT a leap year (divisible by 100 but not 400)

        // Out-of-bounds month/day
        expect(isValidBirthdate('1990-00-15')).toBe(false);
        expect(isValidBirthdate('1990-13-15')).toBe(false);
        expect(isValidBirthdate('1990-05-00')).toBe(false);
        expect(isValidBirthdate('1990-05-32')).toBe(false);

        // Future dates
        expect(isValidBirthdate('2050-01-01')).toBe(false);
        expect(isValidBirthdate('2099-12-31')).toBe(false);

        // Pre-1900 dates
        expect(isValidBirthdate('1899-12-31')).toBe(false);
        expect(isValidBirthdate('1800-05-20')).toBe(false);

        // Malformed strings & SQL Injection
        expect(isValidBirthdate('1990/01/01')).toBe(false);
        expect(isValidBirthdate('01-01-1990')).toBe(false);
        expect(isValidBirthdate('1990-1-1')).toBe(false);
        expect(isValidBirthdate('1990-01-01; DROP TABLE orders;')).toBe(false);
        expect(isValidBirthdate('1990-01-01\' OR \'1\'=\'1')).toBe(false);
        expect(isValidBirthdate('')).toBe(false);
        expect(isValidBirthdate('today')).toBe(false);
        expect(isValidBirthdate(null as any)).toBe(false);
        expect(isValidBirthdate(undefined as any)).toBe(false);
      });

      it('Sec-4.2.2: HTTP API: Rejects non-existent date (2023-02-30) with HTTP 400', async () => {
        const res = await request(app)
          .post('/api/checkout/create-preference')
          .send({
            tier_id: '1_carta',
            category: 'Familia',
            customer_name: 'Maria Gomez',
            customer_email: 'maria@example.com',
            customer_birthdate: '2023-02-30',
            question: 'Consulta familiar',
          });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toContain('fecha de nacimiento válida');
      });

      it('Sec-4.2.3: HTTP API: Rejects future birthdate (2050-01-01) with HTTP 400', async () => {
        const res = await request(app)
          .post('/api/checkout/create-preference')
          .send({
            tier_id: '1_carta',
            category: 'Amor',
            customer_name: 'Time Traveler',
            customer_email: 'future@example.com',
            customer_birthdate: '2050-01-01',
            question: 'Consulta futura',
          });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toContain('fecha de nacimiento válida');
      });

      it('Sec-4.2.4: HTTP API: Rejects SQL injection payload in birthdate with HTTP 400', async () => {
        const res = await request(app)
          .post('/api/checkout/create-preference')
          .send({
            tier_id: '1_carta',
            category: 'Otro',
            customer_name: 'SQLi Attacker',
            customer_email: 'sqli@example.com',
            customer_birthdate: "1990-01-01' OR 1=1 --",
            question: 'Consulta SQLi',
          });

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toContain('fecha de nacimiento válida');
      });
    });
  });

  // =========================================================================
  // 5. ANTI-SPOOFING & ORDER STATUS ATTACKS
  // =========================================================================
  describe('5. Anti-Spoofing Attacks & Status Polling Isolation', () => {
    it('Sec-5.1: Status polling on fabricated or SQLi order IDs returns HTTP 404', async () => {
      const fabricatedIds = [
        'ord_fake_nonexistent_12345',
        '00000000-0000-0000-0000-000000000000',
        "' OR '1'='1",
        "ord_123'; DROP TABLE orders; --",
        'null',
        'undefined',
      ];

      for (const fakeId of fabricatedIds) {
        const resOrders = await request(app).get(`/api/orders/${encodeURIComponent(fakeId)}/status`);
        expect(resOrders.status).toBe(404);
        expect(resOrders.body.success).toBe(false);
        expect(resOrders.body.error).toContain('no encontrado');

        const resCheckout = await request(app).get(`/api/checkout/${encodeURIComponent(fakeId)}/status`);
        expect(resCheckout.status).toBe(404);
        expect(resCheckout.body.success).toBe(false);
        expect(resCheckout.body.error).toContain('no encontrado');
      }
    });

    it('Sec-5.2: 50 sequential status polling requests never elevate PENDING order to APPROVED or BOOKED', async () => {
      const slot = createTestSlot('slot-spoof-test');
      const lockRes = SlotService.acquireSoftLock(slot.id, 15);

      const prefRes = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: 'llamada',
          category: 'Trabajo/Dinero',
          customer_name: 'Polling Spoofer',
          customer_email: 'spoofer@test.com',
          customer_birthdate: '1988-11-20',
          question: 'Consulta sobre spoofing',
          slot_id: slot.id,
          lock_token: lockRes.lock_token,
        });

      expect(prefRes.status).toBe(200);
      const orderId = prefRes.body.order_id;
      expect(orderId).toBeDefined();

      // Fire 50 sequential polling requests attempting to spoof status
      for (let i = 0; i < 50; i++) {
        const res = await request(app).get(`/api/orders/${orderId}/status`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.status).toBe('PENDING');
      }

      // Verify order in database is strictly PENDING and no emails dispatched
      const orderInDb = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as any;
      expect(orderInDb.status).toBe('pending');
      expect(orderInDb.email_sent).toBe(0);
      expect(orderInDb.customer_email_sent).toBe(0);
      expect(EmailService.getCapturedEmails().length).toBe(0);

      // Verify slot is still locked, NOT booked
      const slotInDb = SlotService.getSlotById(slot.id);
      expect(slotInDb?.status).toBe('locked');
      expect(slotInDb?.lock_token).toBe(lockRes.lock_token);
    });

    it('Sec-5.3: Webhook receiving unlinked order ID records event safely as ignored without affecting system state', async () => {
      const payId = 'mp_pay_unlinked_999';
      const reqId = 'req_unlinked_001';
      const ts = Math.floor(Date.now() / 1000);
      const sig = generateSignature(payId, reqId, ts, testSecret);

      const res = await request(app)
        .post('/api/webhooks/mercadopago')
        .set('x-signature', sig)
        .set('x-request-id', reqId)
        .send({
          type: 'payment',
          data: {
            id: payId,
            external_reference: 'ord_nonexistent_order_id',
            status: 'approved',
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('sin orden vinculada');

      // Verify webhook event recorded as ignored
      const evt = db.prepare(`SELECT * FROM webhook_events WHERE mp_payment_id = ?`).get(payId) as any;
      expect(evt).toBeDefined();
      expect(evt.status).toBe('ignored');
    });

    it('Sec-5.4: Webhook with rejected payment on call session cleanly releases slot without approving order', async () => {
      const slot = createTestSlot('slot-reject-test');
      const lockRes = SlotService.acquireSoftLock(slot.id, 15);

      const prefRes = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: 'llamada',
          category: 'Familia',
          customer_name: 'Rejected Payer',
          customer_email: 'rejected@test.com',
          customer_birthdate: '1991-04-12',
          question: 'Consulta rechazada',
          slot_id: slot.id,
          lock_token: lockRes.lock_token,
        });

      expect(prefRes.status).toBe(200);
      const orderId = prefRes.body.order_id;
      const payId = 'mp_pay_rejected_slot_release';
      const reqId = 'req_reject_001';
      const ts = Math.floor(Date.now() / 1000);
      const sig = generateSignature(payId, reqId, ts, testSecret);

      // Webhook sends rejected status
      const webhookRes = await request(app)
        .post('/api/webhooks/mercadopago')
        .set('x-signature', sig)
        .set('x-request-id', reqId)
        .send({
          type: 'payment',
          data: {
            id: payId,
            external_reference: orderId,
            status: 'rejected',
          },
        });

      expect(webhookRes.status).toBe(200);
      expect(webhookRes.body.status).toBe('REJECTED');

      // Check slot is released back to available
      const slotAfter = SlotService.getSlotById(slot.id);
      expect(slotAfter?.status).toBe('available');
      expect(slotAfter?.lock_token).toBeNull();

      // Check order status is REJECTED
      const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as any;
      expect(order.status).toBe('REJECTED');
      expect(EmailService.getCapturedEmails().length).toBe(0);
    });
  });
});
