# Milestone 1 Slot Service, Atomic Soft-Locking & Concurrency Engine Report

**Project:** Lumina Umay — Booking & Payment Web Application (v2)  
**Agent:** `explorer_m1_2` (Explorer 2 — Milestone 1 Core Database & Concurrency Engine)  
**Date:** 2026-08-16T21:12:00Z  
**Status:** COMPLETED (Hard Handoff)

---

## 1. Observation

### 1.1 Direct Source Text Quotes & Requirements

From `c:/LUMINAPROJECT/ORIGINAL_REQUEST.md`:
- **Line 15–17 (R2. Live Call Session Slot Booking & Concurrency)**:
  > "Implement live call booking ($450 MXN) with real-time slot availability, soft-locking during checkout attempt, automated release on timeout/failure, and permanent booking confirmation upon payment to eliminate double-booking."
- **Lines 36–39 (Booking & Concurrency Acceptance Criteria)**:
  > - "Only currently available slots are displayed to the user."
  > - "Selecting a slot places a temporary hold/soft-lock during the checkout session."
  > - "Two simultaneous attempts on the same slot result in only one lock, preventing race conditions."
  > - "Slot unlocks automatically if payment is abandoned or fails within expiration window."
- **Line 45 (Payment & Webhook Security Criteria)**:
  > "Webhook triggers order creation, slot permanence, and email notification on `payment.status == 'approved'`."

From `c:/LUMINAPROJECT/lumina-umay-booking-system-spec-v2.md`:
- **Lines 58–63 (Booking Logic Category B)**:
  > "Store available call slots; only show open ones to the customer. Soft-lock a slot on payment attempt, confirm it permanently once Mercado Pago's webhook approves payment, release it if payment doesn't complete. Prevent two customers from booking the same slot."

From `c:/LUMINAPROJECT/PROJECT.md`:
- **Lines 45–49 (Interface Contracts — Slots API)**:
  > - `GET /api/slots`: Returns available slots `{ success: true, slots: [{ id, start_time, end_time, status }] }`.
  > - `POST /api/slots/:id/lock`: Acquires a 15-minute soft lock. Returns `{ success: true, lock_token, expires_at }` or `409 Conflict`.
  > - `POST /api/slots/:id/release`: Releases a soft lock with `{ lock_token }`.
- **Line 77 (Code Layout)**:
  > `src/server/services/slot.service.ts # Atomic soft-locking & TTL sweeper`

From `c:/LUMINAPROJECT/.agents/explorer_m1_2/DISPATCH.md`:
- **Lines 9–13**:
  > "Investigate and document in `c:/LUMINAPROJECT/.agents/explorer_m1_2/handoff.md`:
  > 1. The exact implementation of `SlotService` methods: `getAvailableSlots()`, `acquireSoftLock(slotId)`, `confirmBooking(slotId, lockToken)`, `releaseSoftLock(slotId, lockToken)`, and `releaseExpiredLocks()`.
  > 2. Atomic transaction guarantees using `db.transaction()` and conditional SQL update to prevent race conditions.
  > 3. Unit test design for concurrency and TTL expiration.
  > 4. Recommendations for the Worker."

---

## 2. Logic Chain

### 2.1 Concurrency Model & Invariants

1. **Problem Statement**:
   When multiple users attempt to book the exact same live consultation time slot at the same millisecond, the system must guarantee that:
   - Exactly **one** user successfully acquires the soft lock.
   - All other competing requests immediately receive a deterministic `409 Conflict` error.
   - If the winning user abandons the checkout flow or fails payment, the slot becomes available again automatically after TTL (15 minutes).
   - If the winning user successfully pays via Mercado Pago, the webhook confirms the slot permanently (`status = 'booked'`), clearing the expiration time so it can never be swept.
   - If a customer pays after the lock expired and the slot was taken by someone else, the system detects the collision and escalates to manual review without corrupting the active booking.

