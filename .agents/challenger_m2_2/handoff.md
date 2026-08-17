# Adversarial Security & Webhook Hardening Handoff Report (Milestone 2)

- **Agent**: challenger_m2_2 (Empirical Challenger)
- **Milestone**: Milestone 2 — Mercado Pago Integration & Webhook Security
- **Verdict**: **APPROVE**

---

## 1. Observation

### 1.1 Test Execution & Empirical Results
An extensive adversarial security stress harness was authored in `tests/adversarial/m2-security-stress.test.ts` (40 tests across 5 challenge domains).

#### A. Adversarial Security Stress Suite (`tests/adversarial/m2-security-stress.test.ts`)
```
Command: npx vitest run tests/adversarial/m2-security-stress.test.ts
Output:
 RUN  v3.2.7 C:/LUMINAPROJECT
 ✓ tests/adversarial/m2-security-stress.test.ts (40 tests) 426ms
 Test Files  1 passed (1)
      Tests  40 passed (40)
```

#### B. Full Opaque-Box E2E Test Suite (`node tests/e2e/run-all.js`)
```
Command: node tests/e2e/run-all.js
Output:
✔ Tier 1: Feature Coverage (147.3643ms)
✔ Tier 2: Boundary & Concurrency (188.8399ms)
✔ Tier 3: Cross-Feature Combinations & State Transitions (125.499ms)
✔ Tier 4: Real-World Application Scenarios (110.6243ms)
ℹ tests 57
ℹ suites 17
ℹ pass 57
ℹ fail 0
```

### 1.2 Verbatim Code Inspections

1. **HMAC SHA-256 Signature Verification (`src/server/services/mercadopago.service.ts:116-190`)**:
   - Parses manifest `id:[dataId];request-id:[requestId];ts:[ts];`.
   - Rejects non-numeric, malformed, or missing `ts` and `v1` headers.
   - Strictly enforces 300-second (5 minute) replay tolerance window:
     ```typescript
     const timeDiff = Math.abs(nowSeconds - tsNum);
     if (timeDiff > 300) {
       return {
         isValid: false,
         reason: `Timestamp outside 5-minute tolerance window (${timeDiff}s > 300s)`,
       };
     }
     ```
   - Uses constant-time `crypto.timingSafeEqual` comparison with length checks to prevent timing side-channel attacks.

2. **Server-Enforced Pricing Model (`src/server/routes/checkout.routes.ts:32-36`, `src/server/services/mercadopago.service.ts:42-65`)**:
   - Overrides any client-provided `amount`, `price`, `unit_price`, or `custom_price` with immutable `TIER_CONFIG[tier_id].price` ($150, $350, $500, $450 MXN).
   - Authoritative pricing is written directly to SQLite `orders.amount_mxn` and Mercado Pago Preference items.

3. **Strict Category & Gregorian Birthdate Validation (`src/server/validators/checkout.validator.ts:8-43`, `47-79`)**:
   - `category` is restricted to exact enum `['Amor', 'Trabajo/Dinero', 'Familia', 'Otro']`.
   - `isValidBirthdate` checks strict regex `^\d{4}-\d{2}-\d{2}$`, bounds (year >= 1900, month 1-12, day 1-31), leap year rules (e.g. 2000 & 2024 are valid; 1900 & 2023 Feb 29/30 are rejected; April/June/Sept/Nov 31 are rejected), and enforces strictly past dates (`dateObj.getTime() < now.getTime()`).

4. **Anti-Spoofing & Webhook State Machine (`src/server/routes/checkout.routes.ts:169-242`, `src/server/routes/webhook.routes.ts:33-240`)**:
   - `GET /api/orders/:order_id/status` is purely read-only and queries SQLite without mutating order status or slot holds.
   - Order confirmation and slot booking (`BOOKED`) require verified webhook HMAC signature and `payment.status === 'approved'`.

---

## 2. Logic Chain

1. **Cryptographic Integrity (Observation 1.1A, 1.2.1)**:
   - Single-bit flipping in the `v1` hash, forged secret keys, modified timestamps, non-hex characters, and truncated hash lengths all fail signature verification with explicit mismatch or malformed reasons.
   - HTTP POST to `/api/webhooks/mercadopago` with invalid signatures returns `HTTP 401 Unauthorized`.
   - Therefore, external attackers cannot forge Mercado Pago webhook notifications.

2. **Replay Defense & Deduplication (Observation 1.1A, 1.2.1, 1.2.4)**:
   - Timestamps older than 300 seconds (`now - 301s`) or skewed into the future (`now + 301s`) are rejected before cryptographic evaluation.
   - Within the tolerance window, duplicate approved notifications are recorded in `webhook_events` and deduplicated by `mp_payment_id`. Repeated webhooks return `HTTP 200 OK` ("Webhook ya procesado (idempotente)") without re-updating order status or re-dispatching notification emails (verified 1 Claudia + 1 Customer email sent).

3. **Price Manipulation Immunity (Observation 1.1A, 1.2.2)**:
   - Injected client amounts (`amount: 1`, `amount: 0`, `amount: -100`, `price: 1`, etc.) across all 4 tiers are completely disregarded.
   - Both the SQLite `orders` table and Mercado Pago preference payload reflect the canonical price ($150 for 1 carta, $350 for 3 cartas, $500 for 5 cartas, $450 for call).

4. **Input Injection & Schema Hardening (Observation 1.1A, 1.2.3)**:
   - SQL injection payloads (`' OR 1=1`, `DROP TABLE`, `UNION SELECT`) in `category` and `customer_birthdate` are intercepted by Zod and custom Gregorian validators, returning `HTTP 400 Bad Request`.
   - Invalid dates (Feb 30, non-leap year Feb 29, April 31, future dates) are systematically rejected.

5. **Anti-Spoofing & Status Safety (Observation 1.1A, 1.2.4)**:
   - Fabricated order IDs return `HTTP 404 Not Found`.
   - 50 rapid sequential status polling requests on pending orders maintain strict `PENDING` order state and `LOCKED` slot state. Status polling cannot bypass the payment requirement.

---

## 3. Caveats

- **External MP Sandbox Credentials**: In development/testing environments without live credentials, the application relies on the deterministic mock preference and signature engine; in production, `MP_ACCESS_TOKEN` and `MP_WEBHOOK_SECRET` must be provisioned in `.env`.
- **E-mail Server Connectivity**: Real SMTP/Resend delivery is decoupled and tested via captured email buffer; live network delivery depends on Milestone 3 provider configuration.

---

## 4. Conclusion

The Milestone 2 implementation for Mercado Pago integration, webhook signature validation, replay defense, price enforcement, and anti-spoofing meets and exceeds all security requirements specified in `PROJECT.md`, `lumina-umay-booking-system-spec-v2.md`, and `ORIGINAL_REQUEST.md`.

**Verdict**: **APPROVE**

---

## 5. Verification Method

To independently execute and verify all adversarial security checks and system tests:

```bash
# 1. Run the Milestone 2 Adversarial Security Stress Suite
npx vitest run tests/adversarial/m2-security-stress.test.ts

# 2. Run the Full Opaque-Box E2E Test Suite (Tiers 1-4)
node tests/e2e/run-all.js

# 3. Inspect the adversarial test implementation
cat tests/adversarial/m2-security-stress.test.ts
```

*Invalidation Conditions*: Any test failure, HTTP 200 on tampered webhook signature, acceptance of price tampering, acceptance of non-existent birthdates (Feb 30), or elevation of order status via polling.
