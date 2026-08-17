## 2026-08-16T21:36:57Z
You are worker_m2_1 for Lumina Umay Milestone 2 (Mercado Pago Integration & Webhook Security).

Your working directory is c:/LUMINAPROJECT/.agents/worker_m2_1.
Read the authoritative project files before starting:
- c:/LUMINAPROJECT/ORIGINAL_REQUEST.md
- c:/LUMINAPROJECT/lumina-umay-booking-system-spec-v2.md
- c:/LUMINAPROJECT/PROJECT.md
- c:/LUMINAPROJECT/.agents/explorer_m2_1/analysis.md & handoff.md
- c:/LUMINAPROJECT/.agents/explorer_m2_2/analysis.md & handoff.md
- c:/LUMINAPROJECT/.agents/explorer_m2_3/analysis.md & handoff.md
- c:/LUMINAPROJECT/src/server/

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Your task:
Implement Milestone 2 per the architecture and specifications:
1. `src/server/validators/checkout.validator.ts`:
   - Zod validation for preference creation with Mexican Spanish error messages.
   - Validation of `tier_id` ('1_carta' | '3_cartas' | '5_cartas' | 'llamada' | 'call_session').
   - `category` ('Amor' | 'Trabajo/Dinero' | 'Familia' | 'Otro').
   - `customer_birthdate` (valid ISO YYYY-MM-DD, past date, year >= 1900, real calendar days - rejecting Feb 30, etc.).
   - Required `core_focus` for 5 cartas (`Qué es lo que más deseas saber`).
   - Slot ID and lock token handling for call session.
2. `src/server/services/mercadopago.service.ts`:
   - Preference creation with server-enforced pricing ($150, $350, $500, $450 MXN). Never trust client amounts.
   - HMAC SHA-256 webhook signature verification (`x-signature` header with `ts` and `v1`, manifest `id:...;request-id:...;ts:...;`, 300s replay attack window, constant-time comparison).
   - Server-to-server payment verification (`/v1/payments/{payment_id}`) with robust fallback for offline/test environments.
3. `src/server/routes/checkout.routes.ts`:
   - `POST /api/checkout/create-preference`: validate input, reserve/verify slot hold for call tier, insert order in `orders` table (`status = 'pending'`), generate MP preference, return `{ success: true, order_id, preference_id, init_point, sandbox_init_point, amount }`.
   - `GET /api/orders/:order_id/status`: read-only safe polling endpoint returning status, tier_id, Mexican Spanish turnaround message (24h async SLA vs call appointment details), slot information, and amount.
4. `src/server/routes/webhook.routes.ts`:
   - `POST /api/webhooks/mercadopago`: verify HMAC signature, check idempotency in `webhook_events` table (prevent duplicate order/slot/email processing), query payment status, update order to `paid` or `failed`/`cancelled`, permanently confirm slot in `SlotService` on `approved` (or handle overbooking `OVERBOOKED_NEEDS_RESCHEDULING` if slot hold expired and was stolen), release slot on `rejected`/`cancelled`, and record processed event in `webhook_events`.
5. `src/server/app.ts`:
   - Mount checkout routes on `/api/checkout` and `/api/orders` (for order status), and webhook routes on `/api/webhooks`.
6. Unit Tests:
   - Add unit tests in `tests/unit/checkout.service.test.ts` and `tests/unit/webhook.security.test.ts` testing pricing enforcement, HMAC signature validation, tampered signature rejection, idempotency on 5x duplicate deliveries, anti-spoofing read-only behavior, and slot booking lifecycle.

Verification commands you MUST run and report:
1. `npm run typecheck`
2. `npm run build`
3. `npm test`
4. `node tests/e2e/run-all.js`

Write your full implementation summary and test results to `c:/LUMINAPROJECT/.agents/worker_m2_1/handoff.md`.
Use `send_message` to report your completion back to the orchestrator.
