-- ============================================================================
-- LUMINA UMAY DATABASE SCHEMA (SQLite 3 + better-sqlite3)
-- ============================================================================

-- 1. Slots Table (Live Call Consultations)
CREATE TABLE IF NOT EXISTS slots (
    id TEXT PRIMARY KEY,                              -- UUIDv4 or deterministic slot ID
    start_time TEXT NOT NULL UNIQUE,                 -- ISO-8601 UTC string (e.g. '2026-08-20T16:00:00.000Z')
    end_time TEXT NOT NULL,                           -- ISO-8601 UTC string (e.g. '2026-08-20T16:45:00.000Z')
    status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'locked', 'booked', 'cancelled', 'AVAILABLE', 'SOFT_LOCKED', 'BOOKED', 'CANCELLED')),
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

-- 2. Orders Table (Category A: 1, 3, 5 Cartas & Category B: Call Session)
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,                              -- UUIDv4
    tier_id TEXT NOT NULL CHECK(tier_id IN ('1_carta', '3_cartas', '5_cartas', 'call_session', 'llamada')),
    category TEXT NOT NULL CHECK(category IN ('Amor', 'Trabajo/Dinero', 'Familia', 'Otro')),
    amount_mxn REAL NOT NULL CHECK(amount_mxn > 0),
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    customer_phone TEXT,
    customer_birthdate TEXT NOT NULL,                 -- Format YYYY-MM-DD
    question TEXT NOT NULL,                           -- Mandatory for all tiers
    involved_names TEXT,                              -- Optional for 3 cartas, required/optional for 5 cartas
    core_focus TEXT,                                  -- Required for 5 cartas ("Qué es lo que más deseas saber")
    slot_id TEXT,                                     -- FK for call sessions (NULL for async readings)
    lock_token TEXT,                                  -- Session lock token for call sessions
    mp_preference_id TEXT,                            -- Mercado Pago Preference ID
    mp_payment_id TEXT,                               -- Mercado Pago Payment ID
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'failed', 'cancelled', 'expired', 'manual_review', 'approved', 'rejected', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'OVERBOOKED_NEEDS_RESCHEDULING')),
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

-- 3. Webhook Events Table (Mercado Pago Idempotency & Audit Trail)
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
