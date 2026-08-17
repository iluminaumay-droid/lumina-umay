# Milestone 1 Exploration Report: SQLite DDL Schema, WAL Configuration & Slot Seeding

**Role:** Explorer 1 — Milestone 1 (Core Database & Concurrency Engine)  
**Target Folder:** `c:/LUMINAPROJECT/.agents/explorer_m1_1`  
**Date:** 2026-08-16  
**Status:** COMPLETED (Hard Handoff)  

---

## 1. Observation

### 1.1 Source Document Evidence
From `c:/LUMINAPROJECT/ORIGINAL_REQUEST.md`:
- **R1 (Multi-Tier Async Reading Flow)**: "3 async reading tiers (1 carta: $150 MXN, 3 cartas: $350 MXN, 5 cartas: $500 MXN) with dynamic form fields corresponding to each tier, mandatory category selection (Amor, Trabajo/Dinero, Familia, Otro), and birthdate/question capture." (Lines 12–14)
- **R2 (Live Call Session Slot Booking & Concurrency)**: "Implement live call booking ($450 MXN) with real-time slot availability, soft-locking during checkout attempt, automated release on timeout/failure, and permanent booking confirmation upon payment to eliminate double-booking." (Lines 15–17)
- **R3 (Mercado Pago Payment & Webhook Verification)**: "Orders and slot locks must strictly only be confirmed when the webhook validates an `approved` payment status." (Lines 18–20)
- **R4 (Order Notification & Email Dispatching)**: "Implement transaction email notifications sending full customer and order details (name, birthdate, tier, category, specific question/focus, and booked time slot for calls) to Claudia, with configurable SMTP/Resend provider integration." (Lines 21–23)

From `c:/LUMINAPROJECT/PROJECT.md`:
- **Architecture**: "Node.js + Express + TypeScript with SQLite (`better-sqlite3` in WAL mode) for atomic transaction support, slot soft-locking with TTL, Mercado Pago SDK/REST integration, HMAC SHA-256 webhook validation, and pluggable email notification engine." (Lines 4–6)
- **Database Code Layout**:
  - `src/server/db/schema.sql` — SQLite table definitions (Line 69)
  - `src/server/db/database.ts` — Better-SQLite3 connection & WAL setup (Line 70)
  - `src/server/db/seed.ts` — Default slot seeding script (Line 71)
- **Interface Contracts**:
  - `GET /api/slots`: Returns available slots `{ success: true, slots: [{ id, start_time, end_time, status }] }` (Line 46)
  - `POST /api/slots/:id/lock`: Acquires a 15-minute soft lock. Returns `{ success: true, lock_token, expires_at }` or `409 Conflict` (Line 47)
  - `POST /api/slots/:id/release`: Releases a soft lock with `{ lock_token }` (Line 48)

From `c:/LUMINAPROJECT/lumina-umay-booking-system-spec-v2.md`:
- "Store available call slots; only show open ones to the customer. Soft-lock a slot on payment attempt, confirm it permanently once Mercado Pago's webhook approves payment, release it if payment doesn't complete. Prevent two customers from booking the same slot." (Lines 60–62)
- "Site language: Mexican Spanish throughout" (Line 10)

---

## 2. Logic Chain

### 2.1 Database Engine & Pragma Strategy
1. **Concurrency Model**: SQLite with `better-sqlite3` runs synchronously in Node.js event-loop threads. To handle high-concurrency read requests (users browsing available slots) while allowing isolated write transactions (soft-locking and payment confirmation), Write-Ahead Logging (`PRAGMA journal_mode = WAL;`) must be set.
2. **Synchronous Mode**: `PRAGMA synchronous = NORMAL;` in WAL mode provides full ACID compliance across application crashes while avoiding the fsync bottleneck of `FULL` mode, dramatically improving write performance.
3. **Foreign Keys**: SQLite disables foreign key enforcement by default. Running `PRAGMA foreign_keys = ON;` on every connection ensures relational integrity between `orders.slot_id` and `slots.id`.
4. **Busy Timeout**: In high load, concurrent writes can trigger `SQLITE_BUSY`. Setting `timeout: 5000` (or `PRAGMA busy_timeout = 5000;`) forces SQLite to wait up to 5 seconds before erroring, ensuring concurrent lock acquisitions serialize cleanly.

### 2.2 Schema Design & Data Integrity
1. **`slots` Table**:
   - `id`: UUIDv4 string (`TEXT PRIMARY KEY`).
   - `start_time` & `end_time`: ISO-8601 UTC strings (`TEXT NOT NULL`). Storing in UTC guarantees timezone portability. `UNIQUE(start_time)` prevents duplicate slots.
   - `status`: Enforced via `CHECK(status IN ('available', 'locked', 'booked', 'cancelled'))`.
   - `locked_at` & `lock_expires_at`: UTC timestamps for TTL calculations.
   - `lock_token`: Secret UUIDv4 issued to the client during hold; required for release or confirmation.
   - Indices on `(status, start_time)` and `lock_expires_at` optimize the two highest-frequency queries: available slot retrieval and expired-lock sweeping.

