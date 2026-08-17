# Handoff Report — Reviewer & Critic (Milestone 2)

**Subagent**: `reviewer_m2_1`  
**Milestone**: M2 — Mercado Pago Integration & Webhook Security  
**Working Directory**: `c:/LUMINAPROJECT/.agents/reviewer_m2_1`  
**Date**: 2026-08-16T21:45:00Z  
**Verdict**: `REQUEST_CHANGES`

---

## 1. Observation

### Verification Executions & Output:
1. `npm run typecheck`:
   - Command: `tsc --noEmit`
   - Exit Code: `0` (0 type errors)
2. `npm run build`:
   - Command: `tsc && node -e "..."`
   - Exit Code: `0` (Compilation and schema asset copy succeeded)
3. `node tests/e2e/run-all.js`:
   - Result: `17 suites passed, 57 tests passed, 0 failed` (100% passing across Tiers 1-4)
4. `npm test` (Vitest test suite):
   - Result: Exited with code `1` (Test failures detected in `tests/adversarial/m2-concurrency-stress.test.ts` and test runner collision under multi-file execution).

### Detailed Code Inspections:
1. `src/server/services/mercadopago.service.ts`:
   - **Zero-Trust Pricing Enforcement**: `createPreference` strictly binds unit prices from `TIER_CONFIG[order.tier_id].price` ($150 for `1_carta`, $350 for `3_cartas`, $500 for `5_cartas`, $450 for `llamada`/`call_session`). Client-supplied amounts are ignored.
   - **HMAC SHA-256 Signature Verification**: `verifySignature` parses `x-signature` header (`ts` and `v1`), builds the canonical manifest string `id:[dataId];request-id:[requestId];ts:[ts];`, and verifies timestamp against a 300-second tolerance window.
   - **Timing Attack Defense**: Buffer length is checked prior to comparison (`computedHash.length !== v1.length`), followed by constant-time buffer comparison via `crypto.timingSafeEqual(Buffer.from(computedHash, 'utf8'), Buffer.from(v1, 'utf8'))`.
2. `src/server/validators/checkout.validator.ts`:
   - **Calendar & Leap Year Validation**: `isValidBirthdate` accurately validates strict Gregorian dates (rejects non-existent calendar dates like `2023-02-29`, `2023-02-30`, `2023-04-31`, future dates, and pre-1900 dates).
   - **Tier-Specific Dynamic Requirements**: `5_cartas` requires `core_focus` ("Qué es lo que más deseas saber"), and `llamada` requires `slot_id`.
   - **Localization**: Error messages are written in natural Mexican Spanish.
3. `src/server/routes/checkout.routes.ts`:
   - `POST /api/checkout/create-preference` handles slot hold acquisition, verifies competing lock tokens, creates pending orders, and interacts with Mercado Pago.
   - `GET /api/orders/:order_id/status` is strictly read-only and safe from state mutation / spoofing.
4. `src/server/routes/webhook.routes.ts`:
   - Lines 155–158:
     ```ts
     // Permanently confirm booking
     SlotService.confirmBooking(order.slot_id, order.lock_token || undefined);
     ```
     The boolean return value of `SlotService.confirmBooking` is ignored. When two orders with expired holds on the same slot complete payment and their webhooks arrive simultaneously, both orders transition to `APPROVED`, resulting in an unflagged double-booking.

---

## 2. Logic Chain

1. **Security & Cryptographic Robustness (Passed)**:
   - HMAC SHA-256 signature verification in `mercadopago.service.ts` correctly hashes the required manifest format, enforces a 300s replay window, and uses `crypto.timingSafeEqual`. Tampered signatures or manipulated timestamps return HTTP 401.
   - The pricing matrix is strictly enforced server-side. Tampered client amounts (e.g. $1 or $9999) have zero effect on created preferences or stored orders.
   - Polling `/api/orders/:order_id/status` never mutates order status, ensuring clients cannot elevate unverified payments.

