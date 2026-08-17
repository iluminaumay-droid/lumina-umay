/**
 * Tier 3: Cross-Feature Combinations E2E Test Suite (ESM)
 * Covers Form Transitions, Slot Locking with Webhook Fulfillment,
 * Webhook Idempotency on Repeated Deliveries, Order Polling, and Email Payloads.
 * Total: 10 tests.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TestHarness } from './helpers/test-harness.js';
import {
  assertClaudiaEmailPayload,
  assertCustomerEmailPayload
} from './helpers/assertion-helpers.js';

describe('Tier 3: Cross-Feature Combinations & State Transitions', () => {
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
  // 1. Form Schema Transitions & Dynamic Validation
  // ==========================================
  describe('3.1 Form Schema Transitions', () => {
    it('T3.1_Transition_FormTierSwitching: dynamic form switching alters required field validation between tiers', async () => {
      const basePayload = {
        category: 'Amor',
        customer_name: 'Andrea Navarro',
        customer_email: 'andrea@example.com',
        customer_birthdate: '1995-03-21',
        question: 'Consulta sobre relación'
      };

      // 1-carta succeeds with base payload
      const res1C = await client.createPreference({
        ...basePayload,
        tier_id: '1_carta'
      });
      assert.equal(res1C.status, 200);

      // Switching to 5-cartas fails with base payload because core_focus is mandatory
      const res5C_fail = await client.createPreference({
        ...basePayload,
        tier_id: '5_cartas'
      });
      assert.equal(res5C_fail.status, 400);

      // Switching to 5-cartas succeeds once core_focus is provided
      const res5C_ok = await client.createPreference({
        ...basePayload,
        tier_id: '5_cartas',
        core_focus: 'Saber si habrá matrimonio'
      });
      assert.equal(res5C_ok.status, 200);
    });
  });

  // ==========================================
  // 2. Slot Lifecycle & Webhook Transitions
  // ==========================================
  describe('3.2 Slot Lifecycle & Webhook Transitions', () => {
    it('T3.2_Workflow_SlotLockToWebhookApproval: complete state transition AVAILABLE -> SOFT_LOCKED -> BOOKED', async () => {
      const slotsRes = await client.getSlots();
      const targetSlot = slotsRes.data.slots[0];
      const slotId = targetSlot.id;

      // 1. Lock slot
      const lockRes = await client.lockSlot(slotId);
      assert.equal(lockRes.status, 200);

      // 2. Create preference
      const prefRes = await client.createPreference({
        tier_id: 'llamada',
        category: 'Trabajo/Dinero',
        customer_name: 'Santiago Garza',
        customer_email: 'santiago@example.com',
        customer_birthdate: '1989-12-12',
        question: 'Asesoría profesional',
        slot_id: slotId,
        lock_token: lockRes.data.lock_token
      });
      assert.equal(prefRes.status, 200);
      const orderId = prefRes.data.order_id;

      // 3. Webhook sends approved payment
      const webhookRes = await client.sendWebhook({
        type: 'payment',
        data: {
          id: 'mp_pay_call_001',
          external_reference: orderId,
          status: 'approved'
        }
      });
      assert.equal(webhookRes.status, 200);

      // 4. Verify order is APPROVED
      const statusRes = await client.getOrderStatus(orderId);
      assert.equal(statusRes.data.status, 'APPROVED');

      // 5. Verify slot is now permanently BOOKED and not in available slots
      const availableAfter = await client.getSlots();
      assert.equal(availableAfter.data.slots.some(s => s.id === slotId), false);
    });

    it('T3.3_Workflow_SlotLockToPaymentRejection: failed payment transitions slot back to AVAILABLE', async () => {
      const slotsRes = await client.getSlots();
      const targetSlot = slotsRes.data.slots[0];
      const slotId = targetSlot.id;

      // Lock slot
      const lockRes = await client.lockSlot(slotId);
      assert.equal(lockRes.status, 200);

      // Create preference
      const prefRes = await client.createPreference({
        tier_id: 'llamada',
        category: 'Amor',
        customer_name: 'Rebeca Santos',
        customer_email: 'rebeca@example.com',
        customer_birthdate: '1991-09-15',
        question: 'Consulta amorosa',
        slot_id: slotId,
        lock_token: lockRes.data.lock_token
      });
      const orderId = prefRes.data.order_id;

      // Webhook sends rejected payment
      await client.sendWebhook({
        type: 'payment',
        data: {
          id: 'mp_pay_fail_002',
          external_reference: orderId,
          status: 'rejected'
        }
      });

      // Verify slot is unlocked and returned to available list
      const availableAfter = await client.getSlots();
      assert.equal(availableAfter.data.slots.some(s => s.id === slotId), true);
    });

    it('T3.4_Workflow_SlotLockToPaymentCancellation: cancelled payment releases soft lock immediately', async () => {
      const slotsRes = await client.getSlots();
      const targetSlot = slotsRes.data.slots[0];
      const slotId = targetSlot.id;

      const lockRes = await client.lockSlot(slotId);
      const prefRes = await client.createPreference({
        tier_id: 'llamada',
        category: 'Familia',
        customer_name: 'Daniela Meza',
        customer_email: 'daniela@example.com',
        customer_birthdate: '1993-04-18',
        question: 'Consulta familiar',
        slot_id: slotId,
        lock_token: lockRes.data.lock_token
      });

      // Webhook sends cancelled payment
      await client.sendWebhook({
        type: 'payment',
        data: {
          id: 'mp_pay_cancel_003',
          external_reference: prefRes.data.order_id,
          status: 'cancelled'
        }
      });

      const availableAfter = await client.getSlots();
      assert.equal(availableAfter.data.slots.some(s => s.id === slotId), true);
    });
  });

  // ==========================================
  // 3. Webhook Idempotency
  // ==========================================
  describe('3.3 Webhook Idempotency & Deduplication', () => {
    it('T3.5_Idempotency_DuplicateApprovedWebhooks: receiving identical approved webhook 5 times dispatches emails exactly once', async () => {
      const payload = {
        tier_id: '3_cartas',
        category: 'Amor',
        customer_name: 'Alejandra Rios',
        customer_email: 'alejandra@example.com',
        customer_birthdate: '1994-07-07',
        question: '¿Qué pasará con mi relación actual?',
        involved_names: 'Miguel'
      };

      const prefRes = await client.createPreference(payload);
      const orderId = prefRes.data.order_id;
      const paymentId = 'mp_pay_idempotent_1001';

      // Send webhook 5 times
      for (let i = 0; i < 5; i++) {
        const res = await client.sendWebhook({
          type: 'payment',
          data: {
            id: paymentId,
            external_reference: orderId,
            status: 'approved'
          }
        });
        assert.equal(res.status, 200, `Webhook attempt ${i + 1} failed`);
      }

      // Check captured emails: exactly 1 to Claudia and 1 to customer (total 2)
      const emailRes = await client.getCapturedEmails();
      assert.equal(emailRes.emails.length, 2, 'Should only send 2 emails total across 5 duplicate deliveries');
    });

    it('T3.6_Idempotency_DuplicateRejectionWebhooks: receiving repeated rejection webhooks operates safely without error', async () => {
      const payload = {
        tier_id: '1_carta',
        category: 'Otro',
        customer_name: 'Test Rejection',
        customer_email: 'testrej@example.com',
        customer_birthdate: '1990-01-01',
        question: 'Pregunta de prueba'
      };
      const prefRes = await client.createPreference(payload);
      const orderId = prefRes.data.order_id;

      for (let i = 0; i < 3; i++) {
        const res = await client.sendWebhook({
          type: 'payment',
          data: {
            id: 'mp_pay_rej_duplicate',
            external_reference: orderId,
            status: 'rejected'
          }
        });
        assert.equal(res.status, 200);
      }
    });
  });

  // ==========================================
  // 4. Polling & Notification Payloads
  // ==========================================
  describe('3.4 Polling & Notification Payloads', () => {
    it('T3.7_OrderPolling_PendingToApproved: status transitions from PENDING to APPROVED upon webhook arrival', async () => {
      const payload = {
        tier_id: '1_carta',
        category: 'Trabajo/Dinero',
        customer_name: 'Ernesto Zedillo',
        customer_email: 'ernesto@example.com',
        customer_birthdate: '1980-05-10',
        question: '¿Tendré éxito en mi inversión?'
      };
      const prefRes = await client.createPreference(payload);
      const orderId = prefRes.data.order_id;

      // 1. Initial status is PENDING
      const poll1 = await client.getOrderStatus(orderId);
      assert.equal(poll1.data.status, 'PENDING');

      // 2. Webhook confirms payment
      await client.sendWebhook({
        type: 'payment',
        data: {
          id: 'mp_pay_poll_001',
          external_reference: orderId,
          status: 'approved'
        }
      });

      // 3. Polling now returns APPROVED
      const poll2 = await client.getOrderStatus(orderId);
      assert.equal(poll2.data.status, 'APPROVED');
    });

    it('T3.8_EmailDispatcher_ClaudiaPayloadIntegrity: Claudia email contains complete consultation context', async () => {
      const payload = {
        tier_id: '5_cartas',
        category: 'Familia',
        customer_name: 'Veronica Castro',
        customer_email: 'veronica@example.com',
        customer_birthdate: '1987-11-03',
        question: 'Tirada sobre dinámica familiar de herencia',
        involved_names: 'Hermanos Castro',
        core_focus: 'Resolución pacífica del conflicto patrimonial'
      };
      const prefRes = await client.createPreference(payload);
      const orderId = prefRes.data.order_id;

      await client.sendWebhook({
        type: 'payment',
        data: {
          id: 'mp_pay_email_claudia',
          external_reference: orderId,
          status: 'approved'
        }
      });

      const emailRes = await client.getCapturedEmails();
      const claudiaEmail = emailRes.emails.find(e => e.to.includes('claudia'));
      assertClaudiaEmailPayload(claudiaEmail, payload);
    });

    it('T3.9_EmailDispatcher_CustomerPayloadIntegrity: Customer email contains appropriate turnaround or appointment text', async () => {
      const payload = {
        tier_id: '3_cartas',
        category: 'Amor',
        customer_name: 'Monica Bellucci',
        customer_email: 'monica@example.com',
        customer_birthdate: '1984-09-30',
        question: '¿Qué me depara el amor?'
      };
      const prefRes = await client.createPreference(payload);
      const orderId = prefRes.data.order_id;

      await client.sendWebhook({
        type: 'payment',
        data: {
          id: 'mp_pay_email_cust',
          external_reference: orderId,
          status: 'approved'
        }
      });

      const emailRes = await client.getCapturedEmails();
      const customerEmail = emailRes.emails.find(e => e.to === payload.customer_email);
      assertCustomerEmailPayload(customerEmail, payload);
    });

    it('T3.10_EmailDispatcher_GracefulFallback: unconfigured live credentials fall back safely to mock sink without crashing', async () => {
      // In mock/test harness mode, verifies logging occurs cleanly
      const payload = {
        tier_id: '1_carta',
        category: 'Otro',
        customer_name: 'Test Fallback',
        customer_email: 'fallback@example.com',
        customer_birthdate: '1990-01-01',
        question: 'Pregunta de prueba fallback'
      };
      const prefRes = await client.createPreference(payload);
      const webhookRes = await client.sendWebhook({
        type: 'payment',
        data: {
          id: 'mp_pay_fallback',
          external_reference: prefRes.data.order_id,
          status: 'approved'
        }
      });
      assert.equal(webhookRes.status, 200);
      assert.equal(webhookRes.data.success, true);
    });
  });
});
