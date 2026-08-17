# Empirical Adversarial Analysis — Milestone 3 (Email Dispatcher)

## 1. Executive Summary & Verdict
- **Verdict**: **REJECT**
- **Reason**: Discovered an empirical bug in `src/server/services/email.service.ts` (`EmailService.addCapturedEmail`) where concurrent email dispatches to Claudia with identical customer names / subjects during the same millisecond timestamp result in silent email drop / loss (48 out of 50 emails dropped in `Adv-M3.14`).
- **All other M3 components**: Provider fallbacks (SMTP/Resend), XSS sanitization (`escapeHtml`), Mexican Spanish copy fidelity ("24 horas", "Con luz, gratitud y bendiciones, Claudia — Lumina Umay"), and template rendering engines were verified as fully functional and robust.

---

## 2. Empirical Test Execution Log

### Test Suites Executed:
1. `tests/unit/email.service.test.ts` (21 tests) — **PASSED**
2. `tests/adversarial/m3-email-adversarial.test.ts` (20 tests) — **PASSED**
3. `.agents/challenger_m3_1/empirical_harness.ts` (13 tests) — **PASSED**
4. `tests/adversarial/m3-email-concurrency-stress.test.ts` (16 tests, 1 failed: `Adv-M3.14`) — **FAILED**

---

## 3. Detailed Forensic Findings

### Finding 1: Flawed De-duplication in In-Memory Captured Email Sink (CRITICAL)
- **File**: `src/server/services/email.service.ts` (Lines 284–292)
- **Observed Code**:
  ```typescript
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
- **Failure Mode Observed**:
  In test `Adv-M3.14` (`tests/adversarial/m3-email-concurrency-stress.test.ts`), 50 concurrent orders were generated with identical customer names (`María Fernanda Garza`) and tier (`1_carta`).
  Claudia's notification subject line evaluates to:
  `[Lumina Umay] Nueva Consulta Pagada: María Fernanda Garza (Lectura de 1 Carta)`
  Because all 50 dispatches resolve within the same millisecond in Node.js event loop, `email.date` is identical (`2026-08-17T02:13:05.123Z`), `email.to` is `claudia@luminaumay.com`, and `email.provider` is `'mock'`.
  The `exists` predicate evaluates to `true` for orders 2 through 50, causing `addCapturedEmail` to drop 48 of the 50 distinct orders.
- **Empirical Assertion Failure**:
  ```
  FAIL tests/adversarial/m3-email-concurrency-stress.test.ts > Adv-M3.14: In-Memory Sink Accounting under Burst Identical Customer Names
  AssertionError: expected 2 to be 50 // Object.is equality
  - Expected: 50
  + Received: 2
  ```
- **Prescribed Remediation**:
  Remove the false deduplication predicate and append every captured email to `capturedEmails`:
  ```typescript
  static addCapturedEmail(email: CapturedEmail): void {
    this.capturedEmails.push(email);
  }
  ```

---

## 4. Verification Matrix of Required Dimensions

| Dimension | Scope Tested | Method | Result | Observations |
|---|---|---|---|---|
| **1. Multi-Provider & Fallbacks** | Mock, Console, SMTP, Resend | Fault injection (unconfigured, network timeout, 401/403/500 API errors, DNS failure) | ✅ PASS | All providers degrade gracefully to fallback capture without throwing unhandled exceptions. |
| **2. Template Robustness** | Nested tags, missing vars, nulls, 100k char payloads | Fuzzing & stress inputs | ✅ PASS | Compiles complex templates in <1ms; handles missing keys gracefully. |
| **3. XSS Sanitization** | Polyglots across all fields (`<script>`, `<img>`, `<svg>`, `<iframe>`, `on*`) | Adversarial payload injection | ✅ PASS | `escapeHtml` neutralizes all active tags (`&lt;`, `&gt;`, `&quot;`, `&#039;`, `&amp;`). |
| **4. Spanish Copy Fidelity** | 24-hour turnaround SLA, Claudia signature, CDMX timezone, preparation advice | Exact substring inspection | ✅ PASS | 100% adherence to Mexican Spanish copy ("24 horas", "Con luz, gratitud y bendiciones, Claudia — Lumina Umay"). |
| **5. Concurrency & Sinks** | 100+ concurrent order bursts, identical customer names | Burst stress testing | ❌ FAIL | `EmailService.addCapturedEmail` drops identical subject/date emails in millisecond bursts. |
