# Milestone 1 Remediation Analysis & Fix Strategy Report

**Author:** Remediation Explorer 1 (Milestone 1 — Core Database & Concurrency Slot Engine)  
**Target File:** `c:/LUMINAPROJECT/.agents/explorer_m1_fix_1/handoff.md`  
**Date:** 2026-08-16T21:25:00Z  
**Status:** COMPLETE (Hard Handoff)

---

## 1. Observation

Direct code examination of the Milestone 1 implementation revealed three defects:

### 1.1 Unauthenticated Soft-Lock Release Vulnerability
- **Location 1**: `src/server/routes/slots.routes.ts:62-66`
  ```typescript
  62: const body = ReleaseSlotBodySchema.safeParse(req.body);
  63: 
  64: const lockToken = body.success ? body.data.lock_token : undefined;
  65: const released = SlotService.releaseSoftLock(params.id, lockToken);
  ```
- **Location 2**: `src/server/services/slot.service.ts:173-209`
  ```typescript
  173: static releaseSoftLock(slotId: string, lockToken?: string): boolean {
  174:   const nowIso = this.getCurrentIso();
  175: 
  176:   const releaseTx = db.transaction(() => {
  177:     let result;
  178:     if (lockToken) {
  179:       const stmt = db.prepare(`
  180:         UPDATE slots
  181:         SET status = 'available',
  182:             locked_at = NULL,
  183:             lock_expires_at = NULL,
  184:             lock_token = NULL,
  185:             updated_at = ?
  186:         WHERE id = ?
  187:           AND status IN ('locked', 'SOFT_LOCKED')
  188:           AND lock_token = ?
  189:       `);
  190:       result = stmt.run(nowIso, slotId, lockToken);
  191:     } else {
  192:       const stmt = db.prepare(`
  193:         UPDATE slots
  194:         SET status = 'available',
  195:             locked_at = NULL,
  196:             lock_expires_at = NULL,
  197:             lock_token = NULL,
  198:             updated_at = ?
  199:         WHERE id = ?
  200:           AND status IN ('locked', 'SOFT_LOCKED')
  201:       `);
  202:       result = stmt.run(nowIso, slotId);
  203:     }
  204:     return result.changes > 0;
  205:   });
  206:   return releaseTx();
  207: }
  ```
- **Observed Behavior**:
  1. Sending `POST /api/slots/:id/release` with an empty body `{}` causes `ReleaseSlotBodySchema.safeParse(req.body)` to fail (`body.success = false`), falling back to `lockToken = undefined`.
  2. `SlotService.releaseSoftLock` enters the `else` branch (lines 191–203), executing an unconstrained `UPDATE` that clears the lock unconditionally.
  3. Any unauthenticated third-party actor can cancel any active user's checkout reservation without knowing the secret `lock_token`.

### 1.2 Date Filter Ineffectiveness in `getAvailableSlots`
- **Location**: `src/server/services/slot.service.ts:74-86`
  ```typescript
  74: if (fromDateOrDate) {
  75:   if (/^\d{4}-\d{2}-\d{2}$/.test(fromDateOrDate)) {
  76:     // Date filter in YYYY-MM-DD
  77:     query += ` AND (start_time LIKE ? OR start_time >= ?)`;
  78:     params.push(`${fromDateOrDate}%`, now);
  79:   } else if (fromDateOrDate > now) {
  80:     query += ` AND start_time >= ?`;
  81:     params.push(fromDateOrDate);
  82:   } else {
  83:     query += ` AND start_time >= ?`;
  84:     params.push(now);
  85:   }
  86: }
  ```
- **Observed Behavior**:
  1. When filtering for a specific date (e.g., `fromDateOrDate = '2026-08-25'`), the SQL predicate evaluates to `AND (start_time LIKE '2026-08-25%' OR start_time >= now)`.
  2. Because all future dates satisfy `start_time >= now`, the `OR` branch is universally true for all future dates.
  3. Consequently, querying for a single calendar day returns all upcoming slots across all dates rather than strictly the selected day.

### 1.3 Missing `schema.sql` in `dist` & `package.json` Script Mismatch
- **Location 1**: `src/server/db/database.ts:122-126`
  ```typescript
  122: const schemaPath = path.resolve(__dirname, 'schema.sql');
  123: if (fs.existsSync(schemaPath)) {
  124:   const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  125:   luminaDb.exec(schemaSql);
  126: }
  ```
