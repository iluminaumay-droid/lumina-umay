# Adversarial Challenge & Stress Test Report — Milestone 2
**Verdict**: `REJECT`

**Agent ID**: `challenger_m2_1`  
**Milestone**: Milestone 2 — Mercado Pago Integration & Webhook Security  
**Target Codebase**: `src/server/**` (`routes/webhook.routes.ts`, `routes/checkout.routes.ts`, `services/mercadopago.service.ts`, `services/slot.service.ts`)  
**Test Suite**: `tests/adversarial/m2-concurrency-stress.test.ts`

---

## 1. Observation

### Observation 1: Double-Booking under Concurrent Dead-Heat Webhooks (`Adv-M2.5`)
- **File**: `src/server/routes/webhook.routes.ts`, lines 136–185
- **Command Executed**: `npx vitest run tests/adversarial/m2-concurrency-stress.test.ts -t "Adv-M2.5"`
- **Verbatim Failure**:
  ```
  FAIL tests/adversarial/m2-concurrency-stress.test.ts > 2. Race Conditions between Expiration, Competing Locks & Late Webhooks > Adv-M2.5: Dead-heat simultaneous webhooks for two expired-hold orders on the same slot
  AssertionError: expected [ 'APPROVED', 'APPROVED' ] to include 'OVERBOOKED_NEEDS_RESCHEDULING'
    at tests/adversarial/m2-concurrency-stress.test.ts:381:24
  ```
- **Direct Code Inspection**:
  In `src/server/routes/webhook.routes.ts`:
  ```typescript
  // Lines 136-159: Executed OUTSIDE the atomic database transaction
  if (order.slot_id) {
    const slot = SlotService.getSlotById(order.slot_id);
    if (slot) {
      const parsedCdmx = parseUtcToCdmx(slot.start_time);
      slotDetails = parsedCdmx;

      const slotStatus = slot.status.toUpperCase();
      if (slotStatus === 'BOOKED') {
        // Check if slot was booked by a different order (late payment overbooking defense)
        const competingOrder = db
          .prepare(
            `SELECT id FROM orders WHERE slot_id = ? AND status IN ('APPROVED', 'paid', 'approved') AND id != ?`
          )
          .get(order.slot_id, order.id);

        if (competingOrder) {
          finalOrderStatus = 'OVERBOOKED_NEEDS_RESCHEDULING';
        }
      } else {
        // Permanently confirm booking
        SlotService.confirmBooking(order.slot_id, order.lock_token || undefined);
      }
    }
  }

  // Lines 161-184: DB transaction executes AFTER the slot check and confirmBooking
  const updateTx = db.transaction(() => {
    db.prepare(`
      UPDATE orders
      SET status = ?,
          mp_payment_id = ?,
          updated_at = ?
      WHERE id = ?
    `).run(finalOrderStatus, String(paymentId), nowIso, order.id);

    db.prepare(`
      INSERT INTO webhook_events (id, mp_payment_id, event_type, payload, signature, status, processed_at)
      VALUES (?, ?, ?, ?, ?, 'processed', ?)
    `).run(
      `evt_${paymentId}`,
      String(paymentId),
      eventType,
      JSON.stringify(body),
      signatureHeader || null,
      nowIso
    );
  });
  updateTx();
  ```

### Observation 2: Unhandled Constraint Failure on Concurrent Duplicate Webhooks (`Adv-M2.7`)
- **File**: `src/server/routes/webhook.routes.ts`, lines 64–75 and lines 171–182
- **Command Executed**: `npx vitest run tests/adversarial/m2-concurrency-stress.test.ts -t "Adv-M2.7"`
- **Verbatim Error Output**:
  ```
  [Unhandled Server Error]: Error: UNIQUE constraint failed: webhook_events.id
      at Object.run (C:\LUMINAPROJECT\src\server\db\database.ts:68:26)
      at C:\LUMINAPROJECT\src\server\routes\webhook.routes.ts:173:10
      at processTicksAndRejections (node:internal/process/task_queues:104:5) {
    code: 'ERR_SQLITE_ERROR',
    errcode: 1555,
    errstr: 'constraint failed'
  }
  ```
