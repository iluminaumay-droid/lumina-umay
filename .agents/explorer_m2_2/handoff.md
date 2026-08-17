# Handoff Report: Milestone 2 — Mercado Pago Webhook Security, Verification & Idempotency Engine

**Author**: `explorer_m2_2`  
**Recipient**: `orchestrator_1` / Milestone 2 Implementers  
**Working Directory**: `c:/LUMINAPROJECT/.agents/explorer_m2_2`  
**Date**: 2026-08-16T21:36:30Z  

---

## 1. Observation

1. **Authoritative Requirements & Specifications**:
   - `c:/LUMINAPROJECT/ORIGINAL_REQUEST.md`: Requirement R3 mandates that "Orders and slot locks must strictly only be confirmed when the webhook validates an `approved` payment status."
   - `c:/LUMINAPROJECT/lumina-umay-booking-system-spec-v2.md` § Mercado Pago integration: "Use a webhook/notification callback from Mercado Pago to confirm payment server-side — do not trust the frontend 'payment successful' redirect alone, since that can be reached without actually paying."
   - `c:/LUMINAPROJECT/PROJECT.md`: Feature 7 (HMAC SHA-256 webhook validation), Feature 8 (Server Payment Double-Check `/v1/payments/{id}`), Feature 9 (Webhook Idempotency guard table), Feature 10 (Anti-Spoofing Status API).

2. **Existing Codebase State**:
   - `c:/LUMINAPROJECT/src/server/app.ts` (lines 24–30): JSON body parser is already configured with rawBody retention for webhook HMAC signature verification:
     ```typescript
     app.use(
       express.json({
         limit: '2mb',
         verify: (req: Request & { rawBody?: Buffer }, _res: Response, buf: Buffer) => {
           req.rawBody = buf;
         },
       })
     );
     ```
   - `c:/LUMINAPROJECT/src/server/db/schema.sql` (lines 55–69): `webhook_events` table already created with SQLite index on `mp_payment_id` and `status`:
     ```sql
     CREATE TABLE IF NOT EXISTS webhook_events (
         id TEXT PRIMARY KEY,
         mp_payment_id TEXT NOT NULL,
         event_type TEXT NOT NULL,
         payload TEXT NOT NULL,
         signature TEXT,
         status TEXT NOT NULL CHECK(status IN ('processed', 'ignored', 'failed')),
         error_message TEXT,
         processed_at TEXT,
         created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     );
     ```
   - `c:/LUMINAPROJECT/src/server/services/slot.service.ts` (lines 208–242): `SlotService.confirmBooking(slotId, lockToken)` permanently transitions slots from `locked` / `available` to `booked`, clearing `lock_expires_at`.
   - `c:/LUMINAPROJECT/package.json`: `mercadopago: ^2.0.15` and `nodemailer: ^6.10.0` are installed.

3. **Test Infrastructure & Verification Scenarios**:
   - `c:/LUMINAPROJECT/tests/e2e/helpers/mock-server.js` (lines 437–533): Outlines the reference behavior for `POST /api/webhooks/mercadopago`, including HMAC header rejection (`invalid_signature`), idempotency caching, slot permanence, overbooking collision detection (`OVERBOOKED_NEEDS_RESCHEDULING`), and email queuing.
   - `c:/LUMINAPROJECT/tests/e2e/tier2-boundary-concurrency.test.js`: Validates tamper detection (`T2.11`, HTTP 401), anti-spoofing (`T2.10`, HTTP 200 `PENDING`), and declined payments (`T2.12`, `REJECTED`).
   - `c:/LUMINAPROJECT/tests/e2e/tier3-cross-feature.test.js`: Validates slot lock to webhook approval (`T3.2`), slot release on rejection/cancellation (`T3.3`, `T3.4`), and 5x webhook deduplication (`T3.5`).
   - `c:/LUMINAPROJECT/tests/e2e/tier4-real-world-scenarios.test.js`: Validates full async & call lifecycles, and late payment overbooking defense (`T4.4`).

---

## 2. Logic Chain

1. **Zero-Trust Client Invariant**:
   From Observation 1 and 2, clients may navigate to `/checkout/success` at any time without completing payment. Therefore, `GET /api/orders/:id/status` must strictly derive status from the database, and orders remain `PENDING` until a valid webhook arrives.

