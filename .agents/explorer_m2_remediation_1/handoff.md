# Handoff Report — Explorer M2 Remediation

**Agent ID**: `explorer_m2_remediation_1`  
**Milestone**: M2 (Mercado Pago Integration & Webhook Security)  
**Working Directory**: `c:/LUMINAPROJECT/.agents/explorer_m2_remediation_1`  
**Date**: 2026-08-16T21:53:00Z  
**Verdict**: `ANALYSIS_COMPLETE`

---

## 1. Observation

### Observation 1: Double-Booking under Dead-Heat Expired Hold Webhooks (`Adv-M2.5`)
- **Target File**: `src/server/routes/webhook.routes.ts`, lines 136–185
- **Command Executed**: `npx vitest run tests/adversarial/m2-concurrency-stress.test.ts -t "Adv-M2.5"`
- **Verbatim Error Output**:
  ```
  FAIL tests/adversarial/m2-concurrency-stress.test.ts > 2. Race Conditions between Expiration, Competing Locks & Late Webhooks > Adv-M2.5: Dead-heat simultaneous webhooks for two expired-hold orders on the same slot
  AssertionError: expected [ 'APPROVED', 'APPROVED' ] to include 'OVERBOOKED_NEEDS_RESCHEDULING'
    at tests/adversarial/m2-concurrency-stress.test.ts:381:24
  ```
- **Direct Code Finding**:
  In `src/server/routes/webhook.routes.ts`:
  1. Lines 136–159 check `slot.status` and invoke `SlotService.confirmBooking(order.slot_id, order.lock_token || undefined)` *before* entering `db.transaction()`.
  2. The boolean return value of `SlotService.confirmBooking` is ignored. If `confirmBooking` returns `false` (because another order holds the lock or slot is not available), `finalOrderStatus` remains `'APPROVED'`.
  3. When two webhooks arrive in parallel for two orders whose holds expired on the same slot, both webhooks proceed to mark their orders as `'APPROVED'` and commit `UPDATE orders SET status = 'APPROVED'`, leading to an unflagged double-booking.

### Observation 2: SQLite Unique Constraint Violation on Concurrent Duplicate Webhooks (`Adv-M2.7`)
- **Target File**: `src/server/routes/webhook.routes.ts`, lines 63–75 and 161–184
- **Direct Code Finding**:
  1. Step 2 performs a fast-path read on `webhook_events` before calling `await MercadoPagoService.fetchPaymentDetails(...)`.
  2. Because `fetchPaymentDetails` is asynchronous and suspends execution in the Node.js event loop / microtask queue, multiple simultaneous duplicate webhook requests with identical `mp_payment_id` pass Step 2 concurrently.
  3. The first transaction commits and inserts `evt_${paymentId}` into `webhook_events`.
  4. Subsequent concurrent transactions attempt `INSERT INTO webhook_events` with the same primary key without catching `ERR_SQLITE_ERROR: UNIQUE constraint failed: webhook_events.id`, causing Express to throw unhandled exceptions and return **HTTP 500 Internal Server Error**.

---

## 2. Logic Chain

1. **System Invariant (Zero Double-Booking)**: According to `ORIGINAL_REQUEST.md` (R2, R3) and `lumina-umay-booking-system-spec-v2.md` (§ Booking logic), live call slots must never be double-booked under any concurrent race conditions. If a payment arrives after a slot has been claimed or expired, it must be quarantined in `OVERBOOKED_NEEDS_RESCHEDULING`.
2. **Analysis of Adv-M2.5**:
   - In `webhook.routes.ts`, the slot occupancy verification and slot booking mutation were decoupled from the order update transaction and discarded the return code of `SlotService.confirmBooking`.
   - By encapsulating slot query, competing order check, conditional test-and-set slot update, and order status update inside a single SQLite atomic `BEGIN IMMEDIATE` transaction, transactions are strictly serialized. Exactly one transaction successfully acquires the slot and sets `status = 'APPROVED'`, while any subsequent/competing transaction detects occupancy or zero changes and transitions to `OVERBOOKED_NEEDS_RESCHEDULING`.
3. **Analysis of Adv-M2.7**:
   - Webhook idempotency deduplication across an asynchronous I/O boundary (`await fetchPaymentDetails`) requires a two-tier guard: a fast-path check before the async call and an in-transaction re-check after acquiring the transaction lock.
   - Using `INSERT OR IGNORE INTO webhook_events` combined with an in-transaction check guarantees that duplicate deliveries safely return HTTP 200 without throwing 500 errors or dispatching redundant notification emails.

---

## 3. Caveats

- **Database Engine**: The project uses Node.js `node:sqlite` / `better-sqlite3` with WAL mode enabled (`PRAGMA journal_mode = WAL`). Transactions initiated via `db.transaction()` use `BEGIN IMMEDIATE`, ensuring that write locks are acquired upfront, serializing concurrent writes without lock upgrade deadlocks.
- **Email Side-Effects**: To prevent phantom or duplicate emails, email dispatch (`EmailService.sendOrderNotificationToClaudia` and `EmailService.sendConfirmationToCustomer`) must occur strictly outside the database transaction, gated by `shouldSendEmail === true`.

---

## 4. Conclusion

The root causes of `Adv-M2.5` and `Adv-M2.7` have been completely diagnosed, and a mathematically rigorous remediation blueprint has been authored in `analysis.md`.

### Actionable Remediation Summary:
1. **In `src/server/routes/webhook.routes.ts`**:
   - Move all slot verification, competing order detection, conditional slot booking updates, order status mutations, and `webhook_events` recording into a unified synchronous `db.transaction()` block.
   - Inside the transaction, query `SELECT id FROM orders WHERE slot_id = ? AND status IN ('APPROVED', 'paid', 'approved') AND id != ?` and execute conditional slot update with `changes === 0` fallback to `OVERBOOKED_NEEDS_RESCHEDULING`.
   - Add in-transaction idempotency re-checking and switch all `INSERT INTO webhook_events` statements to `INSERT OR IGNORE INTO webhook_events`.
   - Dispatch customer and Claudia emails only once when `shouldSendEmail === true`.

---

## 5. Verification Method

Once the implementation is applied by the builder/remediation agent:

```powershell
# 1. Verify Adv-M2.5 specifically
npx vitest run tests/adversarial/m2-concurrency-stress.test.ts -t "Adv-M2.5"

# 2. Verify complete M2 concurrency & stress suite (12 tests)
npx vitest run tests/adversarial/m2-concurrency-stress.test.ts

# 3. Verify all 8 test files across the test suite
npm test

# 4. Verify 57 opaque-box E2E tests (Tiers 1-4)
node tests/e2e/run-all.js

# 5. Typecheck & Build
npm run typecheck
npm run build
```
