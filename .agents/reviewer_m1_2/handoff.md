# Milestone 1 Code Review & Adversarial Audit Report (Reviewer 2)

**Role:** Reviewer 2 / Adversarial Critic  
**Working Directory:** `c:/LUMINAPROJECT/.agents/reviewer_m1_2`  
**Date:** 2026-08-16T21:19:30Z  
**Verdict:** **APPROVE**

---

## 1. Observation

### 1.1 Evaluated Source Files & Exact Line References
1. **Database Schema & DDL** (`src/server/db/schema.sql`):
   - Lines 6–17: `slots` table definition with `start_time TEXT NOT NULL UNIQUE`, `status` CHECK constraint covering both uppercase and lowercase statuses (`available`, `locked`, `booked`, `cancelled`, `AVAILABLE`, `SOFT_LOCKED`, `BOOKED`, `CANCELLED`), `lock_expires_at TEXT`, `lock_token TEXT`, and `CHECK(start_time < end_time)`.
   - Lines 19–21: Performance indexes on `(status, start_time)`, `lock_expires_at`, and `lock_token`.
   - Lines 24–47: `orders` table with foreign key `slot_id` referencing `slots(id) ON DELETE SET NULL`.
   - Lines 56–66: `webhook_events` idempotency table with indices on `mp_payment_id` and `status`.

2. **Database Driver & WAL Configuration** (`src/server/db/database.ts`):
   - Lines 33–42:
     ```typescript
     if (dbPath !== ':memory:') {
       this.db.exec('PRAGMA journal_mode = WAL;');
     }
     this.db.exec('PRAGMA synchronous = NORMAL;');
     this.db.exec('PRAGMA foreign_keys = ON;');
     this.db.exec('PRAGMA busy_timeout = 5000;');
     ```
   - Lines 83–99: Atomic transaction wrapper using `BEGIN IMMEDIATE`, ensuring reserved write locks to prevent SQLite busy deadlocks under concurrent load.
   - Lines 154–163: Proxy wrapper on `db` allowing seamless import and execution across services.

3. **Deterministic Slot Seeding** (`src/server/db/seed.ts`):
   - Lines 14–20: `DAILY_SCHEDULE_CDMX` defining 5 daily 45-minute blocks at 10:00, 11:30, 14:00, 15:30, and 17:00 CDMX time.
   - Lines 26–30: Exact UTC-6 conversion helper `toUtcIso(year, month, day, cdmxHour, cdmxMinute)`.
   - Lines 51–87: Weekday filter (`dayOfWeek === 0 || dayOfWeek === 6` skipped) generating deterministic slot IDs (e.g. `slot_YYYY-MM-DD_HHmm`) and inserting with `INSERT OR IGNORE`.

4. **Concurrency Slot Engine & TTL Sweeper** (`src/server/services/slot.service.ts`):
   - Lines 60–111: `getAvailableSlots()` implements lazy sweeping via `this.releaseExpiredLocks()` and returns localized CDMX date/time fields alongside ISO-8601 UTC strings.
   - Lines 116–168: `acquireSoftLock()` implements an atomic test-and-set conditional SQL statement:
     ```typescript
     UPDATE slots
     SET status = 'locked',
         locked_at = ?,
         lock_expires_at = ?,
         lock_token = ?,
         updated_at = ?
     WHERE id = ?
       AND (
         status IN ('available', 'AVAILABLE')
         OR (status IN ('locked', 'SOFT_LOCKED') AND lock_expires_at <= ?)
       )
     ```
     Throws `SlotConflictError` (HTTP 409) if `result.changes === 0`.
   - Lines 173–209: `releaseSoftLock()` validates `lock_token` ensuring only the locking session can release a hold.
   - Lines 214–248: `confirmBooking()` permanently confirms booking upon webhook approval, clearing `lock_expires_at`.
   - Lines 253–269 & 274–299: `releaseExpiredLocks()` and `startSweeper(intervalMs)` interval daemon with `.unref()`.