- **Location 2**: `package.json:7,10-11`
  ```json
  7: "main": "dist/server/index.js",
  8: "scripts": {
  9:   "dev": "tsx watch src/server/index.ts",
  10:  "build": "tsc",
  11:  "start": "node dist/server/index.js",
  ```
- **Observed Behavior**:
  1. `tsc` compiles TypeScript files to `dist/src/server/...` but does not copy `.sql` assets.
  2. When the application is compiled and run from `dist/`, `path.resolve(__dirname, 'schema.sql')` points to `dist/src/server/db/schema.sql`, which does not exist.
  3. `fs.existsSync(schemaPath)` evaluates to `false`, silently skipping table creation. The subsequent query against a fresh database throws `SqliteError: no such table: slots`.
  4. In `package.json`, `"main"` and `"start"` reference `dist/server/index.js`, whereas `tsc` outputs to `dist/src/server/index.js` due to `rootDir: "./"`.

---

## 2. Logic Chain

1. **Lock Authorization Integrity**:
   - The requirement in `PROJECT.md` § Interface Contracts and R2 states: `POST /api/slots/:id/release: Releases a soft lock with { lock_token }`.
   - Observation 1.1 proves that unauthenticated requests bypass token verification due to `safeParse` defaulting to `undefined` and the service method providing a fallback `else` branch.
   - To guarantee authorization, `slots.routes.ts` must use strict parsing (`ReleaseSlotBodySchema.parse(req.body)`) to reject requests missing `lock_token` with HTTP 400.
   - Concurrently, `SlotService.releaseSoftLock(slotId: string, lockToken?: string)` must reject calls where `lockToken` is missing or empty, and must only execute the SQL `UPDATE` conditioned on `lock_token = ?`.

2. **Calendar Date Filtering Logic**:
   - Observation 1.2 demonstrates that the `OR start_time >= now` clause invalidates date isolation.
   - When a user filters by `YYYY-MM-DD`, the query must strictly constrain the date prefix: `start_time LIKE ?`.
   - If the queried date is today (`now.slice(0, 10) === fromDateOrDate`), the query should additionally constrain `start_time >= ?` with `now` to exclude past hours of the current day.
   - For future dates, `start_time LIKE ?` alone accurately scopes results to that single 24-hour day in CDMX / UTC.

3. **Production Deployment & Schema Resiliency**:
   - Observation 1.3 shows a silent failure mode in production builds where `schema.sql` is missing from `dist/`.
   - A robust database layer must not rely solely on relative runtime file paths. It should include the complete SQLite DDL schema embedded directly in the codebase as a constant (`DEFAULT_SCHEMA_SQL`), while still supporting external schema files if present.
   - The build script in `package.json` should copy `schema.sql` to `dist/src/server/db/schema.sql`.
   - `package.json` `"main"` and `"start"` must be updated to `dist/src/server/index.js` to match the `tsc` compiler output.

---

## 3. Exact Remediation Strategy

### 3.1 Fix 1: Mandatory `lock_token` Enforcement in Route and Service

#### A. File: `src/server/routes/slots.routes.ts`
**Change:** Replace `safeParse` with strict `parse` and pass `body.lock_token` to `SlotService.releaseSoftLock`.

```typescript
// BEFORE (lines 56-88):
slotsRouter.post('/:id/release', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = SlotIdParamSchema.parse(req.params);
    const body = ReleaseSlotBodySchema.safeParse(req.body);

    const lockToken = body.success ? body.data.lock_token : undefined;
    const released = SlotService.releaseSoftLock(params.id, lockToken);

    if (!released) {
      return res.status(404).json({
        success: false,
        error: 'El horario no está apartado o no fue encontrado.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Horario liberado exitosamente',
    });
  } catch (error) {
    if (error instanceof SlotError) {
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        error: error.message,
      });
    }
    return next(error);
  }
});

// AFTER:
slotsRouter.post('/:id/release', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = SlotIdParamSchema.parse(req.params);
    const body = ReleaseSlotBodySchema.parse(req.body);

    const released = SlotService.releaseSoftLock(params.id, body.lock_token);

    if (!released) {
      return res.status(404).json({
        success: false,
        error: 'El horario no está apartado o el token de bloqueo es inválido.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Horario liberado exitosamente',
    });
  } catch (error) {
    if (error instanceof SlotError) {
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        error: error.message,
      });
    }
    return next(error);
  }
});
```

