# Task Assignment: Milestone 1 Implementation (Core Database & Concurrency Slot Engine)

You are the Worker for Milestone 1 (Core Database & Concurrency Engine).
Your working directory is: `c:/LUMINAPROJECT/.agents/worker_m1_1`

## Mandatory Files to Read:
1. `c:/LUMINAPROJECT/ORIGINAL_REQUEST.md`
2. `c:/LUMINAPROJECT/PROJECT.md`
3. `c:/LUMINAPROJECT/.agents/explorer_m1_1/handoff.md`
4. `c:/LUMINAPROJECT/.agents/explorer_m1_2/handoff.md`
5. `c:/LUMINAPROJECT/.agents/explorer_m1_3/handoff.md`

## Your Responsibilities:
1. Initialize the project toolchain:
   - `package.json` with dependencies (`express`, `better-sqlite3`, `dotenv`, `cors`, `zod`, `uuid`, `tsx`, `typescript`, `vitest`, `supertest`, `@types/node`, `@types/express`, `@types/better-sqlite3`, `@types/cors`, `@types/uuid`, `@types/supertest`).
   - `tsconfig.json` with modern NodeNext/ESNext configuration.
   - `.env.example` with environment variables.
2. Implement Database & Schema layer:
   - `src/server/db/schema.sql` (slots, orders, webhook_events with WAL pragmas & indexes).
   - `src/server/db/database.ts` (connection manager with WAL mode, foreign keys, 5000ms busy timeout).
   - `src/server/db/seed.ts` (deterministic weekday slot seeder in CDMX / UTC ISO).
   - `src/server/types/slot.types.ts` (domain types, DTOs, custom error classes).
3. Implement Slot Service & Concurrency Engine:
   - `src/server/services/slot.service.ts` (`getAvailableSlots`, `acquireSoftLock` with atomic test-and-set update, `releaseSoftLock`, `confirmBooking`, `releaseExpiredLocks`, `startSweeper`, `stopSweeper`).
4. Implement Routing & Server Bootstrapping:
   - `src/server/routes/slots.routes.ts` (`GET /api/slots`, `POST /api/slots/:id/lock`, `POST /api/slots/:id/release`).
   - `src/server/index.ts` (Express server setup, JSON body parser, error middleware).
5. Implement and run Unit & Concurrency Tests:
   - `tests/unit/slot.service.test.ts` (verifying 50 simultaneous lock attempts with 1 winner and 49 conflicts, TTL sweeping, token validation).
   - Execute the test suite and build command, ensuring 100% pass rate.
6. Write your handoff report to `c:/LUMINAPROJECT/.agents/worker_m1_1/handoff.md`.

## Exclusive Write Ownership:
You own:
- `package.json`
- `tsconfig.json`
- `.env.example`
- `src/server/db/*`
- `src/server/types/*`
- `src/server/services/slot.service.ts`
- `src/server/routes/slots.routes.ts`
- `src/server/index.ts`
- `tests/unit/slot.service.test.ts`
- `c:/LUMINAPROJECT/.agents/worker_m1_1/*`

## MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.
