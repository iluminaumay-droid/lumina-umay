import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface DatabaseConfig {
  dbPath?: string;
  verbose?: boolean;
}

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export class LuminaDatabase {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(dbPath);

    // Configure SQLite WAL mode & pragmas
    try {
      if (dbPath !== ':memory:') {
        this.db.exec('PRAGMA journal_mode = WAL;');
      }
      this.db.exec('PRAGMA synchronous = NORMAL;');
      this.db.exec('PRAGMA foreign_keys = ON;');
      this.db.exec('PRAGMA busy_timeout = 5000;');
    } catch (err) {
      console.warn('[Database] Pragma configuration notice:', err);
    }
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  pragma(pragmaSql: string): any {
    const trimmed = pragmaSql.trim();
    if (trimmed.includes('=')) {
      this.db.exec(`PRAGMA ${trimmed};`);
      return null;
    } else {
      try {
        return this.db.prepare(`PRAGMA ${trimmed}`).all();
      } catch {
        this.db.exec(`PRAGMA ${trimmed};`);
        return null;
      }
    }
  }

  prepare(sql: string) {
    const stmt = this.db.prepare(sql);
    return {
      run: (...params: any[]): RunResult => {
        const res = stmt.run(...params);
        return {
          changes: Number(res.changes),
          lastInsertRowid: res.lastInsertRowid,
        };
      },
      get: (...params: any[]): any => {
        return stmt.get(...params);
      },
      all: (...params: any[]): any[] => {
        return stmt.all(...params);
      },
    };
  }

  transaction<T extends (...args: any[]) => any>(fn: T): T {
    return ((...args: any[]) => {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn(...args);
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          this.db.exec('ROLLBACK');
        } catch {
          // ignore rollback error
        }
        throw error;
      }
    }) as T;
  }

  close(): void {
    this.db.close();
  }
}

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

let dbInstance: LuminaDatabase | null = null;

export function getDatabase(config?: DatabaseConfig): LuminaDatabase {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath =
    config?.dbPath ||
    process.env.DB_PATH ||
    process.env.DATABASE_PATH ||
    path.resolve(process.cwd(), 'data', 'lumina_umay.sqlite');

  const luminaDb = new LuminaDatabase(dbPath);

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

  dbInstance = luminaDb;
  return dbInstance;
}

export function initDatabase(config?: DatabaseConfig): LuminaDatabase {
  return getDatabase(config);
}

export function getDb(config?: DatabaseConfig): LuminaDatabase {
  return getDatabase(config);
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export function closeDb(): void {
  closeDatabase();
}

/**
 * Proxy object for `db` so that importing `{ db }` always accesses the current active database instance.
 */
export const db: LuminaDatabase = new Proxy({} as LuminaDatabase, {
  get(_target, prop: keyof LuminaDatabase) {
    const instance = getDatabase();
    const value = instance[prop];
    if (typeof value === 'function') {
      return (value as Function).bind(instance);
    }
    return value;
  },
});