#### B. File: `src/server/services/slot.service.ts`
**Change:** Enforce `lockToken` presence and eliminate the unauthenticated `else` branch in `releaseSoftLock`.

```typescript
// BEFORE (lines 173-209):
static releaseSoftLock(slotId: string, lockToken?: string): boolean {
  const nowIso = this.getCurrentIso();

  const releaseTx = db.transaction(() => {
    let result;
    if (lockToken) {
      const stmt = db.prepare(`
        UPDATE slots
        SET status = 'available',
            locked_at = NULL,
            lock_expires_at = NULL,
            lock_token = NULL,
            updated_at = ?
        WHERE id = ?
          AND status IN ('locked', 'SOFT_LOCKED')
          AND lock_token = ?
      `);
      result = stmt.run(nowIso, slotId, lockToken);
    } else {
      const stmt = db.prepare(`
        UPDATE slots
        SET status = 'available',
            locked_at = NULL,
            lock_expires_at = NULL,
            lock_token = NULL,
            updated_at = ?
        WHERE id = ?
          AND status IN ('locked', 'SOFT_LOCKED')
      `);
      result = stmt.run(nowIso, slotId);
    }

    return result.changes > 0;
  });

  return releaseTx();
}

// AFTER:
static releaseSoftLock(slotId: string, lockToken?: string): boolean {
  if (!slotId || !lockToken || typeof lockToken !== 'string' || lockToken.trim() === '') {
    return false;
  }

  const nowIso = this.getCurrentIso();

  const releaseTx = db.transaction(() => {
    const stmt = db.prepare(`
      UPDATE slots
      SET status = 'available',
          locked_at = NULL,
          lock_expires_at = NULL,
          lock_token = NULL,
          updated_at = ?
      WHERE id = ?
        AND status IN ('locked', 'SOFT_LOCKED')
        AND lock_token = ?
    `);
    const result = stmt.run(nowIso, slotId, lockToken.trim());
    return result.changes > 0;
  });

  return releaseTx();
}
```

---

### 3.2 Fix 2: SQL Date Filtering Logic in `getAvailableSlots`

#### File: `src/server/services/slot.service.ts`
**Change:** Correct date filtering in `getAvailableSlots` to strictly match the requested date.

```typescript
// BEFORE (lines 74-89):
    if (fromDateOrDate) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(fromDateOrDate)) {
        // Date filter in YYYY-MM-DD
        query += ` AND (start_time LIKE ? OR start_time >= ?)`;
        params.push(`${fromDateOrDate}%`, now);
      } else if (fromDateOrDate > now) {
        query += ` AND start_time >= ?`;
        params.push(fromDateOrDate);
      } else {
        query += ` AND start_time >= ?`;
        params.push(now);
      }
    } else {
      query += ` AND start_time >= ?`;
      params.push(now);
    }

// AFTER:
    if (fromDateOrDate) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(fromDateOrDate)) {
        // Date filter in YYYY-MM-DD: strictly match that date
        const isToday = now.slice(0, 10) === fromDateOrDate;
        if (isToday) {
          query += ` AND start_time LIKE ? AND start_time >= ?`;
          params.push(`${fromDateOrDate}%`, now);
        } else {
          query += ` AND start_time LIKE ?`;
          params.push(`${fromDateOrDate}%`);
        }
      } else if (fromDateOrDate > now) {
        query += ` AND start_time >= ?`;
        params.push(fromDateOrDate);
      } else {
        query += ` AND start_time >= ?`;
        params.push(now);
      }
    } else {
      query += ` AND start_time >= ?`;
      params.push(now);
    }
```

---

### 3.3 Fix 3: Schema DDL Bundling & `package.json` Configuration

#### A. File: `src/server/db/database.ts`
**Change:** Embed the complete DDL schema (`DEFAULT_SCHEMA_SQL`) in `database.ts` as a reliable fallback and check multiple resolution paths.

