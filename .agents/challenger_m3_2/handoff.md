# Adversarial Verification Handoff Report: Milestone 3 (Email Dispatcher Concurrency, Webhook Integration & MIME Encoding)

**Agent**: `challenger_m3_2`  
**Milestone**: Milestone 3 (Order Email Dispatcher)  
**Date**: 2026-08-16T20:13:00Z  
**Verdict**: **REJECT**  

---

## 1. Observation

### Executed Adversarial Test Suite
We designed, authored, and executed an empirical stress harness containing **16 adversarial test cases** in `tests/adversarial/m3-email-concurrency-stress.test.ts` to test high concurrency bursts, non-blocking execution, capture sink integrity, MIME formatting, and Mexican Spanish character encoding.

Command executed:
```bash
npx vitest run tests/adversarial/m3-email-concurrency-stress.test.ts
```

### Empirical Test Execution Results:
```
✓ tests/adversarial/m3-email-concurrency-stress.test.ts (16 tests | 1 failed) 597ms
  ✓ 1. High Concurrency Email Dispatch Burst Tests > Adv-M3.1: 50+ Concurrent Customer & Claudia Email Dispatches (100 total emails in a single burst) (19ms)
  ✓ 1. High Concurrency Email Dispatch Burst Tests > Adv-M3.2: 100+ Ultra-High Concurrency Burst (200 total emails) with Latency Measurement (4ms)
  ✓ 1. High Concurrency Email Dispatch Burst Tests > Adv-M3.3: Multi-Provider Concurrent Chaos Burst (Mock, Console, SMTP Fallback, Resend Fallback) (2ms)
  ✓ 2. Webhook Integration & Database Concurrency Stress > Adv-M3.4: 50 Concurrent Approved Webhook Notifications for 50 Distinct Orders trigger accurate email dispatching (152ms)
  ✓ 2. Webhook Integration & Database Concurrency Stress > Adv-M3.5: Webhook Email Fault Isolation (Resilience against Email Transport Crashes) (17ms)
  ✓ 3. MIME Body Consistency & Character Encoding Integrity > Adv-M3.6: Exhaustive Mexican Spanish Character & Accent Preservation (á, é, í, ó, ú, ñ, ¿, ¡, ü) (1ms)
  ✓ 3. MIME Body Consistency & Character Encoding Integrity > Adv-M3.7: Emojis, Unicode Symbols & Multiline Formatting in Plaintext & HTML (1ms)
  ✓ 3. MIME Body Consistency & Character Encoding Integrity > Adv-M3.8: XSS Injection & Payload Sanitization without Corrupting Surrounding Accents (1ms)
  ✓ 4. Tier-Specific Dynamic Template Compilation > Adv-M3.9: 1-Carta async template contains 24h SLA and excludes optional sections (1ms)
  ✓ 4. Tier-Specific Dynamic Template Compilation > Adv-M3.10: Call Session template includes CDMX appointment timing and excludes 24h SLA (1ms)
  ✓ 5. Boundary Payloads & Extreme Inputs > Adv-M3.11: Massive 10,000-Character Question Payload completes template compilation rapidly without stack overflow (1ms)
  ✓ 5. Boundary Payloads & Extreme Inputs > Adv-M3.12: Idempotent Webhook Replays do not send duplicate emails (14ms)
  ✓ 5. Boundary Payloads & Extreme Inputs > Adv-M3.13: 100 Mixed Multi-Tier Concurrent Webhooks with Soft-Locked Call Slots & Async Readings (255ms)
  × 5. Boundary Payloads & Extreme Inputs > Adv-M3.14: In-Memory Sink Accounting under Burst Identical Customer Names (6ms)
  ✓ 5. Boundary Payloads & Extreme Inputs > Adv-M3.15: Plaintext & HTML MIME Multipart Deep Syntax & UTF-8 Purity Inspection (1ms)
  ✓ 5. Boundary Payloads & Extreme Inputs > Adv-M3.16: Non-Blocking Webhook Execution with Simulated Network Latency in Email Transport (113ms)
```

### Verbatim Failure Output in Adv-M3.14:
```
FAIL tests/adversarial/m3-email-concurrency-stress.test.ts > Milestone 3 Adversarial & Concurrency Stress Suite: Email Dispatcher, Webhook Integration & MIME Encoding > 5. Boundary Payloads & Extreme Inputs > Adv-M3.14: In-Memory Sink Accounting under Burst Identical Customer Names
AssertionError: expected 3 to be 50 // Object.is equality

- Expected
+ Received

- 50
+ 3

 ❯ tests/adversarial/m3-email-concurrency-stress.test.ts:812:36
    810| 
    811|       expect(customerEmails.length).toBe(50);
    812|       expect(claudiaEmails.length).toBe(50);
       |                                    ^
    813|     });
```