2. **HMAC Signature & Timing Security**:
   From Observation 2 and 3, Mercado Pago webhook notifications carry an `x-signature` header (`ts=...,v1=...`) and an `x-request-id` header. The manifest `id:${dataId};request-id:${xRequestId};ts:${ts};` must be signed using HMAC SHA-256 with `MP_WEBHOOK_SECRET`. Replay attacks are mitigated by enforcing a 300-second (5 minute) tolerance window between `ts` and current virtual/system time. Constant-time comparison (`crypto.timingSafeEqual`) prevents timing side-channel exploits.

3. **Authoritative Server Double-Check**:
   Webhooks serve as triggers. Direct verification via `GET https://api.mercadopago.com/v1/payments/{payment_id}` confirms `status === 'approved'`, currency `MXN`, and the server-enforced amount ($150, $350, $500, or $450). In test/offline environments, fallback inspection of the webhook payload guarantees CI resilience without external network dependencies.

4. **Idempotency & Concurrency Guarantees**:
   Mercado Pago retries webhook deliveries if network jitter occurs. By recording every processed notification in `webhook_events` with `mp_payment_id` and wrapping order updates in SQLite `BEGIN IMMEDIATE` transactions, duplicate deliveries return HTTP 200 immediately without re-triggering slot changes or duplicate emails.

5. **Slot Permanence & Overbooking Armor**:
   When payment is approved on a call session, `SlotService.confirmBooking(slot_id, lock_token)` sets `status = 'booked'`. If the user paid late after their hold TTL expired and another user subsequently booked the slot, `confirmBooking` fails. The engine catches this, preserves the legitimate booking, sets the late order's status to `OVERBOOKED_NEEDS_RESCHEDULING`, and alerts practitioner Claudia.

---

## 3. Caveats

1. **Email Dispatcher Scope**:
   Email formatting templates and multi-provider (SMTP vs Resend) infrastructure belong to Milestone 3. Webhook fulfillment in M2 initiates notifications via a mock capture sink (`capturedEmails`) or stubbed service, ensuring E2E assertions pass without requiring live SMTP credentials.
2. **Preference Creation Scope**:
   Creation of Checkout Pro preferences (`POST /api/checkout/create-preference`) and client form validation is explored by peer agent `explorer_m2_1`. The webhook engine interfaces directly with the `orders` records created by the preference endpoint via `external_reference = order.id`.
3. **Time Travel in Tests**:
   Virtual time advancement for testing (`SlotService.advanceTime`) alters virtual epoch calculations. The HMAC signature verifier must query `SlotService.getCurrentTime()` rather than raw `Date.now()` so that virtual time offsets in tests do not falsely trigger timestamp tolerance expiry.

---

## 4. Conclusion

The technical specification and architecture for Milestone 2 Webhook Integration is fully defined and ready for immediate implementation by `worker_m2_1`.

### Concrete Components to Implement:
1. **`src/server/services/mercadopago.service.ts`**:
   - `verifySignature(signatureHeader, requestIdHeader, dataId, secret)` with 300s window & constant-time comparison.
   - `fetchPaymentDetails(paymentId, fallbackPayload)` with REST API query & mock fallback.
2. **`src/server/routes/webhook.routes.ts`**:
   - `POST /api/webhooks/mercadopago` controller handling signature check, idempotency check, payment double-check, order status transition, slot permanent confirmation/release, and email triggering.
3. **`src/server/app.ts`**:
   - Mount `app.use('/api/webhooks', webhookRouter)`.
4. **`src/server/routes/test.routes.ts`**:
   - Expose captured mock email endpoint `GET /api/test/emails` linked to email dispatch sink.

---

## 5. Verification Method

To independently verify the implementation:

1. **Unit & Adversarial Tests (Vitest)**:
   ```bash
   npm test
   ```
   *Expected Result*: All 52+ unit and concurrency stress tests pass (0 failures).

2. **End-to-End Test Suite (Node Test Runner)**:
   ```bash
   node tests/e2e/run-all.js
   ```
   *Expected Result*: 57 passing tests across Tiers 1 through 4.

3. **Live Server E2E Verification**:
   ```bash
   # In terminal 1:
   npm run dev
   # In terminal 2:
   TEST_BASE_URL=http://localhost:3000 node tests/e2e/run-all.js
   ```
   *Expected Result*: All 57 tests pass against the live Express server instance.

4. **Invalidation Conditions**:
   - Webhook accepts tampered `x-signature` header (fails `T2.11`).
   - Webhook processes duplicate deliveries multiple times and sends duplicate emails (fails `T3.5`).
   - Unapproved payment status (`rejected`/`cancelled`) confirms order or locks slot (fails `T2.12`, `T3.3`).
   - Overbooking collision during late payment overwrites legitimate booking or crashes (fails `T4.4`).