2. **Input Validation & Localization (Passed)**:
   - Zod schemas in `checkout.validator.ts` validate all fields with authentic Mexican Spanish error messages.
   - Date validation correctly validates Gregorian calendar boundaries including leap years.

3. **Concurrency Defect in Webhook State Machine (Failed - Action Required)**:
   - In `src/server/routes/webhook.routes.ts`, `SlotService.confirmBooking` returns `true` if the slot status was successfully updated to `booked` and `false` if the slot was already claimed/booked or the lock token did not match.
   - Because `webhook.routes.ts` does not check the return value of `SlotService.confirmBooking`, if Order A and Order B both had expired holds on the same slot and both webhooks execute in a dead heat:
     - Order A confirms the slot (`confirmBooking` returns `true`), updating Order A to `APPROVED`.
     - Order B fails to confirm the slot (`confirmBooking` returns `false`), but `webhook.routes.ts` proceeds to mark Order B as `APPROVED` instead of transitioning Order B to `OVERBOOKED_NEEDS_RESCHEDULING`.
   - This causes test `Adv-M2.5` in `tests/adversarial/m2-concurrency-stress.test.ts` to fail: `expected [ 'APPROVED', 'APPROVED' ] to include 'OVERBOOKED_NEEDS_RESCHEDULING'`.

---

## 3. Caveats

- In test/development mode without production Mercado Pago credentials, `MercadoPagoService` uses a mock fallback that preserves full preference and webhook workflow semantics.
- Vitest parallel execution against a single SQLite database file causes database reset collisions across concurrently running test files.

---

## 4. Conclusion & Findings

### Verdict: `REQUEST_CHANGES`

### Findings:

#### 1. [Critical] Dead-Heat Webhook Race Condition on Slot Confirmation
- **What**: Webhook handler ignores the boolean result of `SlotService.confirmBooking`, causing duplicate `APPROVED` orders on the same slot when concurrent webhooks arrive for expired holds.
- **Where**: `src/server/routes/webhook.routes.ts:155-158`
- **Why**: Violates the zero double-booking invariant. If a competing customer has already booked the slot, a late/competing payment must transition to `OVERBOOKED_NEEDS_RESCHEDULING`.
- **Suggested Fix**:
  ```ts
  const booked = SlotService.confirmBooking(order.slot_id, order.lock_token || undefined);
  if (!booked) {
    finalOrderStatus = 'OVERBOOKED_NEEDS_RESCHEDULING';
  }
  ```

#### 2. [Major] Vitest Test Suite Isolation / Concurrency Configuration
- **What**: Running `npm test` encounters cross-file database lock / data reset collisions when multiple test files run against the shared SQLite file `data/lumina_umay.sqlite`.
- **Where**: `vitest.config.ts` and `package.json`
- **Why**: Causes spurious test failures when all test files run together.
- **Suggested Fix**: Configure Vitest to run test files sequentially with isolated DB instances or with `--pool=forks --poolOptions.forks.singleFork=true --fileParallelism=false`.

#### 3. [Minor] Scratch Diagnostic File Left in Repository
- **What**: `tests/adversarial/diag.test.ts` is present in the repository.
- **Where**: `tests/adversarial/diag.test.ts`
- **Why**: Temporary scratch files should not pollute the test suite.
- **Suggested Fix**: Remove `tests/adversarial/diag.test.ts`.

---

## 5. Verification Method

To reproduce findings and verify fixes:

```powershell
# 1. Typecheck
npm run typecheck

# 2. Build
npm run build

# 3. Opaque-Box E2E Tests (57 tests)
node tests/e2e/run-all.js

# 4. Adversarial Webhook Concurrency Test
npx vitest run tests/adversarial/m2-concurrency-stress.test.ts -t "Adv-M2.5"

# 5. Full Vitest Test Suite
npm test
```