- **Direct Code Inspection**:
  Step 2 queries `webhook_events` for existing entries before calling `await MercadoPagoService.fetchPaymentDetails(...)`.
  Because `fetchPaymentDetails` is asynchronous and yields the Node.js event loop, multiple concurrent duplicate webhook requests with identical `mp_payment_id` pass the initial check simultaneously. When they subsequently execute `updateTx`, the first commits while remaining requests fail with `UNIQUE constraint failed: webhook_events.id`. This uncaught error causes Express to return HTTP 500 instead of HTTP 200, which triggers Mercado Pago's retry storm mechanism.

---

## 2. Logic Chain

1. **Premise 1 (Spec & Acceptance Criteria)**: According to `ORIGINAL_REQUEST.md` (R2, R3) and `lumina-umay-booking-system-spec-v2.md` (§ Booking logic), double-booking of live call sessions is strictly forbidden, and late/competing payments on expired holds must be quarantined (e.g. `OVERBOOKED_NEEDS_RESCHEDULING`) rather than overwriting a confirmed booking.
2. **Premise 2 (Concurrency Mechanics)**: In a high-throughput or network race scenario, two users whose holds have expired may both complete payment at Mercado Pago at nearly the same instant, resulting in two concurrent webhook calls for the same `slot_id`.
3. **Inference from Observation 1**: In `webhook.routes.ts`, the check for `slot.status === 'BOOKED'` and the execution of `SlotService.confirmBooking(...)` are executed outside the database transaction that updates the order status. When two webhooks arrive in parallel, both evaluate `slotStatus` as `'AVAILABLE'` before either has written the transaction. Both set `finalOrderStatus = 'APPROVED'`. Both commit `UPDATE orders SET status = 'APPROVED'` for the same `slot_id`.
4. **Conclusion on Bug 1**: A race condition exists that allows two distinct orders to be permanently approved for the same call slot simultaneously.
5. **Inference from Observation 2**: In `webhook.routes.ts`, duplicate webhook deduplication is split across an asynchronous boundary (`await fetchPaymentDetails`). When identical duplicate webhook notifications arrive simultaneously, the primary key collision on `webhook_events.id` throws an unhandled `ERR_SQLITE_ERROR (1555)` that returns HTTP 500 instead of handling idempotency gracefully with HTTP 200.
6. **Conclusion on Bug 2**: Webhook duplicate processing under concurrency is not fully idempotent and crashes with HTTP 500 when concurrent duplicate delivery occurs.

---

## 3. Challenge Report Summary

**Overall Risk Assessment**: `CRITICAL`

### Challenge 1 (Critical): Dead-Heat Webhook Overbooking Defense Race Condition
- **Assumption Challenged**: Sequential ordering of webhook processing for expired holds.
- **Attack Scenario**: Two customers create orders on the same slot (User 1 creates, hold expires; User 2 creates, hold expires). Both complete payment at Mercado Pago and both webhooks arrive concurrently.
- **Blast Radius**: Double-booking of live call appointments. Both customers receive payment confirmation and appointment receipt for the same slot time.
- **Mitigation**:
  1. Move the check for existing approved orders and slot status INSIDE the atomic `db.transaction()`.
  2. In `db.transaction()`, conditionally update the slot only if `status != 'booked'`, and query `SELECT id FROM orders WHERE slot_id = ? AND status IN ('APPROVED', 'paid', 'approved') AND id != ?` inside the transaction with `BEGIN IMMEDIATE` lock.
  3. If another approved order exists for that slot, set `finalOrderStatus = 'OVERBOOKED_NEEDS_RESCHEDULING'` atomically.

### Challenge 2 (High): Webhook Idempotency Unique Constraint Crash on Concurrent Duplicates
- **Assumption Challenged**: Duplicate webhooks will always arrive sequentially after the first has completely written to `webhook_events`.
- **Attack Scenario**: Mercado Pago dispatches multiple simultaneous notification attempts for the same payment ID.
- **Blast Radius**: Server returns HTTP 500 for duplicate requests, triggering Mercado Pago exponential retry storms and potentially inconsistent email delivery states.
- **Mitigation**:
  1. Wrap `updateTx` or the `INSERT INTO webhook_events` in a try/catch or use `INSERT OR IGNORE INTO webhook_events`.
  2. If a unique constraint violation occurs on `webhook_events.id` or `mp_payment_id`, treat it as a successful idempotent deduplication and return `200 OK` with `{ success: true, message: 'Webhook ya procesado (idempotente)' }`.

