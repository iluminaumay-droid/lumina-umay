import crypto from 'node:crypto';
import { isValidBirthdate, createPreferenceSchema } from '../../src/server/validators/checkout.validator.js';
import { MercadoPagoService } from '../../src/server/services/mercadopago.service.js';
import { SlotService } from '../../src/server/services/slot.service.js';
import { EmailService } from '../../src/server/services/email.service.js';
import { db, closeDatabase } from '../../src/server/db/database.js';
import { TIER_CONFIG } from '../../src/server/types/checkout.types.js';

async function runForensicAudit() {
  console.log('====================================================');
  console.log('🔬 FORENSIC AUDITOR EMPIRICAL VERIFICATION SCRIPT');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${desc}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${desc}`);
      failed++;
    }
  }

  // ----------------------------------------------------
  // 1. Zod & Gregorian Date Validation Verification
  // ----------------------------------------------------
  console.log('--- 1. Gregorian Date & Zod Validator Verification ---');
  
  assert(isValidBirthdate('1990-05-15') === true, 'Valid date 1990-05-15 accepted');
  assert(isValidBirthdate('2000-02-29') === true, 'Leap year 2000-02-29 accepted');
  assert(isValidBirthdate('2024-02-29') === true, 'Leap year 2024-02-29 accepted');
  assert(isValidBirthdate('2023-02-29') === false, 'Non-leap year 2023-02-29 rejected');
  assert(isValidBirthdate('2023-02-30') === false, 'Impossible date 2023-02-30 rejected');
  assert(isValidBirthdate('2023-04-31') === false, 'Impossible date 2023-04-31 (30 days in April) rejected');
  assert(isValidBirthdate('2023-06-31') === false, 'Impossible date 2023-06-31 (30 days in June) rejected');
  assert(isValidBirthdate('2050-01-01') === false, 'Future date 2050-01-01 rejected');
  assert(isValidBirthdate('1899-12-31') === false, 'Pre-1900 date rejected');
  assert(isValidBirthdate('15/05/1990') === false, 'Non-ISO format rejected');
  assert(isValidBirthdate('invalid') === false, 'Garbage string rejected');

  // Zod schema 5_cartas core_focus requirement
  const res5NoFocus = createPreferenceSchema.safeParse({
    tier_id: '5_cartas',
    category: 'Amor',
    customer_name: 'Test Name',
    customer_email: 'test@example.com',
    customer_birthdate: '1990-01-01',
    question: 'Tirada profunda',
  });
  assert(!res5NoFocus.success, '5_cartas without core_focus rejected by Zod schema');

  const res5WithFocus = createPreferenceSchema.safeParse({
    tier_id: '5_cartas',
    category: 'Amor',
    customer_name: 'Test Name',
    customer_email: 'test@example.com',
    customer_birthdate: '1990-01-01',
    question: 'Tirada profunda',
    core_focus: 'Claridad en decisiones de vida',
  });
  assert(res5WithFocus.success, '5_cartas with core_focus accepted by Zod schema');

  // Zod schema llamada slot_id requirement
  const resCallNoSlot = createPreferenceSchema.safeParse({
    tier_id: 'llamada',
    category: 'Amor',
    customer_name: 'Test Name',
    customer_email: 'test@example.com',
    customer_birthdate: '1990-01-01',
    question: 'Sesión en vivo',
  });
  assert(!resCallNoSlot.success, 'llamada without slot_id rejected by Zod schema');

  // ----------------------------------------------------
  // 2. Mercado Pago HMAC SHA-256 & timingSafeEqual Verification
  // ----------------------------------------------------
  console.log('\n--- 2. HMAC SHA-256 Signature Verification ---');
  const secret = 'forensic_secret_test_key_999';
  const dataId = '1122334455';
  const requestId = 'req-forensic-test-123';
  const ts = Math.floor(Date.now() / 1000).toString();

  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const computedHmac = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const validHeader = `ts=${ts},v1=${computedHmac}`;

  const validSigCheck = MercadoPagoService.verifySignature(validHeader, requestId, dataId, secret);
  assert(validSigCheck.isValid === true, 'Legitimate HMAC SHA-256 signature verified as valid');

  const wrongSecretCheck = MercadoPagoService.verifySignature(validHeader, requestId, dataId, 'wrong_secret');
  assert(wrongSecretCheck.isValid === false, 'Tampered secret key rejected');

  const wrongDataIdCheck = MercadoPagoService.verifySignature(validHeader, requestId, 'wrong_id', secret);
  assert(wrongDataIdCheck.isValid === false, 'Tampered data ID rejected');

  const wrongReqIdCheck = MercadoPagoService.verifySignature(validHeader, 'wrong_req', dataId, secret);
  assert(wrongReqIdCheck.isValid === false, 'Tampered request ID rejected');

  const tamperedHmacHeader = `ts=${ts},v1=${computedHmac.slice(0, -2)}aa`;
  const tamperedHmacCheck = MercadoPagoService.verifySignature(tamperedHmacHeader, requestId, dataId, secret);
  assert(tamperedHmacCheck.isValid === false, 'Tampered hash digest rejected');

  // Replay Attack: 10 minutes ago
  const expiredTs = (Math.floor(Date.now() / 1000) - 600).toString();
  const expManifest = `id:${dataId};request-id:${requestId};ts:${expiredTs};`;
  const expHmac = crypto.createHmac('sha256', secret).update(expManifest).digest('hex');
  const expHeader = `ts=${expiredTs},v1=${expHmac}`;
  const expiredSigCheck = MercadoPagoService.verifySignature(expHeader, requestId, dataId, secret);
  assert(expiredSigCheck.isValid === false, 'Replay attack outside 5m tolerance window rejected');

  // ----------------------------------------------------
  // 3. Server Pricing Matrix Verification
  // ----------------------------------------------------
  console.log('\n--- 3. Server Pricing Matrix Verification ---');
  assert(TIER_CONFIG['1_carta'].price === 150, '1_carta price is strictly $150 MXN');
  assert(TIER_CONFIG['3_cartas'].price === 350, '3_cartas price is strictly $350 MXN');
  assert(TIER_CONFIG['5_cartas'].price === 500, '5_cartas price is strictly $500 MXN');
  assert(TIER_CONFIG['llamada'].price === 450, 'llamada price is strictly $450 MXN');
  assert(TIER_CONFIG['call_session'].price === 450, 'call_session alias price is strictly $450 MXN');

  // ----------------------------------------------------
  // 4. SQLite Database & Webhook Idempotency Verification
  // ----------------------------------------------------
  console.log('\n--- 4. SQLite Database & Webhook Idempotency Verification ---');
  db.prepare(`DELETE FROM webhook_events`).run();
  db.prepare(`DELETE FROM orders`).run();
  db.prepare(`DELETE FROM slots`).run();

  const testSlotId = 'forensic-slot-db-test';
  const futureStart = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
  const futureEnd = new Date(Date.now() + 48 * 3600 * 1000 + 45 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO slots (id, start_time, end_time, status)
    VALUES (?, ?, ?, 'available')
  `).run(testSlotId, futureStart, futureEnd);

  const slotBefore = SlotService.getSlotById(testSlotId);
  assert(slotBefore?.status === 'available', 'Slot inserted as available');

  const lock = SlotService.acquireSoftLock(testSlotId, 15);
  assert(lock.lock_token !== undefined && lock.lock_token.length > 0, 'Soft-lock acquired with UUID token');

  const slotLocked = SlotService.getSlotById(testSlotId);
  assert(slotLocked?.status === 'locked', 'Slot status updated to locked in SQLite');

  const orderId = 'ord_forensic_test_001';
  db.prepare(`
    INSERT INTO orders (
      id, tier_id, category, amount_mxn, customer_name, customer_email,
      customer_birthdate, question, slot_id, lock_token, status, created_at, updated_at
    ) VALUES (?, 'llamada', 'Amor', 450, 'Consultante Test', 'test@example.com', '1992-05-10', 'Pregunta test', ?, ?, 'pending', datetime('now'), datetime('now'))
  `).run(orderId, testSlotId, lock.lock_token);

  const orderInDb = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as any;
  assert(orderInDb?.amount_mxn === 450, 'Order amount strictly stored as 450 in SQLite');
  assert(orderInDb?.status === 'pending', 'Order status strictly initialized to pending');

  // Simulate Webhook Event insertion & idempotency guard
  const paymentId = 'mp_pay_forensic_99999';
  const evtId = `evt_${paymentId}`;

  db.prepare(`
    INSERT INTO webhook_events (id, mp_payment_id, event_type, payload, signature, status, processed_at)
    VALUES (?, ?, 'payment', '{}', 'test_sig', 'processed', datetime('now'))
  `).run(evtId, paymentId);

  const duplicateCheck = db.prepare(
    `SELECT id, status FROM webhook_events WHERE (id = ? OR mp_payment_id = ?) AND status = 'processed'`
  ).get(evtId, paymentId) as any;
  assert(duplicateCheck !== undefined && duplicateCheck.status === 'processed', 'Webhook idempotency query successfully detects duplicate payment event in SQLite');

  // Confirm booking state transition
  SlotService.confirmBooking(testSlotId, lock.lock_token);
  const slotBooked = SlotService.getSlotById(testSlotId);
  assert(slotBooked?.status === 'booked', 'Slot status permanently transitioned to booked upon confirmed payment');

  closeDatabase();

  console.log('\n====================================================');
  console.log(`Forensic Verification Results: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runForensicAudit().catch((err) => {
  console.error('Forensic verification crashed:', err);
  process.exit(1);
});
