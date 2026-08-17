# Milestone 2 Handoff Report: Mercado Pago Preference Creation & Order Management

**Agent**: explorer_m2_1  
**Working Directory**: `c:/LUMINAPROJECT/.agents/explorer_m2_1`  
**Parent**: Orchestrator (`96f9d696-c5fb-4702-8b8c-14e059ce576a`)  
**Milestone**: M2 — Mercado Pago Integration & Webhook Security  

---

## 1. Observation

1. **Spec & Requirement Contracts**:
   - `c:/LUMINAPROJECT/ORIGINAL_REQUEST.md` (Lines 12–20, 30–33, 42–46) specifies 4 tiers:
     - 1 Carta: $150 MXN (Fields: Nombre, Fecha de nacimiento, Pregunta, Categoría)
     - 3 Cartas: $350 MXN (Additional optional field: Nombre de la persona involucrada)
     - 5 Cartas: $500 MXN (Additional mandatory field: Qué es lo que más deseas saber)
     - Sesión por llamada: $450 MXN (Mandatory slot selection and concurrency hold)
   - `c:/LUMINAPROJECT/PROJECT.md` (Lines 45–56, 72–79) defines Interface Contracts:
     - `POST /api/checkout/create-preference`: Body `{ tier_id, category, customer_name, customer_email, customer_birthdate, question, involved_names?, core_focus?, slot_id?, lock_token? }` $\rightarrow$ Returns `{ success: true, order_id, preference_id, init_point, sandbox_init_point, amount }`.
     - `GET /api/orders/:order_id/status`: Returns `{ success: true, order_id, status, tier_id, turnaround_message, slot, amount }`.

2. **Existing Database Schema & Infrastructure**:
   - `c:/LUMINAPROJECT/src/server/db/schema.sql` (Lines 24–47) already defines the `orders` table with columns: `id`, `tier_id`, `category`, `amount_mxn`, `customer_name`, `customer_email`, `customer_phone`, `customer_birthdate`, `question`, `involved_names`, `core_focus`, `slot_id`, `lock_token`, `mp_preference_id`, `mp_payment_id`, `status`, `email_sent`, `customer_email_sent`, `notes`, `created_at`, `updated_at`.
   - `c:/LUMINAPROJECT/src/server/db/database.ts` (Lines 19–104) provides WAL mode SQLite transactions via `LuminaDatabase` and `db.prepare()`.
   - `c:/LUMINAPROJECT/src/server/services/slot.service.ts` (Lines 120–174) provides atomic slot locking (`acquireSoftLock`), auto-sweeping of expired holds, and CDMX timezone conversion.

3. **E2E & Adversarial Test Contracts**:
   - `c:/LUMINAPROJECT/tests/e2e/tier1-feature-coverage.test.js` (Lines 39–441) strictly validates:
     - Price tampering resistance (Lines 103–116, 200–212, 294–307, 401–419): Client `amount` parameter must be completely ignored.
     - 24-hour turnaround notice for async readings (Lines 118–134, 214–227, 309–323): `"Responderemos en un plazo máximo de 24 horas a tu correo electrónico con tu lectura."`.
     - Mexican Spanish validation error messages on missing/invalid fields (e.g. `pregunta`, `fecha de nacimiento`, `nombre`, `deseas saber`, `horario`, `categoría`).
   - `c:/LUMINAPROJECT/tests/e2e/tier2-boundary-concurrency.test.js` (Lines 95–142) tests calendar boundary checks (rejects `2050-01-01`, `2023-02-30`, `31-12-1990`) and category enum injection defense.
   - `c:/LUMINAPROJECT/tests/e2e/tier4-real-world-scenarios.test.js` (Lines 235–299) tests late payment overbooking handling where `status` is handled as `OVERBOOKED_NEEDS_RESCHEDULING` or `APPROVED` without corrupting active slot holds.

4. **SDK & Dependencies**:
   - `c:/LUMINAPROJECT/package.json` (Lines 20–27) includes `mercadopago: ^2.0.15`, `uuid: ^11.0.5`, `zod: ^3.24.2`, `express: ^4.21.2`.

---

## 2. Logic Chain

1. **From Zero-Trust Pricing to Implementation**:
   - Observation 1 & 3 show that clients could send tampered amounts.
   - Therefore, `OrderService` must maintain an immutable server-side price map (`{ '1_carta': 150, '3_cartas': 350, '5_cartas': 500, 'llamada': 450, 'call_session': 450 }`).
   - Any client-submitted `amount` in `req.body` must be ignored during calculation and SQLite insertion.