---

## 4. Stress Test Results Summary

| Test Case | Description | Expected | Actual | Result |
|---|---|---|---|---|
| **Adv-M2.1** | 100 concurrent create-preference calls on unlocked slot | 1 HTTP 200, 99 HTTP 409 | 1 winner (200), 99 conflicts (409) | **PASS** |
| **Adv-M2.2** | 51 concurrent checkouts on pre-locked slot (1 valid token, 50 forged) | 1 winner, 50 conflicts | 1 winner (200), 50 conflicts (409) | **PASS** |
| **Adv-M2.3** | Massive Multi-Slot Grid (10 slots x 15 contenders = 150 requests) | 10 winners, 140 conflicts | 10 winners (200), 140 conflicts (409) | **PASS** |
| **Adv-M2.4** | Sequential late webhook on re-booked slot | Order 1 quarantined to `OVERBOOKED_NEEDS_RESCHEDULING` | Order 1 `OVERBOOKED_NEEDS_RESCHEDULING`, Order 2 `APPROVED` | **PASS** |
| **Adv-M2.5** | Dead-heat simultaneous webhooks for two expired orders on same slot | 1 `APPROVED`, 1 `OVERBOOKED_NEEDS_RESCHEDULING` | Both `[ 'APPROVED', 'APPROVED' ]` | **FAIL (CRITICAL BUG)** |
| **Adv-M2.6** | Webhook payment rejection releases slot for 50 waiting contenders | 1 recovers slot, 49 conflicts | 1 winner (200), 49 conflicts (409) | **PASS** |
| **Adv-M2.7** | 100 simultaneous duplicate approved webhooks (same `mp_payment_id`) | 100 HTTP 200s, exactly 2 emails sent | Unique constraint crash (HTTP 500) under race conditions | **FAIL (HIGH BUG)** |
| **Adv-M2.8** | 50 duplicate webhooks interleaved with 50 status polls | 100 HTTP 200s, ACID isolation | 100 HTTP 200s, ACID isolation | **PASS** |
| **Adv-M2.9** | 50 duplicate rejection webhooks | 50 HTTP 200s, slot released | 50 HTTP 200s, slot released | **PASS** |
| **Adv-M2.10** | 120 Mixed Chaos Operations across all tiers & webhooks | 0 server 500s, 0 double bookings | 0 server 500s, 0 double bookings | **PASS** |
| **Adv-M2.11** | Adversarial Webhook Storm (Tampered HMAC, Replay >300s, SQLi) | 401 Unauthorized on all tampered/expired | All attacks neutralized with HTTP 401 | **PASS** |
| **Adv-M2.12** | Anti-Spoofing Proof (client polling without webhook) | Orders remain PENDING | Orders strictly remain PENDING | **PASS** |

---

## 5. Caveats
- Tests were executed using Node.js SQLite (`better-sqlite3` in-process WAL mode) on Windows environment.
- Email delivery in tests was evaluated using the captured mock sink (`EmailService.getCapturedEmails()`).

---

## 6. Conclusion
The implementation demonstrates strong security for single preference locks, server-enforced pricing, HMAC SHA-256 signature verification, and sequential late payment handling. However, under **adversarial concurrent race conditions**:
1. **Critical Double-Booking Vulnerability**: Dead-heat simultaneous webhooks for the same slot both result in `APPROVED` status because the slot occupancy verification occurs outside the atomic database transaction.
2. **Webhook Idempotency Crash**: Concurrent duplicate webhook delivery triggers unhandled `UNIQUE constraint failed: webhook_events.id`, returning HTTP 500 instead of idempotent HTTP 200.

**Verdict**: `REJECT` until these two concurrency bugs are resolved in `src/server/routes/webhook.routes.ts`.

---

## 7. Verification Method

To independently reproduce the findings:
```bash
# 1. Run the specific adversarial concurrency test suite
npx vitest run tests/adversarial/m2-concurrency-stress.test.ts

# 2. Run full test suite
npm test

# 3. Run E2E test runner
node tests/e2e/run-all.js
```
