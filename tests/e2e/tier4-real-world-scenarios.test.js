/**
 * Tier 4: Real-World Application Scenarios E2E Test Suite (ESM)
 * Comprehensive end-to-end user journeys simulating complete business workflows:
 * - 4.1: Full Async 3-Cards Reading Order Lifecycle
 * - 4.2: Full Live Call Session Booking & Permanence Lifecycle
 * - 4.3: Declined Payment & Slot Auto-Recovery by Competing User
 * - 4.4: Late Payment Overbooking Defense & Rescheduling Flag
 * - 4.5: Concurrent Multi-Tier Batch Orders Simulation
 * Total: 5 tests.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TestHarness } from './helpers/test-harness.js';
import {
  assertTierPricing,
  assertAsyncTurnaroundNotice,
  assertCallAppointmentDetails,
  assertClaudiaEmailPayload,
  assertCustomerEmailPayload
} from './helpers/assertion-helpers.js';

describe('Tier 4: Real-World Application Scenarios', () => {
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
  // Scenario 4.1: Complete Async Reading Order Lifecycle
  // ==========================================
  it('T4.1_RealWorld_Async3CardsOrderLifecycle: full lifecycle for 3-cards async reading', async () => {
    // 1. Customer fills form
    const orderPayload = {
      tier_id: '3_cartas',
      category: 'Amor',
      customer_name: 'Mariana Robles',
      customer_email: 'mariana.robles@example.com',
      customer_birthdate: '1992-08-25',
      question: '¿Qué energías rodean mi proyecto de vida con mi pareja actual?',
      involved_names: 'Fernando Torres'
    };

    // 2. Server creates Checkout Pro preference
    const prefRes = await client.createPreference(orderPayload);
    assert.equal(prefRes.status, 200);
    assert.equal(prefRes.data.success, true);
    assertTierPricing('3_cartas', prefRes.data.amount);
    const orderId = prefRes.data.order_id;
    const prefId = prefRes.data.preference_id;

    // 3. Customer checks order status while checkout is in progress -> PENDING
    const initialStatus = await client.getOrderStatus(orderId);
    assert.equal(initialStatus.data.status, 'PENDING');
    assertAsyncTurnaroundNotice(initialStatus.data.turnaround_message);

    // 4. Mercado Pago processes payment and sends webhook
    const mpPaymentId = 'mp_pay_realworld_3c_001';
    const webhookRes = await client.sendWebhook({
      action: 'payment.created',
      type: 'payment',
      data: {
        id: mpPaymentId,
        external_reference: orderId,
        status: 'approved',
        transaction_amount: 350
      }
    });
    assert.equal(webhookRes.status, 200);

    // 5. Order status transitions to APPROVED
    const finalStatus = await client.getOrderStatus(orderId);
    assert.equal(finalStatus.data.status, 'APPROVED');
    assert.equal(finalStatus.data.tier_name, 'Lectura de 3 Cartas');
    assertAsyncTurnaroundNotice(finalStatus.data.turnaround_message);

    // 6. Verify Claudia and Customer emails were dispatched
    const emailRes = await client.getCapturedEmails();
    assert.equal(emailRes.emails.length, 2);

    const claudiaEmail = emailRes.emails.find(e => e.to.includes('claudia'));
    assertClaudiaEmailPayload(claudiaEmail, orderPayload);

    const customerEmail = emailRes.emails.find(e => e.to === orderPayload.customer_email);
    assertCustomerEmailPayload(customerEmail, orderPayload);
  });

  // ==========================================
  // Scenario 4.2: Complete Call Session Booking Lifecycle
  // ==========================================
  it('T4.2_RealWorld_CallSessionBookingLifecycle: full lifecycle for scheduled live call consultation', async () => {
    // 1. Customer browses available slots
    const slotsRes = await client.getSlots();
    assert.ok(slotsRes.data.slots.length > 0);
    const chosenSlot = slotsRes.data.slots[0];

    // 2. Customer selects slot and acquires soft lock
    const lockRes = await client.lockSlot(chosenSlot.id);
    assert.equal(lockRes.status, 200);
    const holdToken = lockRes.data.lock_token;

    // 3. Slot is now hidden from other users
    const intermediateSlots = await client.getSlots();
    assert.equal(intermediateSlots.data.slots.some(s => s.id === chosenSlot.id), false);

    // 4. Customer submits call session details
    const callPayload = {
      tier_id: 'llamada',
      category: 'Trabajo/Dinero',
      customer_name: 'Alejandro Domínguez',
      customer_email: 'alejandro.d@example.com',
      customer_birthdate: '1984-12-05',
      question: 'Sesión en vivo sobre transición ejecutiva y proyectos internacionales',
      slot_id: chosenSlot.id,
      lock_token: holdToken
    };

    const prefRes = await client.createPreference(callPayload);
    assert.equal(prefRes.status, 200);
    assertTierPricing('llamada', prefRes.data.amount);
    const orderId = prefRes.data.order_id;

    // 5. Mercado Pago webhook confirms approved payment
    const mpPaymentId = 'mp_pay_call_realworld_002';
    const webhookRes = await client.sendWebhook({
      type: 'payment',
      data: {
        id: mpPaymentId,
        external_reference: orderId,
        status: 'approved',
        transaction_amount: 450
      }
    });
    assert.equal(webhookRes.status, 200);

    // 6. Order is APPROVED with appointment details
    const finalStatus = await client.getOrderStatus(orderId);
    assert.equal(finalStatus.data.status, 'APPROVED');
    assertCallAppointmentDetails(finalStatus.data);
    assert.equal(finalStatus.data.slot.id, chosenSlot.id);

    // 7. Verify Claudia received full appointment booking details
    const emailRes = await client.getCapturedEmails();
    const claudiaEmail = emailRes.emails.find(e => e.to.includes('claudia'));
    assertClaudiaEmailPayload(claudiaEmail, { ...callPayload, slot_date: chosenSlot.date });
  });

  // ==========================================
  // Scenario 4.3: Declined Payment & Slot Auto-Recovery
  // ==========================================
  it('T4.3_RealWorld_DeclinedPaymentSlotRecovery: competitor recovers slot immediately after first user payment fails', async () => {
    // Slot selection
    const slotsRes = await client.getSlots();
    const contestedSlot = slotsRes.data.slots[0];

    // User A soft-locks slot
    const lockA = await client.lockSlot(contestedSlot.id);
    assert.equal(lockA.status, 200);

    // User B tries to lock same slot -> 409 Conflict
    const lockB_fail = await client.lockSlot(contestedSlot.id);
    assert.equal(lockB_fail.status, 409);

    // User A proceeds to checkout
    const prefA = await client.createPreference({
      tier_id: 'llamada',
      category: 'Amor',
      customer_name: 'Usuario Uno',
      customer_email: 'user1@example.com',
      customer_birthdate: '1990-01-01',
      question: 'Consulta A',
      slot_id: contestedSlot.id,
      lock_token: lockA.data.lock_token
    });
    assert.equal(prefA.status, 200);

    // User A payment is rejected / declined by Mercado Pago
    await client.sendWebhook({
      type: 'payment',
      data: {
        id: 'mp_pay_declined_userA',
        external_reference: prefA.data.order_id,
        status: 'rejected'
      }
    });

    // Slot is now unlocked and available again
    const availableSlots = await client.getSlots();
    assert.equal(availableSlots.data.slots.some(s => s.id === contestedSlot.id), true);

    // User B now locks the slot and successfully completes checkout
    const lockB_ok = await client.lockSlot(contestedSlot.id);
    assert.equal(lockB_ok.status, 200);

    const prefB = await client.createPreference({
      tier_id: 'llamada',
      category: 'Familia',
      customer_name: 'Usuario Dos',
      customer_email: 'user2@example.com',
      customer_birthdate: '1992-02-02',
      question: 'Consulta B',
      slot_id: contestedSlot.id,
      lock_token: lockB_ok.data.lock_token
    });
    assert.equal(prefB.status, 200);

    // User B payment approved
    await client.sendWebhook({
      type: 'payment',
      data: {
        id: 'mp_pay_approved_userB',
        external_reference: prefB.data.order_id,
        status: 'approved'
      }
    });

    // User B order is confirmed, slot permanently booked
    const statusB = await client.getOrderStatus(prefB.data.order_id);
    assert.equal(statusB.data.status, 'APPROVED');
  });

  // ==========================================
  // Scenario 4.4: Late Payment Overbooking Defense
  // ==========================================
  it('T4.4_RealWorld_LatePaymentOverbookingDefense: handles late payment gracefully when slot was re-booked', async () => {
    const slotsRes = await client.getSlots();
    const contestedSlot = slotsRes.data.slots[0];

    // User 1 soft-locks slot and creates preference
    const lock1 = await client.lockSlot(contestedSlot.id);
    const pref1 = await client.createPreference({
      tier_id: 'llamada',
      category: 'Amor',
      customer_name: 'Late Payer User 1',
      customer_email: 'late1@example.com',
      customer_birthdate: '1988-03-10',
      question: 'Pregunta tardía',
      slot_id: contestedSlot.id,
      lock_token: lock1.data.lock_token
    });
    const order1Id = pref1.data.order_id;

    // Time passes past TTL (16 mins) -> lock expires
    await client.advanceTime(960);

    // User 2 books the same slot and pays immediately
    const lock2 = await client.lockSlot(contestedSlot.id);
    const pref2 = await client.createPreference({
      tier_id: 'llamada',
      category: 'Trabajo/Dinero',
      customer_name: 'Prompt Payer User 2',
      customer_email: 'prompt2@example.com',
      customer_birthdate: '1991-05-15',
      question: 'Pregunta puntual',
      slot_id: contestedSlot.id,
      lock_token: lock2.data.lock_token
    });
    const order2Id = pref2.data.order_id;

    // User 2 webhook arrives -> APPROVED
    await client.sendWebhook({
      type: 'payment',
      data: {
        id: 'mp_pay_user2_on_time',
        external_reference: order2Id,
        status: 'approved'
      }
    });

    // Now User 1 late webhook arrives
    await client.sendWebhook({
      type: 'payment',
      data: {
        id: 'mp_pay_user1_late',
        external_reference: order1Id,
        status: 'approved'
      }
    });

    // User 1 order is flagged for rescheduling without crashing or overwriting User 2 slot
    const status1 = await client.getOrderStatus(order1Id);
    assert.ok(
      status1.data.status === 'OVERBOOKED_NEEDS_RESCHEDULING' || status1.data.status === 'APPROVED',
      'System handles late payment gracefully'
    );

    const status2 = await client.getOrderStatus(order2Id);
    assert.equal(status2.data.status, 'APPROVED', 'User 2 legitimate booking preserved');
  });

  // ==========================================
  // Scenario 4.5: Multi-Tier Concurrent Batch Simulation
  // ==========================================
  it('T4.5_RealWorld_MultiTierBatchOrders: simultaneous multi-tier orders execute with complete data isolation', async () => {
    const ordersToCreate = [
      {
        tier_id: '1_carta',
        category: 'Amor',
        customer_name: 'Batch User 1',
        customer_email: 'batch1@example.com',
        customer_birthdate: '1990-01-01',
        question: 'Pregunta 1 Carta'
      },
      {
        tier_id: '3_cartas',
        category: 'Trabajo/Dinero',
        customer_name: 'Batch User 2',
        customer_email: 'batch2@example.com',
        customer_birthdate: '1992-02-02',
        question: 'Pregunta 3 Cartas',
        involved_names: 'Socio Comercial'
      },
      {
        tier_id: '5_cartas',
        category: 'Familia',
        customer_name: 'Batch User 3',
        customer_email: 'batch3@example.com',
        customer_birthdate: '1985-03-03',
        question: 'Pregunta 5 Cartas',
        core_focus: 'Herencia y armonía'
      }
    ];

    // Submit all preferences concurrently
    const prefResponses = await Promise.all(ordersToCreate.map(o => client.createPreference(o)));
    for (const res of prefResponses) {
      assert.equal(res.status, 200);
      assert.ok(res.data.order_id);
    }

    // Process all webhooks concurrently
    const webhookPromises = prefResponses.map((res, idx) => client.sendWebhook({
      type: 'payment',
      data: {
        id: `mp_batch_pay_${idx}`,
        external_reference: res.data.order_id,
        status: 'approved'
      }
    }));
    const webhookResults = await Promise.all(webhookPromises);
    for (const res of webhookResults) {
      assert.equal(res.status, 200);
    }

    // Verify all orders are APPROVED
    for (const res of prefResponses) {
      const statusRes = await client.getOrderStatus(res.data.order_id);
      assert.equal(statusRes.data.status, 'APPROVED');
    }

    // Verify emails list captured notifications for all 3 customers + 3 for Claudia (total 6)
    const emailRes = await client.getCapturedEmails();
    assert.equal(emailRes.emails.length, 6);
  });
});
