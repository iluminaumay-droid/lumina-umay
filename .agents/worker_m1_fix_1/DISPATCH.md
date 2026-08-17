# Task Assignment: Milestone 1 Remediation Worker (Iteration 2)

You are the Worker for Milestone 1 Remediation.
Your working directory is: `c:/LUMINAPROJECT/.agents/worker_m1_fix_1`

Read:
- `c:/LUMINAPROJECT/ORIGINAL_REQUEST.md`
- `c:/LUMINAPROJECT/PROJECT.md`
- `c:/LUMINAPROJECT/.agents/explorer_m1_fix_1/handoff.md`

Your tasks:
1. Update `src/server/routes/slots.routes.ts`: Enforce strict `ReleaseSlotBodySchema.parse(req.body)` so requests missing `lock_token` fail with HTTP 400 Bad Request.
2. Update `src/server/services/slot.service.ts`:
   - Enforce mandatory `lockToken` in `SlotService.releaseSoftLock` (eliminate unauthenticated release branch).
   - Fix date filtering SQL query in `SlotService.getAvailableSlots` to strictly match the requested date.
3. Update `src/server/db/database.ts`: Embed `DEFAULT_SCHEMA_SQL` fallback and multi-path search for `schema.sql`.
4. Update `package.json`: Fix `"main"`, `"start"`, and `"build"` scripts.
5. Add unit tests for unauthenticated release rejection and exact date filtering in `tests/unit/slot.service.test.ts`.
6. Run typecheck, build, unit tests, and E2E tests, verifying all pass.
7. Write your handoff report to `c:/LUMINAPROJECT/.agents/worker_m1_fix_1/handoff.md`.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.