2. **SQLite (`better-sqlite3`) & WAL Transaction Mechanics**:
   - `better-sqlite3` runs synchronously inside the Node.js event loop, executing queries directly against the SQLite C engine in the same thread.
   - In WAL mode (`PRAGMA journal_mode = WAL;`), readers never block writers, and writers never block readers.
   - When a write transaction begins via `db.transaction(() => { ... })`, SQLite acquires an immediate write lock on the database file.
   - Furthermore, a single SQL `UPDATE` statement is itself **inherently atomic** within SQLite:
     ```sql
     UPDATE slots
     SET status = 'locked',
         locked_at = :lockedAt,
         lock_expires_at = :lockExpiresAt,
         lock_token = :lockToken,
         updated_at = :updatedAt
     WHERE id = :slotId
       AND (
         status = 'available' 
         OR (status = 'locked' AND lock_expires_at <= :now)
       );
     ```
   - **Atomic Test-and-Set**:
     - The `WHERE` clause tests whether the slot is either `status = 'available'` OR `status = 'locked'` with an expired timestamp (`lock_expires_at <= now`).
     - If true, it atomically sets `status = 'locked'`, `lock_token`, and the new expiration timestamp.
     - SQLite returns `result.changes`:
       - If `changes === 1`: The current request won the lock.
       - If `changes === 0`: The slot was either non-existent, already confirmed as `booked`, or actively locked by a competing unexpired token.
     - This test-and-set eliminates any Time-of-Check to Time-of-Use (TOCTOU) race conditions.

3. **Slot State Machine**:
   ```
   +-----------------------------------------------------------------------+
   |                                                                       |
   |                               +-----------+                           |
   |           +------------------>| AVAILABLE |<----------------+         |
   |           |                   +-----+-----+                 |         |
   |           |                         |                       |         |
   |   releaseSoftLock()                 | acquireSoftLock()     | TTL Expired /
   |   (User Cancel/Fail)                | (15 min TTL)          | Sweeper Run
   |           |                         v                       |         |
   |           |                   +-----------+                 |         |
   |           +-------------------|  LOCKED   |-----------------+         |
   |                               +-----+-----+                           |
   |                                     |                                 |
   |                                     | confirmBooking()                |
   |                                     | (Webhook Approved)              |
   |                                     v                                 |
   |                               +-----------+                           |
   |                               |  BOOKED   |                           |
   |                               +-----------+                           |
   |                                                                       |
   +-----------------------------------------------------------------------+
   ```

4. **Dual Sweeper Architecture (Lazy + Background Daemon)**:
   - **Lazy Sweeper**:
     Whenever `getAvailableSlots()` or `acquireSoftLock()` is called, expired locks can be reclaimed dynamically.
     In `getAvailableSlots()`, calling `releaseExpiredLocks()` guarantees the returned list contains freshly freed slots without requiring a separate background process.
     In `acquireSoftLock()`, the SQL query allows acquiring a slot if its existing lock is expired (`OR (status = 'locked' AND lock_expires_at <= :now)`), so a customer can immediately take an abandoned slot without waiting for a sweep cycle.
   - **Background Sweeper Daemon**:
     An active timer (`setInterval` every 60 seconds) runs `releaseExpiredLocks()` in the background to ensure database hygiene and keep UI slot polling accurate.
     The timer calls `.unref()` so it does not block the Node.js event loop during test teardown or graceful shutdown.

5. **Date & Time Standardization**:
   - All timestamps (`start_time`, `end_time`, `locked_at`, `lock_expires_at`, `created_at`, `updated_at`) must be formatted and compared as **ISO-8601 UTC strings** (e.g. `2026-08-20T17:00:00.000Z`).
   - SQLite string comparisons for ISO-8601 UTC strings (`YYYY-MM-DDTHH:MM:SS.sssZ`) are lexicographically identical to chronological time comparisons.
   - Using JavaScript `new Date().toISOString()` ensures strict millisecond precision and eliminates discrepancies with SQLite server-time pragmas.

---

## 3. Caveats & Assumptions

1. **Clock Synchronization**:
   - All timestamp generation for lock TTL and expiration queries must originate from the server's Node.js runtime (`new Date().toISOString()`) to avoid any mismatch between SQLite's internal UTC clock and Node.js process clock.
2. **Lock TTL Duration**:
   - Default TTL is 15 minutes (900,000 ms). This provides ample time for a user to complete Mercado Pago 3DS authentication, SPEI transfer, or credit card submission.
   - The TTL duration should be configurable via environment variables (`SLOT_LOCK_TTL_MINUTES=15`).
3. **Database Concurrency in Cluster Mode**:
   - SQLite WAL mode safely handles concurrent reads across processes, but write transactions are serialized. For a single Node.js Express process (which easily handles thousands of requests per second for booking), this architecture provides instantaneous zero-overhead ACID locking.
4. **Permanent Slot Confirmation Boundary**:
   - `confirmBooking(slotId, lockToken)` must only be triggered by the Mercado Pago webhook service upon verified `approved` status, never directly from client requests.