2. **`orders` Table**:
   - `id`: UUIDv4 string (`TEXT PRIMARY KEY`).
   - `tier_id`: `CHECK(tier_id IN ('1_carta', '3_cartas', '5_cartas', 'call_session'))`.
   - `category`: `CHECK(category IN ('Amor', 'Trabajo/Dinero', 'Familia', 'Otro'))`.
   - `amount_mxn`: `REAL NOT NULL` (150.00, 350.00, 500.00, 450.00).
   - Dynamic tier fields: `involved_names` (for 3 & 5 cartas), `core_focus` (for 5 cartas: "Qué es lo que más deseas saber"), `slot_id` & `lock_token` (for call sessions).
   - `status`: `CHECK(status IN ('pending', 'paid', 'failed', 'cancelled', 'expired', 'manual_review'))`.
   - `email_sent` & `customer_email_sent`: `INTEGER NOT NULL DEFAULT 0` (boolean flags) to track notification delivery.

3. **`webhook_events` Table**:
   - Idempotency & audit log for incoming Mercado Pago notifications.
   - `id`: Primary key (Mercado Pago event ID or notification ID).
   - `mp_payment_id`: Indexed for fast lookups to avoid duplicate webhook processing.
   - `status`: `CHECK(status IN ('processed', 'ignored', 'failed'))`.
   - `payload`: Full JSON payload stored as text for forensic auditability.

### 2.3 Slot Seeding Engine (`seed.ts`)
1. **Business Hours & Timezone**:
   - Consultation hours: Monday to Friday, 10:00 to 18:00 Mexico Central Time (`America/Mexico_City`, UTC-6).
   - 10:00 CDMX = 16:00 UTC; 18:00 CDMX = 00:00 UTC (next day).
   - Slot duration: 45 minutes with 15-minute buffers or structured 5 daily appointment blocks (e.g. 10:00–10:45, 11:30–12:15, 14:00–14:45, 15:30–16:15, 17:00–17:45 CDMX).
2. **Deterministic & Idempotent Generation**:
   - Generates weekday slots for the next 14 to 30 days starting from current date.
   - Uses `INSERT OR IGNORE` so re-running the seeder does not overwrite already `booked` or `locked` slots.

---

## 3. Caveats

1. **Mexico Timezone Standardization**:
   - Mexico City abolished Daylight Saving Time (DST) in 2022. It remains permanently on UTC-6 (Standard Time) year-round. All calculations should use standard UTC-6 offset (`+06:00` UTC conversion).
2. **Directory Initialization**:
   - SQLite fails if the database directory does not exist. `database.ts` must ensure `fs.mkdirSync(path.dirname(dbPath), { recursive: true })` runs before opening the database file.
3. **Database File vs In-Memory Mode**:
   - In production and development, a persistent file (`data/lumina_umay.sqlite`) is used.
   - For unit/integration tests, in-memory (`:memory:`) or temporary file databases should be supported via parameter/environment variable (`DATABASE_PATH`).

---

## 4. Conclusion & Concrete Specifications

### 4.1. SQLite DDL Schema (`src/server/db/schema.sql`)