### Observed Code in `src/server/services/email.service.ts`:
Lines 284–292:
```typescript
  /**
   * Internal helper to append captured email
   */
  static addCapturedEmail(email: CapturedEmail): void {
    // Avoid double recording if already recorded with same subject/date
    const exists = this.capturedEmails.some(
      (e) => e.to === email.to && e.subject === email.subject && e.date === email.date && e.provider === email.provider
    );
    if (!exists) {
      this.capturedEmails.push(email);
    }
  }
```

Lines 590–591 (`sendOrderNotificationToClaudia`):
```typescript
  const tierInfo = TIER_CONFIG[order.tier_id] || { name: order.tier_id, price: order.amount_mxn };
  const subject = `[Lumina Umay] Nueva Consulta Pagada: ${order.customer_name} (${tierInfo.name})`;
```

---

## 2. Logic Chain

1. **Root Cause of Sink Accounting Drop**:
   - `EmailService.addCapturedEmail` contains a duplicate check:
     `e.to === email.to && e.subject === email.subject && e.date === email.date && e.provider === email.provider`.
   - In Claudia's notification email, `to` is always `contacto@luminaumay.com`, and `subject` is derived from `order.customer_name` and `tierInfo.name` (it does **not** contain `order.id`).
   - In high-concurrency bursts (e.g. concurrent payments or multi-order submissions by the same customer, or load bursts), multiple orders resolve asynchronously within the exact same millisecond timestamp (`SlotService.getCurrentIso()`).
   - Because `(to, subject, date, provider)` are identical for all orders in that millisecond tick, `this.capturedEmails.some(...)` evaluates to `true` for all subsequent dispatches.
   - As a result, 47 out of 50 distinct Claudia consultation notification emails were silently dropped and lost from the sink, despite having different `order.id`, different questions, and different payment IDs.
2. **Robustness of Other Components**:
   - Webhook integration executes non-blocking dispatches outside SQLite transactions, commits `status = 'APPROVED'` and `email_sent = 1`, and successfully handles 100 simultaneous multi-tier webhooks (Adv-M3.13) in 255ms.
   - Fault isolation is verified: transport rejections/errors during email sending do not crash the webhook or rollback approved orders (Adv-M3.5).
   - Character encoding is pristine: all Spanish characters (`á, é, í, ó, ú, ñ, ¿, ¡, ü`) and emojis (`🔮, ✨, 🎴, 🕯️, 🧘‍♀️`) render accurately in both HTML and plaintext MIME bodies without corruption or HTML entities in plaintext (Adv-M3.6, Adv-M3.7, Adv-M3.15).

---

## 3. Caveats

- In production environments where real SMTP or Resend transport is used, emails are dispatched across external network sockets; however, `CapturedEmail` records in `EmailService.capturedEmails` are also used for local verification, test harness validation, and in-memory inspection.
- When customer names are distinct (e.g. `Customer 1`, `Customer 2`), subject lines differ, so deduplication does not trigger. The bug only manifests when the same customer name or identical subject is dispatched in a concurrent burst resolving in the same millisecond timestamp.

---

## 4. Conclusion

**Verdict: REJECT**

Milestone 3 is rejected due to a critical accounting flaw in `EmailService.addCapturedEmail`:
- **Vulnerability**: Heuristic deduplication `(to, subject, date, provider)` drops distinct order notifications under burst concurrency.
- **Actionable Remediation**:
  1. In `src/server/services/email.service.ts`, remove the false deduplication heuristic from `addCapturedEmail` (e.g. simply `this.capturedEmails.push(email);`, or check unique reference `!this.capturedEmails.includes(email)`, or check `body` equality if deduplication is required).
  2. Optionally append `[${order.id}]` to the subject line in `sendOrderNotificationToClaudia` (`[Lumina Umay] Nueva Consulta Pagada: ${order.customer_name} (${tierInfo.name}) [${order.id}]`) to prevent email threading collisions in practitioner inboxes.

---

## 5. Verification Method

To independently reproduce this failure:
```bash
# Run the adversarial suite
npx vitest run tests/adversarial/m3-email-concurrency-stress.test.ts
```
Expected output upon failure: `Adv-M3.14` fails with `expected 3 to be 50` received Claudia captured emails.

To verify the remediation:
1. Apply the fix to `src/server/services/email.service.ts`.
2. Run `npx vitest run tests/adversarial/m3-email-concurrency-stress.test.ts` (all 16 tests must pass).
3. Run `npm test` and `node tests/e2e/run-all.js` (all unit, adversarial, and E2E suites must pass 100%).
