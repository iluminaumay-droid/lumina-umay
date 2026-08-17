import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/database.js';
import {
  Slot,
  AvailableSlotDTO,
  LockAcquisitionResult,
  SlotNotFoundError,
  SlotConflictError,
} from '../types/slot.types.js';

export class SlotService {
  private static DEFAULT_TTL_MINUTES = 15;
  private static sweeperTimer: NodeJS.Timeout | null = null;
  private static timeOffsetMs = 0;

  /**
   * Virtual time offset for testing.
   */
  static setTimeOffset(offsetMs: number): void {
    this.timeOffsetMs = offsetMs;
  }

  static advanceTime(seconds: number): void {
    this.timeOffsetMs += seconds * 1000;
    this.releaseExpiredLocks();
  }

  static resetVirtualTime(): void {
    this.timeOffsetMs = 0;
  }

  static getCurrentTime(): Date {
    return new Date(Date.now() + this.timeOffsetMs);
  }

  static getCurrentIso(): string {
    return this.getCurrentTime().toISOString();
  }

  /**
   * Converts UTC ISO string to CDMX date components.
   * Mexico City is UTC-6 year-round.
   */
  private static parseUtcToCdmx(utcIso: string): { date: string; time_start: string } {
    const utcDate = new Date(utcIso);
    // CDMX is UTC-6
    const cdmxDate = new Date(utcDate.getTime() - 6 * 60 * 60 * 1000);
    const date = cdmxDate.toISOString().slice(0, 10);
    const hours = String(cdmxDate.getUTCHours()).padStart(2, '0');
    const minutes = String(cdmxDate.getUTCMinutes()).padStart(2, '0');
    return {
      date,
      time_start: `${hours}:${minutes}`,
    };
  }

  /**
   * Retrieves all available upcoming slots after releasing expired soft-locks.
   */
  static getAvailableSlots(fromDateOrDate?: string): AvailableSlotDTO[] {
    const now = this.getCurrentIso();

    // 1. Lazy cleanup of expired locks
    this.releaseExpiredLocks();

    // 2. Fetch available slots
    let query = `
      SELECT *
      FROM slots
      WHERE status IN ('available', 'AVAILABLE')
    `;
    const params: any[] = [];

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

    query += ` ORDER BY start_time ASC`;

    const rawSlots = db.prepare(query).all(...params) as Slot[];

    return rawSlots.map((s) => {
      const startCdmx = this.parseUtcToCdmx(s.start_time);
      const endCdmx = this.parseUtcToCdmx(s.end_time);

      return {
        id: s.id,
        start_time: s.start_time,
        end_time: s.end_time,
        startTime: s.start_time,
        endTime: s.end_time,
        status: 'AVAILABLE',
        date: startCdmx.date,
        time_start: startCdmx.time_start,
        time_end: endCdmx.time_start,
      };
    });
  }

  /**
   * Atomically acquires a soft-lock on a slot using a conditional SQL update.
   */
  static acquireSoftLock(slotId: string, ttlMinutes: number = this.DEFAULT_TTL_MINUTES): LockAcquisitionResult {
    const now = this.getCurrentTime();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString();
    const lockToken = uuidv4();

    const lockTx = db.transaction(() => {
      // 1. Check if slot exists
      const existing = db.prepare(`SELECT id, status, lock_expires_at FROM slots WHERE id = ?`).get(slotId) as
        | { id: string; status: string; lock_expires_at: string | null }
        | undefined;

      if (!existing) {
        throw new SlotNotFoundError(slotId);
      }

      if (existing.status === 'booked' || existing.status === 'BOOKED') {
        throw new SlotConflictError('Este horario ya ha sido confirmado y reservado permanentemente.');
      }

      // 2. Execute atomic test-and-set conditional update
      const updateStmt = db.prepare(`
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
      `);

      const result = updateStmt.run(nowIso, expiresAt, lockToken, nowIso, slotId, nowIso);

      if (result.changes === 0) {
        throw new SlotConflictError('El horario seleccionado ya fue apartado por otra persona. Por favor elige otro horario.');
      }

      return {
        slot_id: slotId,
        lock_token: lockToken,
        expires_at: expiresAt,
        slotId,
        lockToken,
        expiresAt,
      };
    });

    return lockTx();
  }

  /**
   * Releases a soft-lock held by a specific token.
   */
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

  /**
   * Permanently confirms a slot booking upon verified Mercado Pago payment approval.
   */
  static confirmBooking(slotId: string, lockToken?: string): boolean {
    const nowIso = this.getCurrentIso();

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
              (status IN ('locked', 'SOFT_LOCKED') AND lock_token = ?)
              OR status IN ('available', 'AVAILABLE')
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
            AND status IN ('available', 'AVAILABLE', 'locked', 'SOFT_LOCKED')
        `);
        result = stmt.run(nowIso, slotId);
      }

      return result.changes > 0;
    });

    return confirmTx();
  }

  /**
   * Reclaims all soft-locks whose expiration timestamp is in the past.
   */
  static releaseExpiredLocks(): number {
    const nowIso = this.getCurrentIso();

    const stmt = db.prepare(`
      UPDATE slots
      SET status = 'available',
          locked_at = NULL,
          lock_expires_at = NULL,
          lock_token = NULL,
          updated_at = ?
      WHERE status IN ('locked', 'SOFT_LOCKED')
        AND lock_expires_at <= ?
    `);

    const result = stmt.run(nowIso, nowIso);
    return result.changes;
  }

  /**
   * Starts the background TTL sweeper interval daemon.
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

export const slotService = SlotService;