```sql
-- ============================================================================
-- LUMINA UMAY DATABASE SCHEMA (SQLite 3 + better-sqlite3)
-- ============================================================================

-- 1. Database PRAGMAs (Connection Level)
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- 2. Slots Table (Category B - Live Call Consultations)
CREATE TABLE IF NOT EXISTS slots (
    id TEXT PRIMARY KEY,                              -- UUIDv4
    start_time TEXT NOT NULL UNIQUE,                 -- ISO-8601 UTC string (e.g. '2026-08-20T16:00:00.000Z')
    end_time TEXT NOT NULL,                           -- ISO-8601 UTC string (e.g. '2026-08-20T16:45:00.000Z')
    status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'locked', 'booked', 'cancelled')),
    locked_at TEXT,                                   -- ISO-8601 UTC string when soft-lock acquired
    lock_expires_at TEXT,                             -- ISO-8601 UTC string when soft-lock expires (now + 15m)
    lock_token TEXT,                                  -- UUIDv4 token for session ownership
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK(start_time < end_time)
);

CREATE INDEX IF NOT EXISTS idx_slots_status_start ON slots(status, start_time);
CREATE INDEX IF NOT EXISTS idx_slots_lock_expires ON slots(lock_expires_at);
CREATE INDEX IF NOT EXISTS idx_slots_lock_token ON slots(lock_token);

-- 3. Orders Table (Category A: 1, 3, 5 Cartas & Category B: Call Session)
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,                              -- UUIDv4
    tier_id TEXT NOT NULL CHECK(tier_id IN ('1_carta', '3_cartas', '5_cartas', 'call_session')),
    category TEXT NOT NULL CHECK(category IN ('Amor', 'Trabajo/Dinero', 'Familia', 'Otro')),
    amount_mxn REAL NOT NULL CHECK(amount_mxn > 0),
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    customer_phone TEXT,
    customer_birthdate TEXT NOT NULL,                 -- Format YYYY-MM-DD
    question TEXT NOT NULL,                           -- Mandatory for all tiers
    involved_names TEXT,                              -- Required for 3 & 5 cartas (if applicable)
    core_focus TEXT,                                  -- Required for 5 cartas ("Qué es lo que más deseas saber")
    slot_id TEXT,                                     -- FK for call sessions (NULL for async readings)
    lock_token TEXT,                                  -- Session lock token for call sessions
    mp_preference_id TEXT,                            -- Mercado Pago Preference ID
    mp_payment_id TEXT,                               -- Mercado Pago Payment ID
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'failed', 'cancelled', 'expired', 'manual_review')),
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

-- 4. Webhook Events Table (Mercado Pago Idempotency & Audit Trail)
CREATE TABLE IF NOT EXISTS webhook_events (
    id TEXT PRIMARY KEY,                              -- MP notification ID or hash
    mp_payment_id TEXT NOT NULL,
    event_type TEXT NOT NULL,                         -- e.g. 'payment.created', 'payment.updated'
    payload TEXT NOT NULL,                            -- Full JSON payload string
    signature TEXT,                                   -- x-signature header value
    status TEXT NOT NULL CHECK(status IN ('processed', 'ignored', 'failed')),
    error_message TEXT,
    processed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_payment_id ON webhook_events(mp_payment_id);
CREATE INDEX IF NOT EXISTS idx_webhook_status ON webhook_events(status);
```

---

### 4.2. Database Connection & Lifecycle Module (`src/server/db/database.ts`)

```typescript
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export interface DatabaseConfig {
  dbPath?: string;
  verbose?: boolean;
}

let dbInstance: Database.Database | null = null;

export function getDatabase(config?: DatabaseConfig): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = config?.dbPath || process.env.DATABASE_PATH || path.resolve(process.cwd(), 'data/lumina_umay.sqlite');

  // Ensure directory exists if not an in-memory database
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath, {
    timeout: 5000,
    verbose: config?.verbose ? console.log : undefined,
  });

  // Configure SQLite WAL mode & pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  // Initialize schema
  const schemaPath = path.resolve(__dirname, 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schemaSql);
  }

  dbInstance = db;
  return dbInstance;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export const db = getDatabase();
```

---

### 4.3. Default Slot Seeding Script (`src/server/db/seed.ts`)

```typescript
import { v4 as uuidv4 } from 'uuid';
import { getDatabase, closeDatabase } from './database';

export interface SeedOptions {
  daysAhead?: number;
  dbPath?: string;
}

/**
 * Daily consultation time blocks in Mexico Central Time (America/Mexico_City, UTC-6).
 * Monday - Friday: 10:00, 11:30, 14:00, 15:30, 17:00 (45-min duration each).
 */
const DAILY_SCHEDULE_CDMX = [
  { startHour: 10, startMinute: 0, durationMinutes: 45 },
  { startHour: 11, startMinute: 30, durationMinutes: 45 },
  { startHour: 14, startMinute: 0, durationMinutes: 45 },
  { startHour: 15, startMinute: 30, durationMinutes: 45 },
  { startHour: 17, startMinute: 0, durationMinutes: 45 },
];

/**
 * Converts a CDMX year, month, day, hour, minute to UTC ISO-8601 string.
 * Mexico City is UTC-6 year-round.
 */
function toUtcIso(year: number, month: number, day: number, cdmxHour: number, cdmxMinute: number): string {
  // CDMX is UTC-6, so UTC hour = cdmxHour + 6
  const utcDate = new Date(Date.UTC(year, month - 1, day, cdmxHour + 6, cdmxMinute, 0, 0));
  return utcDate.toISOString();
}

export function seedDefaultSlots(options: SeedOptions = {}): { insertedCount: number; totalAvailable: number } {
  const daysAhead = options.daysAhead || 21; // 3 weeks of slots
  const db = getDatabase({ dbPath: options.dbPath });

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO slots (id, start_time, end_time, status)
    VALUES (?, ?, ?, 'available')
  `);

  let insertedCount = 0;
  const now = new Date();

  const seedTransaction = db.transaction(() => {
    for (let dayOffset = 1; dayOffset <= daysAhead; dayOffset++) {
      const targetDate = new Date();
      targetDate.setDate(now.getDate() + dayOffset);

      // 0 = Sunday, 6 = Saturday (Skip weekends)
      const dayOfWeek = targetDate.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        continue;
      }

      const year = targetDate.getFullYear();
      const month = targetDate.getMonth() + 1;
      const day = targetDate.getDate();

      for (const block of DAILY_SCHEDULE_CDMX) {
        const startTimeUtc = toUtcIso(year, month, day, block.startHour, block.startMinute);
        
        // Calculate end time
        const endMinutesTotal = block.startMinute + block.durationMinutes;
        const endHour = block.startHour + Math.floor(endMinutesTotal / 60);
        const endMinute = endMinutesTotal % 60;
        const endTimeUtc = toUtcIso(year, month, day, endHour, endMinute);

        const slotId = uuidv4();
        const result = insertStmt.run(slotId, startTimeUtc, endTimeUtc);
        if (result.changes > 0) {
          insertedCount++;
        }
      }
    }
  });

  seedTransaction();

  const totalAvailable = (db.prepare(`SELECT count(*) as count FROM slots WHERE status = 'available'`).get() as any).count;

  return { insertedCount, totalAvailable };
}