5. **API Routing & Mexican Spanish Error Handling** (`src/server/routes/slots.routes.ts`, `src/server/app.ts`, `src/server/types/slot.types.ts`):
   - `GET /api/slots`: returns `{ success: true, slots: [...] }`.
   - `POST /api/slots/:id/lock`: returns `{ success: true, message: 'Horario apartado temporalmente por 15 minutos', slot_id, lock_token, expires_at }` or `409 Conflict`.
   - `POST /api/slots/:id/release`: returns `{ success: true, message: 'Horario liberado exitosamente' }` or `404 Not Found`.
   - Error messages in natural Mexican Spanish:
     - Conflict: `"El horario seleccionado ya fue apartado por otra persona. Por favor elige otro horario."`
     - Booked: `"Este horario ya ha sido confirmado y reservado permanentemente."`
     - Not Found: `"El horario con ID ${slotId} no fue encontrado."`
     - Validation: `"Error de validación en los datos enviados"`
     - Server: `"Error interno del servidor. Por favor intenta más tarde."`

### 1.2 Verification Command Executions
- **TypeScript Typecheck**:
  `npm run typecheck` -> Exit code 0 (0 errors).
- **TypeScript Compilation**:
  `npm run build` -> Exit code 0 (compiled to `dist/`).
- **Vitest Unit & Concurrency Suite**:
  `npm test` -> 11 passed (11 tests in `tests/unit/slot.service.test.ts`), duration ~826ms.
- **E2E Integration Test Runner**:
  `node tests/e2e/run-all.js` -> 57 passed (57 tests across Tiers 1–4, 17 suites), duration ~902ms.

---

## 2. Logic Chain

1. **Interface Conformance Verification**:
   - `PROJECT.md` § Interface Contracts requires `GET /api/slots`, `POST /api/slots/:id/lock` (with 15m soft-lock and 409 conflict handling), and `POST /api/slots/:id/release` with `{ lock_token }`.
   - Observation in `src/server/routes/slots.routes.ts` matches this contract exactly. Both snake_case and camelCase attributes are supported for downstream compatibility.
2. **SQLite WAL & High-Concurrency Reliability**:
   - SQLite in WAL mode with `PRAGMA synchronous = NORMAL`, `busy_timeout = 5000`, and `BEGIN IMMEDIATE` ensures concurrent writes do not deadlock.
   - The test-and-set SQL statement in `SlotService.acquireSoftLock` executes atomically within SQLite's engine lock. In test T5 (`tests/unit/slot.service.test.ts`), 50 simultaneous parallel requests result in exactly 1 successful lock and 49 conflict errors (HTTP 409).
3. **TTL Semantics & Auto-Release**:
   - The dual-path expiration mechanism guarantees that stale locks never block customer bookings:
     - Path 1: Query-time lazy release in `getAvailableSlots()` and atomic reclaim in `acquireSoftLock()`.
     - Path 2: Periodic background sweeper daemon via `setInterval().unref()`.
   - Expired locks are safely re-acquired without manual intervention.
4. **Mexican Spanish Copy Quality**:
   - All user-facing strings use authentic Mexican Spanish terminology (`apartado`, `horario`, `lectura`, `persona involucrada`) rather than robotic or generic translations.
5. **Integrity & Authenticity Audit**:
   - No mock bypasses, hardcoded test IDs, or facade implementations exist. The service executes genuine SQLite statements against dynamic tables.

---

## 3. Caveats

- **Timezone Standardization**: CDMX operates on UTC-6 year-round following Mexican federal reform. The UTC-6 offset in `toUtcIso` and `parseUtcToCdmx` is hardcoded as UTC-6, which is standard for Mexico City.
- **Scope Boundary**: Milestones M2 (Mercado Pago Checkout/Webhook) and M3 (Email Dispatcher) build upon this foundation; their specific SDK calls and webhook handlers will be evaluated during subsequent milestone reviews.

---

## 4. Conclusion

**Verdict: APPROVE**

Milestone 1 satisfies all requirements set forth in `ORIGINAL_REQUEST.md`, `PROJECT.md`, and `lumina-umay-booking-system-spec-v2.md`. The database architecture is resilient, thread-safe, and fully compliant with project standards.

---

## 5. Verification Method

To independently reproduce the verification:

1. **Typecheck**:
   ```powershell
   npm run typecheck
   ```
2. **Build**:
   ```powershell
   npm run build
   ```
3. **Unit & Concurrency Tests**:
   ```powershell
   npm test
   ```
4. **Master E2E Test Suite**:
   ```powershell
   node tests/e2e/run-all.js
   ```
