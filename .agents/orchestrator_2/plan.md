# Execution Plan — Orchestrator Gen 2

## Objective
Deliver complete, genuine, robust, and verified implementation of the Lumina Umay tarot booking and payment web application:
1. Complete Milestone 3 Gate Verification (2 Reviewers, 2 Challengers, 1 Auditor).
2. Execute Milestone 4 (Frontend UI/UX, Dynamic Tier Forms, Mexican Spanish FAQ Accordion).
3. Execute Milestone 5 (Full E2E Pass Tiers 1-4 & Tier 5 Adversarial Hardening).
4. Final Forensic Verification & Parent Delivery Report.

## Work Breakdown & Milestones

### Phase 1: Milestone 3 Verification Gate
- Dispatch `reviewer_m3_1` and `reviewer_m3_2` to review `src/server/services/email.service.ts`, templates, config, and unit tests against R4 requirements.
- Dispatch `challenger_m3_1` and `challenger_m3_2` to adversarially test template rendering, provider fallbacks, XSS escaping, Mexican Spanish SLA copy, and MIME formatting.
- Dispatch `auditor_m3_1` to verify integrity and anti-cheating compliance.
- Record verdicts in `GATE_STATUS.md` and sign off M3 if all criteria pass.

### Phase 2: Milestone 4 Implementation & Gate (Frontend UI/UX, Forms, FAQ)
- Dispatch 3 Explorers (`explorer_m4_1`, `explorer_m4_2`, `spec_miner_m4_1`) to inspect design tokens (`--teal: #0d2b2a`, `--teal-deep: #081d1c`, `--gold: #d4af37`, `--cream: #fbf8f2`), Cormorant Garamond / Jost typography, dynamic tier forms (1, 3, 5 cartas, live call), calendar/slot picker, interactive Mexican Spanish FAQ accordion (replacing WhatsApp CTA), and client-side integration with API.
- Dispatch `worker_m4_1` to implement the frontend codebase in `src/client/` (HTML, CSS, TypeScript/JS client), ensuring responsiveness, zero external UI framework dependencies if pure CSS, seamless integration with slot lock & Mercado Pago preference checkout.
- Dispatch 2 Reviewers, 2 Challengers, and 1 Auditor for M4.
- Evaluate M4 Gate in `GATE_STATUS.md`.

### Phase 3: Milestone 5 Full E2E & Tier 5 Adversarial Coverage Hardening
- Phase 1: Verify 100% pass across E2E test suites (Tiers 1-4) against live integrated server.
- Phase 2: Dispatch 2 Challengers for Tier 5 white-box adversarial stress testing (race conditions, edge cases, malformed payloads, timezone shifts, XSS injection, high concurrency).
- Worker addresses any gaps discovered in Tier 5.
- Reviewer & Auditor verify Tier 5 hardening.

### Phase 4: Final Victory Delivery & Reporting
- Final synthesis of verification evidence.
- Send comprehensive completion report to parent agent via `send_message`.