// Direct CLI execution
if (require.main === module) {
  console.log('🌱 Seeding Lumina Umay consultation slots...');
  const result = seedDefaultSlots();
  console.log(`✅ Seeding complete: ${result.insertedCount} new slots created. Total available: ${result.totalAvailable}`);
  closeDatabase();
}
```

---

### 4.4. TypeScript Domain Models & Types (`src/server/db/types.ts`)

```typescript
export type ProductTier = '1_carta' | '3_cartas' | '5_cartas' | 'call_session';

export type ReadingCategory = 'Amor' | 'Trabajo/Dinero' | 'Familia' | 'Otro';

export type SlotStatus = 'available' | 'locked' | 'booked' | 'cancelled';

export type OrderStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | 'expired' | 'manual_review';

export interface Slot {
  id: string;
  start_time: string;
  end_time: string;
  status: SlotStatus;
  locked_at: string | null;
  lock_expires_at: string | null;
  lock_token: string | null;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  tier_id: ProductTier;
  category: ReadingCategory;
  amount_mxn: number;
  customer_name: string;
  customer_email: string;
  customer_phone?: string | null;
  customer_birthdate: string;
  question: string;
  involved_names?: string | null;
  core_focus?: string | null;
  slot_id?: string | null;
  lock_token?: string | null;
  mp_preference_id?: string | null;
  mp_payment_id?: string | null;
  status: OrderStatus;
  email_sent: number;
  customer_email_sent: number;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookEvent {
  id: string;
  mp_payment_id: string;
  event_type: string;
  payload: string;
  signature?: string | null;
  status: 'processed' | 'ignored' | 'failed';
  error_message?: string | null;
  processed_at?: string | null;
  created_at: string;
}
```

---

## 5. Verification Method

To independently verify the schema, WAL configuration, and seed engine:

1. **Schema Integrity & Constraints Test**:
   - Initialize an in-memory SQLite database using `getDatabase({ dbPath: ':memory:' })`.
   - Verify that tables `slots`, `orders`, and `webhook_events` exist with proper check constraints.
   - Attempt to insert an invalid order tier (`invalid_tier`) and verify SQLite throws `SQLITE_CONSTRAINT_CHECK`.
   - Attempt to insert a slot with `end_time <= start_time` and verify SQLite throws `SQLITE_CONSTRAINT_CHECK`.

2. **WAL Mode Verification**:
   - Initialize a file-based test database.
   - Run `db.pragma('journal_mode')` and assert the result is `[{ journal_mode: 'wal' }]` (or `'wal'`).
   - Run `db.pragma('foreign_keys')` and assert the result is `[{ foreign_keys: 1 }]`.

3. **Slot Seeding Verification**:
   - Run `seedDefaultSlots({ daysAhead: 14 })`.
   - Assert `insertedCount > 0`.
   - Query `SELECT count(*) FROM slots WHERE strftime('%w', start_time) IN ('0', '6')` and assert `count === 0` (zero weekend slots).
   - Re-run `seedDefaultSlots({ daysAhead: 14 })` and assert `insertedCount === 0` (idempotent, no duplicates).

4. **Referential Integrity Test**:
   - Insert a test slot into `slots`.
   - Insert an order with `slot_id` referencing the test slot.
   - Delete the slot from `slots` and verify `orders.slot_id` is set to `NULL` (due to `ON DELETE SET NULL`).

---
*Report prepared by Explorer 1 for Milestone 1 Worker handoff.*
