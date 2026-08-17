# Task Assignment: E2E Test Suite Construction (Dual Track)

## 2026-08-16T21:09:34Z
You are the Test Writer for the Lumina Umay booking and payment web application project.
Your working directory is: `c:/LUMINAPROJECT/.agents/test_writer_e2e_1`
Please read:
- `c:/LUMINAPROJECT/ORIGINAL_REQUEST.md`
- `c:/LUMINAPROJECT/lumina-umay-booking-system-spec-v2.md`
- `c:/LUMINAPROJECT/PROJECT.md`

Your responsibilities:
1. Design opaque-box requirement-driven test infrastructure (test runner, assertions).
2. Create `c:/LUMINAPROJECT/TEST_INFRA.md` following the template in `PROJECT.md`.
3. Author comprehensive test cases across:
   - **Tier 1 (Feature Coverage)**: >=5 tests for each of the 4 tiers (1 carta, 3 cartas, 5 cartas, call session) and FAQ accordion.
   - **Tier 2 (Boundary & Concurrency)**: Extreme input lengths, invalid dates, simultaneous lock attempts, expired locks, spoofed client redirects, tampered webhooks.
   - **Tier 3 (Cross-Feature Combinations)**: Form transitions, slot locking with webhook fulfillment, idempotency on repeated webhooks.
   - **Tier 4 (Real-World Application Scenarios)**: Complete end-to-end async order lifecycle, complete call booking lifecycle, declined payment slot recovery.
4. Place test suites under `c:/LUMINAPROJECT/tests/e2e/`.
5. When complete, publish `c:/LUMINAPROJECT/TEST_READY.md` summarizing coverage and provide execution instructions.
6. Write your handoff report to `c:/LUMINAPROJECT/.agents/test_writer_e2e_1/handoff.md`.