```typescript
// ADD TO src/server/db/database.ts (at top or before getDatabase):
export const DEFAULT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS slots (
    id TEXT PRIMARY KEY,
    start_time TEXT NOT NULL UNIQUE,
    end_time TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'locked', 'booked', 'cancelled', 'AVAILABLE', 'SOFT_LOCKED', 'BOOKED', 'CANCELLED')),
    locked_at TEXT,
    lock_expires_at TEXT,
    lock_token TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK(start_time < end_time)
);

CREATE INDEX IF NOT EXISTS idx_slots_status_start ON slots(status, start_time);
CREATE INDEX IF NOT EXISTS idx_slots_lock_expires ON slots(lock_expires_at);
CREATE INDEX IF NOT EXISTS idx_slots_lock_token ON slots(lock_token);

CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    tier_id TEXT NOT NULL CHECK(tier_id IN ('1_carta', '3_cartas', '5_cartas', 'call_session', 'llamada')),
    category TEXT NOT NULL CHECK(category IN ('Amor', 'Trabajo/Dinero', 'Familia', 'Otro')),
    amount_mxn REAL NOT NULL CHECK(amount_mxn > 0),
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    customer_phone TEXT,
    customer_birthdate TEXT NOT NULL,
    question TEXT NOT NULL,
    involved_names TEXT,
    core_focus TEXT,
    slot_id TEXT,
    lock_token TEXT,
    mp_preference_id TEXT,
    mp_payment_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'failed', 'cancelled', 'expired', 'manual_review', 'approved', 'rejected', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    email_sent INTEGER NOT NULL DEFAULT 0 CHECK(email_sent IN (0, 1)),
    customer_email_sent INTEGER NOT NULL DEFAULT 0 CHECK(customer_email_sent IN (0, 1)),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY(slot_id) REFERENCES slots(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_mp_payment ON orders(mp_payment_id);
CREATE INDEX IF NOT EXISTS idx_orders_mp_preference ON orders(mp_preference_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_email ON orders(customer_email);
CREATE INDEX IF NOT EXISTS idx_orders_slot_id ON orders(slot_id);

CREATE TABLE IF NOT EXISTS webhook_events (
    id TEXT PRIMARY KEY,
    mp_payment_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    signature TEXT,
    status TEXT NOT NULL CHECK(status IN ('processed', 'ignored', 'failed')),
    error_message TEXT,
    processed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_payment_id ON webhook_events(mp_payment_id);
CREATE INDEX IF NOT EXISTS idx_webhook_status ON webhook_events(status);
`;

// REPLACE lines 121-127 in getDatabase:
  // Initialize schema
  const candidatePaths = [
    path.resolve(__dirname, 'schema.sql'),
    path.resolve(process.cwd(), 'src', 'server', 'db', 'schema.sql'),
    path.resolve(process.cwd(), 'dist', 'src', 'server', 'db', 'schema.sql'),
  ];

  let schemaSql: string | null = null;
  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      try {
        schemaSql = fs.readFileSync(candidate, 'utf8');
        break;
      } catch {
        // Continue searching
      }
    }
  }

  // Execute external schema file or embedded fallback schema
  luminaDb.exec(schemaSql || DEFAULT_SCHEMA_SQL);