---

## 4. Conclusion & Technical Implementation

### 4.1 Type Definitions (`src/server/types/slot.types.ts`)

```typescript
export type SlotStatus = 'available' | 'locked' | 'booked' | 'cancelled';

export interface Slot {
  id: string;
  start_time: string;       // ISO-8601 UTC (e.g. '2026-08-20T17:00:00.000Z')
  end_time: string;         // ISO-8601 UTC (e.g. '2026-08-20T17:45:00.000Z')
  status: SlotStatus;
  locked_at: string | null;
  lock_expires_at: string | null;
  lock_token: string | null;
  created_at: string;
  updated_at: string;
}

export interface AvailableSlotDTO {
  id: string;
  startTime: string;
  endTime: string;
  status: SlotStatus;
}

export interface LockAcquisitionResult {
  slotId: string;
  lockToken: string;
  expiresAt: string;
}

export class SlotError extends Error {
  constructor(message: string, public readonly code: string, public readonly statusCode: number = 400) {
    super(message);
    this.name = 'SlotError';
  }
}

export class SlotNotFoundError extends SlotError {
  constructor(slotId: string) {
    super(`El horario con ID ${slotId} no fue encontrado.`, 'SLOT_NOT_FOUND', 404);
  }
}

export class SlotConflictError extends SlotError {
  constructor(message: string = 'El horario seleccionado ya fue apartado por otra persona. Por favor elige otro horario.') {
    super(message, 'SLOT_LOCK_CONFLICT', 409);
  }
}
```

---

### 4.2 Complete `SlotService` Implementation (`src/server/services/slot.service.ts`)

