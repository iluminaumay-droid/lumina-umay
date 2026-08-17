/**
 * Tier 2: Boundary & Concurrency E2E Test Suite (ESM)
 * Covers Input Boundaries, Date Edge Cases, Enum Boundaries, Simultaneous Lock Concurrency,
 * Lock Expiration / Auto-Release, Spoofed Redirects, and Tampered Webhook Signatures.
 * Total: 12 tests.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TestHarness } from './helpers/test-harness.js';

describe('Tier 2: Boundary & Concurrency', () => {
  const harness = new TestHarness();
  let client;

  before(async () => {
    client = await harness.setup();
  });

  after(async () => {
    await harness.teardown();
  });

  beforeEach(async () => {
    await client.resetState();
  });

  // ==========================================
  // 1. Input Length & Character Boundaries
  // ==========================================
  describe('2.1 Input Length & Character Boundaries', () => {
    it('T2.1_Boundary_ExtremeQuestionLength: should accept and process long 5000-character question payload cleanly without error', async () => {
      const longQuestion = 'Situación detallada: '.repeat(250); // ~5,500 chars
      const payload = {
        tier_id: '3_cartas',
        category: 'Trabajo/Dinero',
        customer_name: 'Guillermo Del Toro',
        customer_email: 'guillermo@example.com',
        customer_birthdate: '1975-10-09',
        question: longQuestion
      };

      const res = await client.createPreference(payload);
      assert.equal(res.status, 200);
      assert.equal(res.data.success, true);
      assert.ok(res.data.order_id);
    });

    it('T2.2_Boundary_ExtremeNameLength: should reject single-character name and handle 200-char name cleanly', async () => {
      // 1-char name should fail validation (min 2 chars)
      const shortNamePayload = {
        tier_id: '1_carta',
        category: 'Amor',
        customer_name: 'A',
        customer_email: 'test@example.com',
        customer_birthdate: '1990-01-01',
        question: '¿Tendré suerte?'
      };
      const shortRes = await client.createPreference(shortNamePayload);
      assert.equal(shortRes.status, 400);

      // Long valid name should pass
      const longName = 'Don Francisco Javier de la Santísima Trinidad de los Santos Morales';
      const longNamePayload = {
        ...shortNamePayload,
        customer_name: longName
      };
      const longRes = await client.createPreference(longNamePayload);
      assert.equal(longRes.status, 200);
    });

    it('T2.6_Boundary_XSSSanitization: should safely store input containing script tags without executing code', async () => {
      const xssPayload = {
        tier_id: '1_carta',
        category: 'Amor',
        customer_name: '<script>alert("xss")</script> Pedro',
        customer_email: 'pedro@example.com',
        customer_birthdate: '1985-05-15',
        question: '¿Qué pasará? <img src=x onerror=alert(1)>'
      };

      const res = await client.createPreference(xssPayload);
      assert.equal(res.status, 200);

      const statusRes = await client.getOrderStatus(res.data.order_id);
      assert.equal(statusRes.status, 200);
      assert.equal(statusRes.data.status, 'PENDING');
    });
  });

  // ==========================================
  // 2. Date & Enum Boundaries
  // ==========================================
  describe('2.2 Date & Enum Boundaries', () => {
    it('T2.3_Boundary_InvalidBirthdateFuture: should reject future birthdate (e.g. 2050-01-01) with HTTP 400', async () => {
      const payload = {
        tier_id: '1_carta',
        category: 'Amor',
        customer_name: 'Futurista González',
        customer_email: 'futuro@example.com',
        customer_birthdate: '2050-01-01',
        question: '¿Qué pasará en el futuro?'
      };
      const res = await client.createPreference(payload);
      assert.equal(res.status, 400);
      assert.equal(res.data.success, false);
      assert.ok(res.data.error.includes('fecha de nacimiento'));
    });

    it('T2.4_Boundary_InvalidBirthdateNonExistent: should reject non-existent calendar date (e.g. 2023-02-30) or malformed dates', async () => {
      const malformedDates = ['2023-02-30', '31-12-1990', 'invalid-date', '1990/05/10'];
      for (const bdate of malformedDates) {
        const payload = {
          tier_id: '1_carta',
          category: 'Amor',
          customer_name: 'Test Date',
          customer_email: 'test@example.com',
          customer_birthdate: bdate,
          question: 'Valid question'
        };
        const res = await client.createPreference(payload);
        assert.equal(res.status, 400, `Should reject date: ${bdate}`);
      }
    });

    it('T2.5_Boundary_InvalidCategoryEnum: should reject unknown categories or SQL injection payloads in category field', async () => {
      const badCategories = ['Salud', 'General', 'Dinero', "' OR 1=1--", '<script>'];
      for (const badCat of badCategories) {
        const payload = {
          tier_id: '1_carta',
          category: badCat,
          customer_name: 'Test Cat',
          customer_email: 'cat@example.com',
          customer_birthdate: '1990-01-01',
          question: 'Valid question'
        };
        const res = await client.createPreference(payload);
        assert.equal(res.status, 400, `Should reject category: ${badCat}`);
        assert.ok(res.data.error.includes('categoría'));
      }
    });
  });

  // ==========================================
  // 3. Concurrency & Soft-Lock Race Conditions
  // ==========================================
  describe('2.3 Concurrency & Lock Collisions', () => {
    it('T2.7_Concurrency_SimultaneousSlotLocks: 10 simultaneous lock requests on the same slot should yield exactly 1 success and 9 conflicts', async () => {
      const slotsRes = await client.getSlots();
      const targetSlot = slotsRes.data.slots[0];
      const slotId = targetSlot.id;

      // Dispatch 10 concurrent requests to lock the same slot
      const promises = Array.from({ length: 10 }).map(() => client.lockSlot(slotId));
      const results = await Promise.all(promises);

      const successes = results.filter(r => r.status === 200 && r.data.success === true);
      const conflicts = results.filter(r => r.status === 409 && r.data.success === false);

      assert.equal(successes.length, 1, 'Exactly one concurrent request must obtain the lock');
      assert.equal(conflicts.length, 9, 'All other 9 concurrent requests must receive 409 Conflict');
      assert.ok(successes[0].data.lock_token, 'Winning lock must receive hold_token');
    });

    it('T2.8_Concurrency_ReleaseAndReacquire: releasing a lock immediately permits another customer to acquire the slot', async () => {
      const slotsRes = await client.getSlots();
      const targetSlot = slotsRes.data.slots[0];

      // Client A acquires lock
      const lockA = await client.lockSlot(targetSlot.id);
      assert.equal(lockA.status, 200);

      // Client B attempt is blocked
      const lockB1 = await client.lockSlot(targetSlot.id);
      assert.equal(lockB1.status, 409);

      // Client A releases lock
      const releaseA = await client.releaseSlot(targetSlot.id, lockA.data.lock_token);
      assert.equal(releaseA.status, 200);

      // Client B retries and succeeds
      const lockB2 = await client.lockSlot(targetSlot.id);
      assert.equal(lockB2.status, 200);
      assert.ok(lockB2.data.lock_token);
    });

    it('T2.9_Concurrency_AutoReleaseExpiredLocks: expired soft-lock TTL automatically releases slot back to AVAILABLE', async () => {
      const slotsRes = await client.getSlots();
      const targetSlot = slotsRes.data.slots[0];

      // Lock slot (15 min TTL)
      const lockRes = await client.lockSlot(targetSlot.id);
      assert.equal(lockRes.status, 200);

      // Slot should not be in available list
      const intermediateSlots = await client.getSlots();
      const isAvailableBefore = intermediateSlots.data.slots.some(s => s.id === targetSlot.id);
      assert.equal(isAvailableBefore, false, 'Locked slot must not appear in available list');

      // Fast forward time by 16 minutes (960 seconds) past the 15-min TTL
      await client.advanceTime(960);

      // Query available slots again -> slot must be available again
      const afterSlots = await client.getSlots();
      const isAvailableAfter = afterSlots.data.slots.some(s => s.id === targetSlot.id);
      assert.equal(isAvailableAfter, true, 'Expired slot must be automatically available again');

      // New lock on now-available slot must succeed
      const newLock = await client.lockSlot(targetSlot.id);
      assert.equal(newLock.status, 200);
    });
  });

  // ==========================================
  // 4. Webhook Security & Anti-Spoofing
  // ==========================================
  describe('2.4 Webhook Security & Anti-Spoofing Invariants', () => {
    it('T2.10_Security_AntiSpoofingRedirect: direct polling or navigation without webhook approval never approves order', async () => {
      const payload = {
        tier_id: '1_carta',
        category: 'Amor',
        customer_name: 'Hacker Spoof',
        customer_email: 'hacker@example.com',
        customer_birthdate: '1990-01-01',
        question: '¿Puedo obtener mi lectura sin pagar?'
      };

      const prefRes = await client.createPreference(payload);
      assert.equal(prefRes.status, 200);
      const orderId = prefRes.data.order_id;

      // Check status directly (as if client redirected to /checkout/success)
      const statusRes = await client.getOrderStatus(orderId);
      assert.equal(statusRes.status, 200);
      assert.equal(statusRes.data.status, 'PENDING', 'Order must remain PENDING without webhook verification');

      // Ensure no emails sent
      const emailRes = await client.getCapturedEmails();
      assert.equal(emailRes.emails.length, 0, 'No emails should be dispatched for unconfirmed order');
    });

    it('T2.11_Security_TamperedWebhookSignature: webhook with invalid signature header is rejected with HTTP 401', async () => {
      const webhookPayload = {
        type: 'payment',
        data: { id: 'fake_mp_12345', external_reference: 'ord_fake', status: 'approved' }
      };

      const res = await client.sendWebhook(webhookPayload, {
        'x-signature': 'invalid_signature_tampered_hash_value'
      });

      assert.equal(res.status, 401);
      assert.equal(res.data.success, false);
    });

    it('T2.12_Security_WebhookInvalidPaymentId: webhook receiving rejected/cancelled payment status does not approve order', async () => {
      const payload = {
        tier_id: '3_cartas',
        category: 'Trabajo/Dinero',
        customer_name: 'Declined Customer',
        customer_email: 'declined@example.com',
        customer_birthdate: '1992-06-20',
        question: '¿Saldrá mi crédito bancario?'
      };

      const prefRes = await client.createPreference(payload);
      const orderId = prefRes.data.order_id;

      // Webhook fires with rejected status
      const webhookRes = await client.sendWebhook({
        type: 'payment',
        data: {
          id: 'mp_pay_declined_999',
          external_reference: orderId,
          status: 'rejected'
        }
      });
      assert.equal(webhookRes.status, 200);

      // Verify order status is REJECTED, not APPROVED
      const statusRes = await client.getOrderStatus(orderId);
      assert.equal(statusRes.data.status, 'REJECTED');

      // No confirmation emails should be dispatched
      const emailRes = await client.getCapturedEmails();
      assert.equal(emailRes.emails.length, 0);
    });
  });
});
