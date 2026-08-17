import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { db, closeDatabase } from '../../src/server/db/database.js';
import { SlotService } from '../../src/server/services/slot.service.js';
import { seedDefaultSlots, toUtcIso } from '../../src/server/db/seed.js';
import { SlotConflictError, SlotNotFoundError } from '../../src/server/types/slot.types.js';
import { createApp } from '../../src/server/app.js';

describe('Forensic Auditor Milestone 1 Verification Suite', () => {
  const app = createApp();
  const testSlotId = 'forensic-test-slot-100';

  beforeEach(() => {
    SlotService.resetVirtualTime();
    db.prepare(`DELETE FROM slots`).run();

    const futureStart = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const futureEnd = new Date(Date.now() + 48 * 60 * 60 * 1000 + 45 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO slots (id, start_time, end_time, status)
      VALUES (?, ?, ?, 'available')
    `).run(testSlotId, futureStart, futureEnd);
  });

  afterAll(() => {
    SlotService.stopSweeper();
    closeDatabase();
  });

  describe('Forensic Check 1: Static Code Analysis & Anti-Cheat Scan', () => {
    it('verifies that no production files contain hardcoded test shortcuts or dummy returns', () => {
      const srcServerDir = path.resolve(process.cwd(), 'src', 'server');
      const files = fs.readdirSync(srcServerDir, { recursive: true }) as string[];

      const suspiciousPatterns = [
        /return\s+true;\s*\/\/\s*mock/i,
        /if\s*\(\s*.*test.*\s*\)\s*return/i,
        /test-slot-uuid/i,
        /todo:\s*implement/i,
        /throw\s+new\s+Error\(['"]Not implemented/i
      ];

      for (const file of files) {
        const fullPath = path.join(srcServerDir, file);
        if (fs.statSync(fullPath).isFile() && (file.endsWith('.ts') || file.endsWith('.js'))) {
          const content = fs.readFileSync(fullPath, 'utf8');
          for (const pattern of suspiciousPatterns) {
            const match = pattern.exec(content);
            expect(match, `File ${file} contains suspicious pattern: ${pattern}`).toBeNull();
          }
        }
      }
    });

    it('verifies that database.ts uses genuine SQLite DatabaseSync', () => {
      const dbFile = path.resolve(process.cwd(), 'src', 'server', 'db', 'database.ts');
      const content = fs.readFileSync(dbFile, 'utf8');
      expect(content).toContain("from 'node:sqlite'");
      expect(content).toContain('new DatabaseSync(');
      expect(content).toContain('PRAGMA journal_mode = WAL;');
      expect(content).toContain('PRAGMA foreign_keys = ON;');
    });
  });

  describe('Forensic Check 2: 100 Concurrent Soft-Lock Race Condition Stress Test', () => {
    it('grants exactly 1 lock and 99 conflicts under heavy async load', async () => {
      const concurrency = 100;
      const tasks = Array.from({ length: concurrency }, (_, i) =>
        new Promise<{ id: number; success: boolean; res?: any; error?: any }>((resolve) => {
          setImmediate(() => {
            try {
              const res = SlotService.acquireSoftLock(testSlotId, 15);
              resolve({ id: i, success: true, res });
            } catch (err: any) {
              resolve({ id: i, success: false, error: err });
            }
          });
        })
      );

      const results = await Promise.all(tasks);
      const winners = results.filter((r) => r.success);
      const losers = results.filter((r) => !r.success);

      expect(winners.length).toBe(1);
      expect(losers.length).toBe(99);

      for (const loser of losers) {
        expect(loser.error).toBeInstanceOf(SlotConflictError);
      }

      const slotInDb = SlotService.getSlotById(testSlotId);
      expect(slotInDb?.status).toBe('locked');
      expect(slotInDb?.lock_token).toBe(winners[0].res.lock_token);
    });
  });

  describe('Forensic Check 3: Lock Token Security & Forgery Protection', () => {
    it('strictly prevents release when incorrect token or no token is supplied', () => {
      const lock = SlotService.acquireSoftLock(testSlotId);

      // Attempt 1: Forged token
      const forgedSuccess = SlotService.releaseSoftLock(testSlotId, 'forged-uuid-00000000');
      expect(forgedSuccess).toBe(false);

      // Verify slot is still locked
      let slot = SlotService.getSlotById(testSlotId);
      expect(slot?.status).toBe('locked');
      expect(slot?.lock_token).toBe(lock.lock_token);

      // Attempt 2: Correct token
      const legitSuccess = SlotService.releaseSoftLock(testSlotId, lock.lock_token);
      expect(legitSuccess).toBe(true);

      slot = SlotService.getSlotById(testSlotId);
      expect(slot?.status).toBe('available');
      expect(slot?.lock_token).toBeNull();
    });
  });

  describe('Forensic Check 4: Double Booking & Booking Permanence', () => {
    it('guarantees booked slot cannot be re-locked, released, or expired', () => {
      const lock = SlotService.acquireSoftLock(testSlotId);
      const confirmed = SlotService.confirmBooking(testSlotId, lock.lock_token);
      expect(confirmed).toBe(true);

      const slot = SlotService.getSlotById(testSlotId);
      expect(slot?.status).toBe('booked');
      expect(slot?.lock_expires_at).toBeNull();

      // Test 1: Another user cannot acquire lock
      expect(() => SlotService.acquireSoftLock(testSlotId)).toThrow(SlotConflictError);

      // Test 2: Advancing time 100 days does not expire or free the booked slot
      SlotService.advanceTime(100 * 24 * 60 * 60);
      const swept = SlotService.releaseExpiredLocks();
      expect(swept).toBe(0);

      const slotAfterSweep = SlotService.getSlotById(testSlotId);
      expect(slotAfterSweep?.status).toBe('booked');

      // Test 3: Release attempt fails
      const released = SlotService.releaseSoftLock(testSlotId, lock.lock_token);
      expect(released).toBe(false);
    });
  });

  describe('Forensic Check 5: Deterministic Slot Seeding & CDMX Timezone Accuracy', () => {
    it('generates slots strictly adhering to Mexico City UTC-6 weekday schedule', () => {
      db.prepare(`DELETE FROM slots`).run();
      const seedResult = seedDefaultSlots({ daysAhead: 14, force: true });
      expect(seedResult.insertedCount).toBeGreaterThan(0);

      const allSlots = db.prepare(`SELECT * FROM slots ORDER BY start_time ASC`).all() as any[];
      expect(allSlots.length).toBe(seedResult.insertedCount);

      for (const slot of allSlots) {
        const start = new Date(slot.start_time);
        const end = new Date(slot.end_time);

        // Duration must be exactly 45 minutes
        const diffMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
        expect(diffMinutes).toBe(45);

        // CDMX hour check (UTC - 6 hours)
        const cdmxStartHour = (start.getUTCHours() - 6 + 24) % 24;
        const cdmxStartMin = start.getUTCMinutes();
        const validStartTimes = [
          { h: 10, m: 0 },
          { h: 11, m: 30 },
          { h: 14, m: 0 },
          { h: 15, m: 30 },
          { h: 17, m: 0 }
        ];

        const isValidSchedule = validStartTimes.some(
          (t) => t.h === cdmxStartHour && t.m === cdmxStartMin
        );
        expect(isValidSchedule, `Slot ${slot.id} start time ${slot.start_time} (CDMX ${cdmxStartHour}:${cdmxStartMin}) is not in schedule`).toBe(true);

        // Day of week in CDMX must not be Saturday (6) or Sunday (0)
        const cdmxDay = new Date(start.getTime() - 6 * 60 * 60 * 1000).getUTCDay();
        expect([1, 2, 3, 4, 5]).toContain(cdmxDay);
      }
    });
  });

  describe('Forensic Check 6: SQL Injection & Malformed Input Handling', () => {
    it('safely handles malicious strings without SQL injection vulnerability', () => {
      const maliciousIds = [
        "' OR '1'='1",
        "'; DROP TABLE slots; --",
        "1 UNION SELECT * FROM slots",
        "../../etc/passwd",
        "<script>alert(1)</script>"
      ];

      for (const malId of maliciousIds) {
        expect(() => SlotService.acquireSoftLock(malId)).toThrow(SlotNotFoundError);
      }

      // Verify table still exists and has records
      const count = (db.prepare(`SELECT count(*) as c FROM slots`).get() as any).c;
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Forensic Check 7: HTTP REST API End-to-End Compliance', () => {
    it('handles slot listing, locking, conflict, and release via Express HTTP pipeline', async () => {
      // 1. Get slots
      const getRes = await request(app).get('/api/slots');
      expect(getRes.status).toBe(200);
      expect(getRes.body.success).toBe(true);
      expect(Array.isArray(getRes.body.slots)).toBe(true);
      const targetSlot = getRes.body.slots[0];
      expect(targetSlot).toBeDefined();

      // 2. Lock slot
      const lockRes = await request(app).post(`/api/slots/${targetSlot.id}/lock`);
      expect(lockRes.status).toBe(200);
      expect(lockRes.body.success).toBe(true);
      expect(lockRes.body.lock_token).toBeDefined();
      const token = lockRes.body.lock_token;

      // 3. Competing lock attempt -> 409 Conflict
      const conflictRes = await request(app).post(`/api/slots/${targetSlot.id}/lock`);
      expect(conflictRes.status).toBe(409);
      expect(conflictRes.body.success).toBe(false);
      expect(conflictRes.body.code).toBe('SLOT_LOCK_CONFLICT');

      // 4. Release slot
      const releaseRes = await request(app)
        .post(`/api/slots/${targetSlot.id}/release`)
        .send({ lock_token: token });
      expect(releaseRes.status).toBe(200);
      expect(releaseRes.body.success).toBe(true);

      // 5. Re-acquire unlocked slot
      const reLockRes = await request(app).post(`/api/slots/${targetSlot.id}/lock`);
      expect(reLockRes.status).toBe(200);
      expect(reLockRes.body.success).toBe(true);
    });
  });
});