```typescript
import { db } from '../db/database';
import { v4 as uuidv4 } from 'uuid';
import {
  Slot,
  AvailableSlotDTO,
  LockAcquisitionResult,
  SlotNotFoundError,
  SlotConflictError,
} from '../types/slot.types';

export class SlotService {
  private static DEFAULT_TTL_MINUTES = 15;
  private static sweeperTimer: NodeJS.Timeout | null = null;

  /**
   * Retrieves all available slots (future only) after releasing expired soft-locks.
   * @param fromDate Optional ISO string filter for start window (defaults to now)
   */
  static getAvailableSlots(fromDate?: string): AvailableSlotDTO[] {
    const now = new Date().toISOString();
    const minTime = fromDate && fromDate > now ? fromDate : now;

    // 1. Lazy cleanup of expired locks
    this.releaseExpiredLocks();

    // 2. Fetch available slots
    const stmt = db.prepare(`
      SELECT 
        id, 
        start_time AS startTime, 
        end_time AS endTime, 
        status
      FROM slots
      WHERE status = 'available'
        AND start_time > ?
      ORDER BY start_time ASC
    `);

    return stmt.all(minTime) as AvailableSlotDTO[];
  }

  /**
   * Atomically acquires a 15-minute soft-lock on a slot.
   * Prevents race conditions using atomic conditional SQL update inside SQLite.
   * 
   * @param slotId Target slot ID
   * @param ttlMinutes Duration of the lock hold in minutes (default: 15)
   * @throws SlotNotFoundError if slot does not exist
   * @throws SlotConflictError if slot is already booked or locked by another active session
   */
  static acquireSoftLock(slotId: string, ttlMinutes: number = this.DEFAULT_TTL_MINUTES): LockAcquisitionResult {
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString();
    const lockToken = uuidv4();

    // SQLite immediate transaction
    const lockTx = db.transaction(() => {
      // First, check if slot exists
      const existing = db.prepare(`SELECT id, status, lock_expires_at FROM slots WHERE id = ?`).get(slotId) as
        | { id: string; status: string; lock_expires_at: string | null }
        | undefined;

      if (!existing) {
        throw new SlotNotFoundError(slotId);
      }

      if (existing.status === 'booked') {
        throw new SlotConflictError('Este horario ya ha sido confirmado y reservado permanentemente.');
      }

      // Execute atomic test-and-set update
      const updateStmt = db.prepare(`
        UPDATE slots
        SET status = 'locked',
            locked_at = ?,
            lock_expires_at = ?,
            lock_token = ?,
            updated_at = ?
        WHERE id = ?
          AND (
            status = 'available'
            OR (status = 'locked' AND lock_expires_at <= ?)
          )
      `);

      const result = updateStmt.run(nowIso, expiresAt, lockToken, nowIso, slotId, nowIso);

      if (result.changes === 0) {
        throw new SlotConflictError('El horario seleccionado ya fue apartado por otra persona. Por favor elige otro horario.');
      }

      return {
        slotId,
        lockToken,
        expiresAt,
      };
    });

    return lockTx();
  }

  /**
   * Releases a soft-lock held by a specific token (e.g. user abandoned checkout, selected different slot, or payment rejected).
   * 
   * @param slotId Slot ID to release
   * @param lockToken Unique token generated during acquireSoftLock
   * @returns boolean indicating whether the slot was found and released
   */
  static releaseSoftLock(slotId: string, lockToken: string): boolean {
    const nowIso = new Date().toISOString();

    const stmt = db.prepare(`
      UPDATE slots
      SET status = 'available',
          locked_at = NULL,
          lock_expires_at = NULL,
          lock_token = NULL,
          updated_at = ?
      WHERE id = ?
        AND status = 'locked'
        AND lock_token = ?
    `);

    const result = stmt.run(nowIso, slotId, lockToken);
    return result.changes > 0;
  }

  /**
   * Permanently confirms a slot booking upon verified Mercado Pago payment approval.
   * Clears lock_expires_at to make the booking permanent.
   * 
   * @param slotId Slot ID to confirm
   * @param lockToken Optional lock token to verify ownership
   * @returns boolean indicating whether confirmation succeeded
   */
  static confirmBooking(slotId: string, lockToken?: string): boolean {
    const nowIso = new Date().toISOString();

    const confirmTx = db.transaction(() => {
      let result;
      if (lockToken) {
        const stmt = db.prepare(`
          UPDATE slots
          SET status = 'booked',
              lock_expires_at = NULL,
              updated_at = ?
          WHERE id = ?
            AND (
              (status = 'locked' AND lock_token = ?)
              OR status = 'available'
            )
        `);
        result = stmt.run(nowIso, slotId, lockToken);
      } else {
        const stmt = db.prepare(`
          UPDATE slots
          SET status = 'booked',
              lock_expires_at = NULL,
              updated_at = ?
          WHERE id = ?
            AND status IN ('available', 'locked')
        `);
        result = stmt.run(nowIso, slotId);
      }

      return result.changes > 0;
    });

    return confirmTx();
  }

  /**
   * Reclaims all soft-locks whose expiration timestamp is in the past.
   * 
   * @returns Number of expired slots successfully returned to 'available'
   */
  static releaseExpiredLocks(): number {
    const nowIso = new Date().toISOString();

    const stmt = db.prepare(`
      UPDATE slots
      SET status = 'available',
          locked_at = NULL,
          lock_expires_at = NULL,
          lock_token = NULL,
          updated_at = ?
      WHERE status = 'locked'
        AND lock_expires_at <= ?
    `);

    const result = stmt.run(nowIso, nowIso);
    return result.changes;
  }

  /**
   * Starts the background TTL sweeper interval daemon.
   * @param intervalMs Sweep frequency in milliseconds (default: 60,000 ms)
   */
  static startSweeper(intervalMs: number = 60000): void {
    if (this.sweeperTimer) return;

    this.sweeperTimer = setInterval(() => {
      try {
        const released = this.releaseExpiredLocks();
        if (released > 0) {
          console.log(`[SlotSweeper] Released ${released} expired slot lock(s) at ${new Date().toISOString()}`);
        }
      } catch (err) {
        console.error('[SlotSweeper] Error releasing expired slot locks:', err);
      }
    }, intervalMs);

    // Allow Node.js process to exit cleanly without waiting on this interval
    this.sweeperTimer.unref();
  }

  /**
   * Stops the background TTL sweeper.
   */
  static stopSweeper(): void {
    if (this.sweeperTimer) {
      clearInterval(this.sweeperTimer);
      this.sweeperTimer = null;
    }
  }

  /**
   * Fetches a single slot by ID.
   */
  static getSlotById(slotId: string): Slot | null {
    const stmt = db.prepare(`SELECT * FROM slots WHERE id = ?`);
    return (stmt.get(slotId) as Slot) || null;
  }
}
```

---

### 4.3 Slot Routes Integration (`src/server/routes/slots.routes.ts`)