2. **From Category & Form Fields to Zod Validation**:
   - Observation 1 & 3 require strict Mexican Spanish error responses on validation failures.
   - Therefore, a Zod schema `CreatePreferenceSchema` with custom refinement for `customer_birthdate` (valid ISO format `YYYY-MM-DD`, calendar validity via Date parsing, date in past, year $\ge 1900$), `category` enum (`'Amor' | 'Trabajo/Dinero' | 'Familia' | 'Otro'`), conditional `core_focus` for `5_cartas`, and conditional `slot_id` for `llamada` will catch all boundary errors before database writes.

3. **From Slot Soft-Locking to Preference Creation**:
   - Observation 2 & 3 show that call sessions must reserve a slot before checkout.
   - If `tier_id === 'llamada'` or `'call_session'`:
     - If slot is already locked with a valid `lock_token`, reuse the hold.
     - If slot is available (or previous hold expired), atomically lock it using `SlotService.acquireSoftLock(slot_id, 15)`.
     - If slot is already permanently booked or locked by another user, throw `SlotConflictError` (HTTP 409).

4. **From Preference Creation to DB Persistence**:
   - Observation 2 shows the `orders` table structure.
   - `OrderService.createPreference()` will insert the order with status `pending` (or `PENDING`), generate/retrieve the Mercado Pago preference using `MercadoPagoService`, update `mp_preference_id`, and return `{ success: true, order_id, preference_id, init_point, sandbox_init_point, amount }`.

5. **From Polling Endpoint to Post-Payment State Verification**:
   - Observation 1, 2 & 3 show that clients poll `GET /api/orders/:order_id/status` rather than relying on browser redirects.
   - The status endpoint must query the `orders` table, load associated slot information for calls, and compute the appropriate Mexican Spanish turnaround SLA (`24 horas` for async readings, or confirmed appointment string for live calls).

---

## 3. Caveats

1. **Email Dispatching**: Handled under Milestone 3 (M3). During M2 preference creation, `email_sent` and `customer_email_sent` in the database are initialized to `0`.
2. **Mercado Pago Webhook Verification & HMAC Auth**: Explored in detail by peer agent / companion analysis (`explorer_m2_2`), focusing on `POST /api/webhooks/mercadopago`, HMAC `x-signature` validation, and double-checking via `/v1/payments/{id}`.
3. **Environment Credentials**: In testing / offline development where `MP_ACCESS_TOKEN` is unset or mock credentials are used, `MercadoPagoService` must seamlessly generate valid mock preferences (`pref_...`) and standard redirect URLs so CI and unit/E2E suites run deterministically without internet access.

---

## 4. Conclusion

The technical blueprint for Milestone 2 Preference Creation & Order Management is complete:
1. **Endpoint `POST /api/checkout/create-preference`**: Implemented with Zod validation, Spanish error messages, server-side price enforcement ($150, $350, $500, $450), and atomic slot validation.
2. **Service Layer**:
   - `src/server/services/order.service.ts`: Handles SQLite order persistence and status polling.
   - `src/server/services/mercadopago.service.ts`: Wraps Mercado Pago SDK v2 / REST preference creation and payment lookups with mock fallback.
3. **Validation & Types**:
   - `src/server/validators/checkout.validator.ts`: Comprehensive schema validation.
   - `src/server/types/checkout.types.ts`: Domain models and DTO interfaces.
4. **Routes**:
   - `src/server/routes/checkout.routes.ts`: Exposes `/api/checkout/create-preference` and `/api/orders/:order_id/status`.

---

## 5. Verification Method

To independently verify the preference creation and order management architecture:

1. **Inspect Artifacts**:
   - `c:/LUMINAPROJECT/.agents/explorer_m2_1/analysis.md`
   - `c:/LUMINAPROJECT/src/server/db/schema.sql`
   - `c:/LUMINAPROJECT/src/server/services/slot.service.ts`

2. **Run Existing Test Suites**:
   - Vitest unit and adversarial tests:
     ```powershell
     npx vitest run tests/adversarial/concurrency-stress.test.ts
     npx vitest run tests/adversarial/challenger2-m1-boundary-stress.test.ts
     ```
   - E2E Test runner against reference mock server:
     ```powershell
     node tests/e2e/run-all.js
     ```

3. **Invalidation Conditions**:
   - If any client-submitted `amount` can alter the charged price $\rightarrow$ Invalidation.
   - If a 5-cards reading can be submitted without `core_focus` $\rightarrow$ Invalidation.
   - If an invalid birthdate (e.g. `2023-02-30` or future year) succeeds with HTTP 200 $\rightarrow$ Invalidation.
   - If a call session can create a preference on an already booked or un-held slot $\rightarrow$ Invalidation.