```

#### B. File: `package.json`
**Change:** Update `"main"`, `"start"`, and `"build"` scripts.

```json
// In package.json:
{
  "name": "lumina-umay-booking",
  "version": "1.0.0",
  "description": "Lumina Umay Tarot Booking & Payment System",
  "private": true,
  "type": "module",
  "main": "dist/src/server/index.js",
  "scripts": {
    "dev": "tsx watch src/server/index.ts",
    "build": "tsc && node -e \"import('fs').then(fs => { const d = './dist/src/server/db'; fs.mkdirSync(d, { recursive: true }); fs.copyFileSync('./src/server/db/schema.sql', d + '/schema.sql'); })\"",
    "start": "node dist/src/server/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:unit": "vitest run tests/unit",
    "test:coverage": "vitest run --coverage",
    "db:seed": "tsx src/server/db/seed.ts",
    "typecheck": "tsc --noEmit"
  },
  ...
}
```

---

## 4. Caveats

- **No Downstream Milestones Touched**: Remediation is strictly scoped to Milestone 1 components (`slots.routes.ts`, `slot.service.ts`, `database.ts`, `package.json`).
- **Test Invariants Maintained**: No existing test assertions in `tests/unit/slot.service.test.ts` or `tests/adversarial/concurrency-stress.test.ts` are weakened or deleted. The unit test suite should be augmented with explicit tests for Finding 1 (unauthenticated release rejected) and Finding 2 (exact date filtering).

---

## 5. Conclusion

The 3 issues identified by Reviewer 1 have clear root causes and exact, zero-risk remediation pathways:
1. **Unauthenticated lock release**: Fixed by replacing `safeParse` with strict `parse` in `slots.routes.ts` and removing the unauthenticated `else` branch in `slot.service.ts`.
2. **Date query filter bypass**: Fixed by replacing `(start_time LIKE ? OR start_time >= ?)` with strict `start_time LIKE ?` (plus `start_time >= now` only when querying today's date).
3. **Missing `schema.sql` in `dist` & `package.json` entrypoint**: Fixed by embedding `DEFAULT_SCHEMA_SQL` in `database.ts`, adding a schema copy step in `npm run build`, and correcting `"main"`/`"start"` in `package.json`.

---

## 6. Verification Method

Once Worker 1 applies the proposed changes, execute the following verification steps:

1. **TypeScript Typecheck**:
   ```bash
   npm run typecheck
   ```
   *Expected result*: Exit code 0, 0 errors.

2. **Build and Fresh Database Bootstrap Verification**:
   ```bash
   npm run build
   node -e "
     import { initDatabase, db } from './dist/src/server/db/database.js';
     initDatabase({ dbPath: ':memory:' });
     const count = db.prepare('SELECT count(*) as c FROM slots').get().c;
     console.log('Slots table initialized successfully. Row count:', count);
   "
   ```
   *Expected result*: Output `Slots table initialized successfully. Row count: 0`.

3. **Verify Unauthenticated Release Route Rejection**:
   ```bash
   npx tsx -e "
     import request from 'supertest';
     import { createApp } from './src/server/app.js';
     import { SlotService } from './src/server/services/slot.service.js';
     import { seedDefaultSlots } from './src/server/db/seed.js';
     import { initDatabase } from './src/server/db/database.js';
     initDatabase();
     seedDefaultSlots();
     const app = createApp();
     const slots = SlotService.getAvailableSlots();
     const target = slots[0].id;
     const lock = SlotService.acquireSoftLock(target);
     
     // 1. Release with empty body -> must return 400 Bad Request
     request(app).post('/api/slots/' + target + '/release').send({}).then(res => {
       console.log('Release without token status (expected 400):', res.status);
       console.log('Slot status (expected locked):', SlotService.getSlotById(target).status);
       
       // 2. Release with invalid token -> must return 404
       return request(app).post('/api/slots/' + target + '/release').send({ lock_token: 'bogus-token' });
     }).then(res => {
       console.log('Release with bogus token status (expected 404):', res.status);
       console.log('Slot status (expected locked):', SlotService.getSlotById(target).status);
       
       // 3. Release with valid token -> must return 200
       return request(app).post('/api/slots/' + target + '/release').send({ lock_token: lock.lock_token });
     }).then(res => {
       console.log('Release with valid token status (expected 200):', res.status);
       console.log('Slot status (expected available):', SlotService.getSlotById(target).status);
     });
   "
   ```

4. **Verify Date Query Filter Isolation**:
   ```bash
   npx tsx -e "
     import { SlotService } from './src/server/services/slot.service.js';
     import { seedDefaultSlots } from './src/server/db/seed.js';
     import { initDatabase } from './src/server/db/database.js';
     initDatabase();
     seedDefaultSlots({ daysAhead: 14, force: true });
     
     const targetDate = '2026-08-25';
     const res = SlotService.getAvailableSlots(targetDate);
     const distinctDates = [...new Set(res.map(s => s.date))];
     console.log('Query date:', targetDate, 'Returned distinct dates:', distinctDates);
     if (distinctDates.length > 0) {
       console.log('All returned slots match query date:', distinctDates.every(d => d === targetDate));
     }
   "
   ```
   *Expected result*: `Returned distinct dates: ['2026-08-25']`, `All returned slots match query date: true`.

5. **Run Full Test Suite**:
   ```bash
   npm test
   node tests/e2e/run-all.js
   ```
   *Expected result*: All unit tests, adversarial stress tests, and 57/57 E2E tests pass with 100% success rate.