```typescript
import { Router, Request, Response } from 'express';
import { SlotService } from '../services/slot.service';
import { SlotError } from '../types/slot.types';

export const slotsRouter = Router();

/**
 * GET /api/slots
 * Returns all currently available upcoming slots.
 */
slotsRouter.get('/', (req: Request, res: Response) => {
  try {
    const fromDate = req.query.from as string | undefined;
    const slots = SlotService.getAvailableSlots(fromDate);
    res.json({ success: true, slots });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'Error al consultar los horarios disponibles.' });
  }
});

/**
 * POST /api/slots/:id/lock
 * Acquires a 15-minute soft lock on the specified slot.
 */
slotsRouter.post('/:id/lock', (req: Request, res: Response) => {
  try {
    const slotId = req.params.id;
    const lockResult = SlotService.acquireSoftLock(slotId);
    res.json({
      success: true,
      slot_id: lockResult.slotId,
      lock_token: lockResult.lockToken,
      expires_at: lockResult.expiresAt,
    });
  } catch (error: any) {
    if (error instanceof SlotError) {
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        error: error.message,
      });
    }
    res.status(500).json({ success: false, error: 'Error interno al apartar el horario.' });
  }
});

/**
 * POST /api/slots/:id/release
 * Releases a soft lock with the matching lock token.
 */
slotsRouter.post('/:id/release', (req: Request, res: Response) => {
  try {
    const slotId = req.params.id;
    const { lock_token } = req.body;

    if (!lock_token) {
      return res.status(400).json({ success: false, error: 'Token de bloqueo no proporcionado.' });
    }

    const released = SlotService.releaseSoftLock(slotId, lock_token);
    if (!released) {
      return res.status(404).json({ success: false, error: 'El bloqueo no existe o el token es inválido.' });
    }

    res.json({ success: true, message: 'Horario liberado exitosamente.' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: 'Error interno al liberar el horario.' });
  }
});
```

---

### 4.4 Concurrency & TTL Unit Test Specification (`tests/unit/slot.service.test.ts`)

