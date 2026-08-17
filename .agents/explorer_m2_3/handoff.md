# Handoff Report: Milestone 2 Technical Architecture & Verification

**Agent**: `explorer_m2_3`  
**Working Directory**: `c:/LUMINAPROJECT/.agents/explorer_m2_3`  
**Target Milestone**: Milestone 2 (Mercado Pago Integration & Webhook Security)  
**Date**: 2026-08-16T21:37:00Z  

---

## 1. Observation

1. **Database Schema Readiness**:
   - `src/server/db/schema.sql` (lines 24–70) defines `orders` and `webhook_events` tables with check constraints and index coverage (`idx_orders_status`, `idx_orders_mp_payment`, `idx_webhook_payment_id`, `idx_webhook_status`).
   - `src/server/db/types.ts` defines TypeScript interfaces for `Order`, `Slot`, and `WebhookEvent`.

2. **Milestone 1 Baseline & Concurrency Engine**:
   - `src/server/services/slot.service.ts` provides `acquireSoftLock`, `releaseSoftLock`, `confirmBooking`, `releaseExpiredLocks`, and `getAvailableSlots`.
   - All 52 Vitest unit and adversarial tests in `tests/unit/slot.service.test.ts`, `tests/unit/forensic-audit.test.ts`, and `tests/adversarial/` currently pass 100% (`npm test` returned exit code 0, 52 passed).

3. **E2E Test Suite Alignment**:
   - `tests/e2e/` (Tiers 1-4, 57 tests) currently validates all 4 product tiers, dynamic form boundaries, HMAC webhook authentication, idempotency on 5x duplicate deliveries, anti-spoofing status polling, and Mexican Spanish copy (`node tests/e2e/run-all.js` returned exit code 0, 57 passed).

4. **Missing Production Endpoints for Milestone 2**:
   - `src/server/routes/checkout.routes.ts` is not yet created.
   - `src/server/routes/webhook.routes.ts` is not yet created.
   - `src/server/services/mercadopago.service.ts` is not yet created.
   - `src/server/app.ts` does not yet mount `/api/checkout` and `/api/webhooks`.

---

## 2. Logic Chain

1. **Anti-Spoofing & Zero-Trust Redirect Security**:
   - Because clients can navigate directly to success redirect URLs without paying, frontend redirect callbacks must be treated as untrusted.
   - `GET /api/orders/:order_id/status` must strictly be a read-only database query.
   - Calling `GET /api/orders/:order_id/status` never transitions order status or confirms slot permanence. Only verified server-side webhook processing transitions status to `approved` / `paid`.

2. **HMAC-SHA256 Webhook Verification**:
   - Mercado Pago transmits `x-signature: ts=...,v1=...` and `x-request-id`.
   - Webhook security requires computing HMAC-SHA256 across `id:${data_id};request-id:${x_request_id};ts:${ts};` with `MP_WEBHOOK_SECRET` and timing-safe comparison to prevent forgery and tampering.

3. **Idempotency Guard**:
   - Mercado Pago may re-deliver webhooks multiple times.
   - Querying `webhook_events` for existing processed `payment_id` prevents double-confirming slots, duplicate status transitions, and duplicate email dispatches.

4. **Slot Locking & Webhook Fulfillment Lifecycle**:
   - On checkout creation (`POST /api/checkout/create-preference`), if tier is `llamada`, soft-lock is validated or auto-acquired (15m TTL).
   - On webhook `payment.status == 'approved'`, slot transitions permanently to `booked` via `SlotService.confirmBooking`. If the slot was stolen due to TTL expiration, the order is marked `OVERBOOKED_NEEDS_RESCHEDULING`.
   - On webhook `payment.status == 'rejected' | 'cancelled'`, slot is released back to `available` via `SlotService.releaseSoftLock`.

---

## 3. Caveats

1. **Email Dispatching Dependency (Milestone 3)**:
   - Webhook fulfillment triggers transactional emails. In Milestone 2 test environments, a mock email sink (in-memory captured emails) should be used until Milestone 3 implements production SMTP/Resend providers.
2. **Mercado Pago Live API vs Sandbox**:
   - In production, `MP_ACCESS_TOKEN` and `MP_WEBHOOK_SECRET` are required. In test/development mode, mock responses and signature bypass mechanisms allow offline unit and E2E verification.

---

## 4. Conclusion

Milestone 2 architecture is fully defined and documented in `c:/LUMINAPROJECT/.agents/explorer_m2_3/analysis.md`. The design guarantees zero-trust anti-spoofing security, strict server-enforced pricing ($150, $350, $500, $450), HMAC-SHA256 signature verification, idempotency deduplication, and complete compatibility with existing E2E and adversarial test suites.

---

## 5. Verification Method

### Test Execution Commands:
1. Run Unit & Concurrency Test Suites:
   ```powershell
   npm test
   ```
2. Run Master E2E Test Runner:
   ```powershell
   node tests/e2e/run-all.js
   ```
3. Typecheck Project:
   ```powershell
   npm run typecheck
   ```

### Invalidation Conditions:
- Any modification to `GET /api/orders/:order_id/status` that mutates database state on GET requests.
- Failure of HMAC signature verification on tampered headers.
- Duplicate email dispatches or duplicate slot mutations on re-delivered webhooks.