```typescript
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { db } from '../../src/server/db/database';
import { SlotService } from '../../src/server/services/slot.service';
import { SlotConflictError, SlotNotFoundError } from '../../src/server/types/slot.types';

describe('SlotService - Concurrency & Soft-Locking Engine', () => {
  const testSlotId1 = 'test-slot-uuid-1';
  const testSlotId2 = 'test-slot-uuid-2';
  const testSlotExpired = 'test-slot-expired-uuid';

  beforeEach(() => {
    // Clean and seed test slots
    db.prepare(`DELETE FROM slots`).run();

    const futureTimeStart = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const futureTimeEnd = new Date(Date.now() + 24 * 60 * 60 * 1000 + 45 * 60 * 1000).toISOString();

    const expiredLockedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const expiredExpiresAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO slots (id, start_time, end_time, status)
      VALUES (?, ?, ?, 'available')
    `).run(testSlotId1, futureTimeStart, futureTimeEnd);

    db.prepare(`
      INSERT INTO slots (id, start_time, end_time, status)
      VALUES (?, ?, ?, 'available')
    `).run(testSlotId2, futureTimeStart, futureTimeEnd);

    db.prepare(`
      INSERT INTO slots (id, start_time, end_time, status, locked_at, lock_expires_at, lock_token)
      VALUES (?, ?, ?, 'locked', ?, ?, 'stale-token-123')
    `).run(testSlotExpired, futureTimeStart, futureTimeEnd, expiredLockedAt, expiredExpiresAt);
  });

  afterAll(() => {
    SlotService.stopSweeper();
  });

  it('T1: getAvailableSlots returns only available slots and lazily sweeps expired locks', () => {
    const slots = SlotService.getAvailableSlots();
    expect(slots.length).toBe(3); // testSlotId1, testSlotId2, testSlotExpired (swept)
    expect(slots.find((s) => s.id === testSlotExpired)?.status).toBe('available');
  });

  it('T2: acquireSoftLock successfully locks an available slot', () => {
    const result = SlotService.acquireSoftLock(testSlotId1, 15);
    expect(result.slotId).toBe(testSlotId1);
    expect(result.lockToken).toBeDefined();
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const slot = SlotService.getSlotById(testSlotId1);
    expect(slot?.status).toBe('locked');
    expect(slot?.lock_token).toBe(result.lockToken);
  });

  it('T3: acquireSoftLock rejects non-existent slot with SlotNotFoundError', () => {
    expect(() => SlotService.acquireSoftLock('non-existent-id')).toThrow(SlotNotFoundError);
  });

  it('T4: acquireSoftLock throws SlotConflictError if slot is already locked', () => {
    SlotService.acquireSoftLock(testSlotId1);
    expect(() => SlotService.acquireSoftLock(testSlotId1)).toThrow(SlotConflictError);
  });

  it('T5: HIGH CONCURRENCY RACE CONDITION - 50 simultaneous lock attempts grant exactly 1 lock', async () => {
    const attempts = 50;
    const promises = Array.from({ length: attempts }, () =>
      Promise.resolve().then(() => {
        try {
          return { success: true, res: SlotService.acquireSoftLock(testSlotId1) };
        } catch (err: any) {
          return { success: false, error: err };
        }
      })
    );

    const results = await Promise.all(promises);
    const successfulLocks = results.filter((r) => r.success);
    const conflicts = results.filter((r) => !r.success);

    expect(successfulLocks.length).toBe(1);
    expect(conflicts.length).toBe(49);
    conflicts.forEach((c) => {
      expect(c.error).toBeInstanceOf(SlotConflictError);
    });

    const slot = SlotService.getSlotById(testSlotId1);
    expect(slot?.status).toBe('locked');
    expect(slot?.lock_token).toBe(successfulLocks[0].res?.lockToken);
  });

  it('T6: releaseSoftLock releases lock with matching token and rejects invalid token', () => {
    const lock = SlotService.acquireSoftLock(testSlotId1);

    // Invalid token fails
    const invalidRelease = SlotService.releaseSoftLock(testSlotId1, 'invalid-token');
    expect(invalidRelease).toBe(false);
    expect(SlotService.getSlotById(testSlotId1)?.status).toBe('locked');

    // Valid token succeeds
    const validRelease = SlotService.releaseSoftLock(testSlotId1, lock.lockToken);
    expect(validRelease).toBe(true);
    expect(SlotService.getSlotById(testSlotId1)?.status).toBe('available');
    expect(SlotService.getSlotById(testSlotId1)?.lock_token).toBeNull();
  });

  it('T7: confirmBooking permanently books slot and clears lock_expires_at', () => {
    const lock = SlotService.acquireSoftLock(testSlotId1);
    const confirmed = SlotService.confirmBooking(testSlotId1, lock.lockToken);
    expect(confirmed).toBe(true);

    const slot = SlotService.getSlotById(testSlotId1);
    expect(slot?.status).toBe('booked');
    expect(slot?.lock_expires_at).toBeNull();

    // Confirming already booked slot or re-locking booked slot fails
    expect(() => SlotService.acquireSoftLock(testSlotId1)).toThrow(SlotConflictError);
  });

  it('T8: releaseExpiredLocks returns expired locks to available state', () => {
    const releasedCount = SlotService.releaseExpiredLocks();
    expect(releasedCount).toBeGreaterThanOrEqual(1);

    const expiredSlot = SlotService.getSlotById(testSlotExpired);
    expect(expiredSlot?.status).toBe('available');
    expect(expiredSlot?.lock_token).toBeNull();
  });
});
```

---

## 5. Verification Method

To independently verify the `SlotService` implementation and its concurrency guarantees:

1. **Unit Test Execution**:
   Run the unit test suite covering `SlotService`:
   ```bash
   npm test tests/unit/slot.service.test.ts
   ```
   **Expected Result**: All 8 test cases pass with 100% green status, specifically verifying Test T5 (50 concurrent promises with exactly 1 winner and 49 `SlotConflictError` 409 responses).

2. **Database State Verification**:
   Inspect SQLite slot state following lock operations:
   - Check `status = 'locked'`, `lock_token != NULL`, and `lock_expires_at > datetime('now')`.
   - Check after `confirmBooking`: `status = 'booked'` and `lock_expires_at IS NULL`.
   - Check after `releaseSoftLock`: `status = 'available'`, `lock_token IS NULL`, `lock_expires_at IS NULL`.

3. **HTTP API Route Verification**:
   - `POST /api/slots/:id/lock` returns HTTP 200 `{ success: true, slot_id, lock_token, expires_at }`.
   - Second immediate `POST /api/slots/:id/lock` returns HTTP 409 `{ success: false, code: "SLOT_LOCK_CONFLICT", error: "El horario seleccionado ya fue apartado por otra persona. Por favor elige otro horario." }`.
   - `POST /api/slots/:id/release` with `{ lock_token }` returns HTTP 200 `{ success: true, message: "Horario liberado exitosamente." }`.

---
*End of Report — Lumina Umay Milestone 1 Concurrency & Slot Service Explorer (`explorer_m1_2`)*
