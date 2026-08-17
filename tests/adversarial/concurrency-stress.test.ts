import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { db, closeDatabase } from '../../src/server/db/database.js';
import { SlotService } from '../../src/server/services/slot.service.js';
import { SlotConflictError, SlotNotFoundError } from '../../src/server/types/slot.types.js';
import { createApp } from '../../src/server/app.js';

describe('Adversarial Concurrency, Stress & Race Condition Test Suite (Milestone 1)', () => {
  const app = createApp();
  const testSlotSingle = 'adv-slot-single-100';
  const testSlotBooked = 'adv-slot-booked-permanently';
  const testSlotTimeTravel = 'adv-slot-time-travel';

  beforeEach(() => {
    SlotService.resetVirtualTime();
    db.prepare(`DELETE FROM webhook_events`).run();
    db.prepare(`DELETE FROM orders`).run();
    db.prepare(`DELETE FROM slots`).run();

    const futureStart1 = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const futureEnd1 = new Date(Date.now() + 48 * 60 * 60 * 1000 + 45 * 60 * 1000).toISOString();

    const futureStart2 = new Date(Date.now() + 50 * 60 * 60 * 1000).toISOString();
    const futureEnd2 = new Date(Date.now() + 50 * 60 * 60 * 1000 + 45 * 60 * 1000).toISOString();

    const futureStart3 = new Date(Date.now() + 52 * 60 * 60 * 1000).toISOString();
    const futureEnd3 = new Date(Date.now() + 52 * 60 * 60 * 1000 + 45 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO slots (id, start_time, end_time, status)
      VALUES (?, ?, ?, 'available')
    `).run(testSlotSingle, futureStart1, futureEnd1);

    db.prepare(`
      INSERT INTO slots (id, start_time, end_time, status)
      VALUES (?, ?, ?, 'available')
    `).run(testSlotBooked, futureStart2, futureEnd2);

    db.prepare(`
      INSERT INTO slots (id, start_time, end_time, status)
      VALUES (?, ?, ?, 'available')
    `).run(testSlotTimeTravel, futureStart3, futureEnd3);
  });

  afterAll(() => {
    SlotService.stopSweeper();
    closeDatabase();
  });

  // =========================================================================
  // 1. 100 SIMULTANEOUS CONCURRENT LOCK ATTEMPTS
  // =========================================================================

  describe('1. 100 Simultaneous Concurrent Lock Attempts', () => {
    it('Adv-1.1: Direct Service Level — 100 simultaneous concurrent lock attempts yield exactly 1 winner and 99 conflicts', async () => {
      const concurrencyLevel = 100;

      // Dispatch 100 asynchronous calls simultaneously
      const promises = Array.from({ length: concurrencyLevel }, (_, idx) =>
        Promise.resolve().then(() => {
          try {
            const result = SlotService.acquireSoftLock(testSlotSingle, 15);
            return { index: idx, success: true, result, error: null };
          } catch (err: any) {
            return { index: idx, success: false, result: null, error: err };
          }
        })
      );

      const results = await Promise.all(promises);

      const winners = results.filter((r) => r.success);
      const losers = results.filter((r) => !r.success);

      expect(winners.length).toBe(1);
      expect(losers.length).toBe(99);

      // Verify the winning lock token is valid
      const winner = winners[0];
      expect(winner.result?.lock_token).toBeDefined();
      expect(typeof winner.result?.lock_token).toBe('string');
      expect(winner.result?.slot_id).toBe(testSlotSingle);

      // Verify all 99 losers received SlotConflictError
      losers.forEach((loser) => {
        expect(loser.error).toBeInstanceOf(SlotConflictError);
        expect(loser.error?.statusCode).toBe(409);
        expect(loser.error?.code).toBe('SLOT_LOCK_CONFLICT');
      });

      // Verify DB state
      const dbSlot = SlotService.getSlotById(testSlotSingle);
      expect(dbSlot?.status).toBe('locked');
      expect(dbSlot?.lock_token).toBe(winner.result?.lock_token);
      expect(dbSlot?.lock_expires_at).toBe(winner.result?.expires_at);
    });

    it('Adv-1.2: HTTP REST Level — 100 simultaneous concurrent POST /api/slots/:id/lock requests yield exactly 1 HTTP 200 and 99 HTTP 409', async () => {
      const concurrencyLevel = 100;

      // Dispatch 100 HTTP requests over Express pipeline simultaneously
      const promises = Array.from({ length: concurrencyLevel }, () =>
        request(app).post(`/api/slots/${testSlotSingle}/lock`)
      );

      const responses = await Promise.all(promises);

      const successes = responses.filter((r) => r.status === 200);
      const conflicts = responses.filter((r) => r.status === 409);
      const otherErrors = responses.filter((r) => r.status !== 200 && r.status !== 409);

      expect(otherErrors.length).toBe(0);
      expect(successes.length).toBe(1);
      expect(conflicts.length).toBe(99);

      const winnerBody = successes[0].body;
      expect(winnerBody.success).toBe(true);
      expect(winnerBody.lock_token).toBeDefined();
      expect(winnerBody.slot_id).toBe(testSlotSingle);

      conflicts.forEach((c) => {
        expect(c.body.success).toBe(false);
        expect(c.body.code).toBe('SLOT_LOCK_CONFLICT');
        expect(c.body.error).toContain('apartado');
      });

      // Verify DB consistency
      const dbSlot = SlotService.getSlotById(testSlotSingle);
      expect(dbSlot?.status).toBe('locked');
      expect(dbSlot?.lock_token).toBe(winnerBody.lock_token);
    });

    it('Adv-1.3: Multi-Slot Massive Concurrency — 20 slots x 25 contenders (500 simultaneous lock requests)', async () => {
      const slotCount = 20;
      const contendersPerSlot = 25;
      const slotIds: string[] = [];

      // Seed 20 test slots
      for (let i = 0; i < slotCount; i++) {
        const id = `multi-slot-${i}`;
        slotIds.push(id);
        const start = new Date(Date.now() + (i + 1) * 3600 * 1000).toISOString();
        const end = new Date(Date.now() + (i + 1) * 3600 * 1000 + 2700000).toISOString();
        db.prepare(`INSERT INTO slots (id, start_time, end_time, status) VALUES (?, ?, ?, 'available')`).run(id, start, end);
      }

      // Fire 500 requests
      const allRequests: Promise<{ slotId: string; success: boolean; error: any }>[] = [];
      for (const slotId of slotIds) {
        for (let c = 0; c < contendersPerSlot; c++) {
          allRequests.push(
            Promise.resolve().then(() => {
              try {
                SlotService.acquireSoftLock(slotId);
                return { slotId, success: true, error: null };
              } catch (err) {
                return { slotId, success: false, error: err };
              }
            })
          );
        }
      }

      const results = await Promise.all(allRequests);

      // Verify each slot had exactly 1 winner and 24 losers
      for (const slotId of slotIds) {
        const slotResults = results.filter((r) => r.slotId === slotId);
        const winners = slotResults.filter((r) => r.success);
        const losers = slotResults.filter((r) => !r.success);

        expect(winners.length).toBe(1);
        expect(losers.length).toBe(contendersPerSlot - 1);

        const slotInDb = SlotService.getSlotById(slotId);
        expect(slotInDb?.status).toBe('locked');
        expect(slotInDb?.lock_token).toBeDefined();
      }
    });
  });

  // =========================================================================
  // 2. RAPID ACQUIRE -> RELEASE -> RE-ACQUIRE CYCLES & TOKEN SAFETY
  // =========================================================================

  describe('2. Rapid Acquire -> Release -> Re-Acquire Cycles & Token Isolation', () => {
    it('Adv-2.1: 100 sequential cycles of acquire -> release -> re-acquire on the same slot', () => {
      const tokensSeen = new Set<string>();

      for (let i = 0; i < 100; i++) {
        // 1. Acquire
        const lock = SlotService.acquireSoftLock(testSlotSingle, 15);
        expect(lock.lock_token).toBeDefined();
        expect(tokensSeen.has(lock.lock_token)).toBe(false);
        tokensSeen.add(lock.lock_token);

        let slot = SlotService.getSlotById(testSlotSingle);
        expect(slot?.status).toBe('locked');
        expect(slot?.lock_token).toBe(lock.lock_token);

        // 2. Release
        const released = SlotService.releaseSoftLock(testSlotSingle, lock.lock_token);
        expect(released).toBe(true);

        slot = SlotService.getSlotById(testSlotSingle);
        expect(slot?.status).toBe('available');
        expect(slot?.lock_token).toBeNull();
        expect(slot?.locked_at).toBeNull();
        expect(slot?.lock_expires_at).toBeNull();
      }

      expect(tokensSeen.size).toBe(100);
    });

    it('Adv-2.2: Lock token authorization isolation — cannot release or hijack another user lock', () => {
      const lockA = SlotService.acquireSoftLock(testSlotSingle, 15);

      // Attempt release with invalid tokens
      expect(SlotService.releaseSoftLock(testSlotSingle, 'fake-token-1234')).toBe(false);
      expect(SlotService.releaseSoftLock(testSlotSingle, '00000000-0000-0000-0000-000000000000')).toBe(false);

      // Slot must remain locked by lockA
      let slot = SlotService.getSlotById(testSlotSingle);
      expect(slot?.status).toBe('locked');
      expect(slot?.lock_token).toBe(lockA.lock_token);

      // Another user cannot acquire while locked
      expect(() => SlotService.acquireSoftLock(testSlotSingle)).toThrow(SlotConflictError);

      // Release with correct token succeeds
      expect(SlotService.releaseSoftLock(testSlotSingle, lockA.lock_token)).toBe(true);

      // Now available for new lock
      const lockB = SlotService.acquireSoftLock(testSlotSingle, 15);
      expect(lockB.lock_token).not.toBe(lockA.lock_token);
    });

    it('Adv-2.3: Stale Token Protection (ABA race scenario) — Old token cannot release or confirm new lock', () => {
      // User 1 acquires and releases
      const lock1 = SlotService.acquireSoftLock(testSlotSingle, 15);
      expect(SlotService.releaseSoftLock(testSlotSingle, lock1.lock_token)).toBe(true);

      // User 2 acquires
      const lock2 = SlotService.acquireSoftLock(testSlotSingle, 15);

      // User 1 tries to release User 2's lock using stale lock1 token
      const staleRelease = SlotService.releaseSoftLock(testSlotSingle, lock1.lock_token);
      expect(staleRelease).toBe(false);

      // User 1 tries to confirm booking using stale lock1 token
      const staleConfirm = SlotService.confirmBooking(testSlotSingle, lock1.lock_token);
      expect(staleConfirm).toBe(false);

      // Slot must still be locked by User 2
      const currentSlot = SlotService.getSlotById(testSlotSingle);
      expect(currentSlot?.status).toBe('locked');
      expect(currentSlot?.lock_token).toBe(lock2.lock_token);

      // User 2 confirms booking successfully
      const validConfirm = SlotService.confirmBooking(testSlotSingle, lock2.lock_token);
      expect(validConfirm).toBe(true);
      expect(SlotService.getSlotById(testSlotSingle)?.status).toBe('booked');
    });

    it('Adv-2.4: High-throughput concurrent chaos — simultaneous lock attempts while random releases occur', async () => {
      const opsCount = 60;
      const initialLock = SlotService.acquireSoftLock(testSlotSingle, 15);
      const validToken = initialLock.lock_token;

      const promises = Array.from({ length: opsCount }, (_, i) => {
        return Promise.resolve().then(() => {
          if (i % 3 === 0) {
            // Attempt to acquire
            try {
              return { op: 'lock', success: true, res: SlotService.acquireSoftLock(testSlotSingle) };
            } catch (e: any) {
              return { op: 'lock', success: false, error: e.message };
            }
          } else if (i % 3 === 1) {
            // Attempt release with invalid token
            const res = SlotService.releaseSoftLock(testSlotSingle, `random-bogus-token-${i}`);
            return { op: 'release_bogus', success: res };
          } else {
            // Attempt release with known valid or stale token
            const res = SlotService.releaseSoftLock(testSlotSingle, validToken);
            return { op: 'release_initial', success: res };
          }
        });
      });

      const results = await Promise.all(promises);
      expect(results.length).toBe(opsCount);

      // Database state should be clean and consistent (either available or locked, never corrupt)
      const finalSlot = SlotService.getSlotById(testSlotSingle);
      expect(['available', 'locked']).toContain(finalSlot?.status);
    });
  });

  // =========================================================================
  // 3. TTL TIME TRAVEL & EXPIRED LOCK RE-ACQUISITION
  // =========================================================================

  describe('3. TTL Expiration & Time Travel Stress Testing', () => {
    it('Adv-3.1: Expired lock is lazily swept on query and re-opened for booking', () => {
      // 1. Acquire 15m lock
      const lock = SlotService.acquireSoftLock(testSlotTimeTravel, 15);

      // 2. Direct DB manipulation: set lock_expires_at to 1 second in the past
      const pastTime = new Date(Date.now() - 1000).toISOString();
      db.prepare(`UPDATE slots SET lock_expires_at = ? WHERE id = ?`).run(pastTime, testSlotTimeTravel);

      // 3. Query available slots
      const available = SlotService.getAvailableSlots();
      const swept = available.find((s) => s.id === testSlotTimeTravel);
      expect(swept).toBeDefined();
      expect(swept?.status).toBe('AVAILABLE');

      // 4. Check DB row has been reset
      const dbRow = SlotService.getSlotById(testSlotTimeTravel);
      expect(dbRow?.status).toBe('available');
      expect(dbRow?.lock_token).toBeNull();
      expect(dbRow?.lock_expires_at).toBeNull();
    });

    it('Adv-3.2: 100 concurrent lock attempts on an expired slot grant exactly 1 new lock and 99 conflicts', async () => {
      // Lock slot
      const oldLock = SlotService.acquireSoftLock(testSlotTimeTravel, 15);

      // Advance virtual time by 16 minutes (960 seconds)
      SlotService.setTimeOffset(16 * 60 * 1000);

      // 100 simultaneous concurrent lock attempts on the expired slot
      const concurrencyLevel = 100;
      const promises = Array.from({ length: concurrencyLevel }, () =>
        Promise.resolve().then(() => {
          try {
            const res = SlotService.acquireSoftLock(testSlotTimeTravel, 15);
            return { success: true, res };
          } catch (err: any) {
            return { success: false, error: err };
          }
        })
      );

      const results = await Promise.all(promises);

      const winners = results.filter((r) => r.success);
      const losers = results.filter((r) => !r.success);

      expect(winners.length).toBe(1);
      expect(losers.length).toBe(99);

      // New lock token must be different from the expired one
      const newWinner = winners[0];
      expect(newWinner.res?.lock_token).toBeDefined();
      expect(newWinner.res?.lock_token).not.toBe(oldLock.lock_token);

      // DB check
      const currentSlot = SlotService.getSlotById(testSlotTimeTravel);
      expect(currentSlot?.status).toBe('locked');
      expect(currentSlot?.lock_token).toBe(newWinner.res?.lock_token);
    });

    it('Adv-3.3: Sweeper cleans up multiple staggered expired slots while leaving active holds intact', () => {
      const slotExpired1 = 'slot-exp-1';
      const slotExpired2 = 'slot-exp-2';
      const slotActive = 'slot-active';
      const start1 = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      const end1 = new Date(Date.now() + 25 * 3600 * 1000).toISOString();
      const start2 = new Date(Date.now() + 26 * 3600 * 1000).toISOString();
      const end2 = new Date(Date.now() + 27 * 3600 * 1000).toISOString();
      const start3 = new Date(Date.now() + 28 * 3600 * 1000).toISOString();
      const end3 = new Date(Date.now() + 29 * 3600 * 1000).toISOString();

      db.prepare(`INSERT INTO slots (id, start_time, end_time, status) VALUES (?, ?, ?, 'available')`).run(slotExpired1, start1, end1);
      db.prepare(`INSERT INTO slots (id, start_time, end_time, status) VALUES (?, ?, ?, 'available')`).run(slotExpired2, start2, end2);
      db.prepare(`INSERT INTO slots (id, start_time, end_time, status) VALUES (?, ?, ?, 'available')`).run(slotActive, start3, end3);

      const lock1 = SlotService.acquireSoftLock(slotExpired1, 15);
      const lock2 = SlotService.acquireSoftLock(slotExpired2, 15);
      const lockActive = SlotService.acquireSoftLock(slotActive, 15);

      // Force slot 1 and 2 expiration into past
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      db.prepare(`UPDATE slots SET lock_expires_at = ? WHERE id IN (?, ?)`).run(tenMinutesAgo, slotExpired1, slotExpired2);

      // Run manual sweeper
      const releasedCount = SlotService.releaseExpiredLocks();
      expect(releasedCount).toBe(2);

      // Expired slots are now available
      expect(SlotService.getSlotById(slotExpired1)?.status).toBe('available');
      expect(SlotService.getSlotById(slotExpired2)?.status).toBe('available');

      // Active slot remains locked
      expect(SlotService.getSlotById(slotActive)?.status).toBe('locked');
      expect(SlotService.getSlotById(slotActive)?.lock_token).toBe(lockActive.lock_token);
    });
  });

  // =========================================================================
  // 4. PERMANENT BOOKING ARMOR UNDER ADVERSARIAL CONDITIONS
  // =========================================================================

  describe('4. Permanent Booking Invariant Protection', () => {
    it('Adv-4.1: Once booked, slot is permanently locked — 100 concurrent attempts & time travel cannot reopen or re-lock it', async () => {
      // 1. Lock and Confirm Booking
      const lock = SlotService.acquireSoftLock(testSlotBooked, 15);
      const confirmed = SlotService.confirmBooking(testSlotBooked, lock.lock_token);
      expect(confirmed).toBe(true);

      const bookedSlot = SlotService.getSlotById(testSlotBooked);
      expect(bookedSlot?.status).toBe('booked');
      expect(bookedSlot?.lock_expires_at).toBeNull();

      // 2. Advance time forward by 1 year (31,536,000 seconds)
      SlotService.advanceTime(365 * 24 * 3600);

      // 3. Sweeper must NOT touch the booked slot
      const sweptCount = SlotService.releaseExpiredLocks();
      expect(sweptCount).toBe(0);

      // 4. 100 simultaneous concurrent lock attempts on the booked slot
      const concurrencyLevel = 100;
      const promises = Array.from({ length: concurrencyLevel }, () =>
        Promise.resolve().then(() => {
          try {
            SlotService.acquireSoftLock(testSlotBooked, 15);
            return { success: true };
          } catch (err: any) {
            return { success: false, error: err };
          }
        })
      );

      const results = await Promise.all(promises);

      const winners = results.filter((r) => r.success);
      const losers = results.filter((r) => !r.success);

      expect(winners.length).toBe(0);
      expect(losers.length).toBe(100);

      losers.forEach((l) => {
        expect(l.error).toBeInstanceOf(SlotConflictError);
        expect(l.error.message).toContain('ya ha sido confirmado y reservado permanentemente');
      });

      // Slot remains booked
      const finalSlot = SlotService.getSlotById(testSlotBooked);
      expect(finalSlot?.status).toBe('booked');
    });

    it('Adv-4.2: Releasing a booked slot with any token is rejected', () => {
      const lock = SlotService.acquireSoftLock(testSlotBooked, 15);
      SlotService.confirmBooking(testSlotBooked, lock.lock_token);

      // Attempt release with the old token or without token
      const releaseWithToken = SlotService.releaseSoftLock(testSlotBooked, lock.lock_token);
      expect(releaseWithToken).toBe(false);

      const releaseWithoutToken = SlotService.releaseSoftLock(testSlotBooked);
      expect(releaseWithoutToken).toBe(false);

      expect(SlotService.getSlotById(testSlotBooked)?.status).toBe('booked');
    });
  });

  // =========================================================================
  // 5. INPUT SANITIZATION & BOUNDARY TESTING
  // =========================================================================

  describe('5. Input Sanitization, Injection Defense & Boundaries', () => {
    it('Adv-5.1: Non-existent slot IDs under 100 concurrent requests all return SlotNotFoundError cleanly', async () => {
      const concurrencyLevel = 100;
      const promises = Array.from({ length: concurrencyLevel }, () =>
        Promise.resolve().then(() => {
          try {
            SlotService.acquireSoftLock('non-existent-slot-uuid-999');
            return { success: true };
          } catch (err) {
            return { success: false, error: err };
          }
        })
      );

      const results = await Promise.all(promises);
      const winners = results.filter((r) => r.success);
      const errors = results.filter((r) => !r.success);

      expect(winners.length).toBe(0);
      expect(errors.length).toBe(100);
      errors.forEach((e) => {
        expect(e.error).toBeInstanceOf(SlotNotFoundError);
      });
    });

    it('Adv-5.2: SQL Injection attempts in slotId and lockToken are safely parameterized and neutralized', () => {
      const injectionPayloads = [
        `' OR '1'='1`,
        `'; DROP TABLE slots; --`,
        `test-slot' UNION SELECT * FROM slots --`,
        `1' OR status='available' --`,
      ];

      injectionPayloads.forEach((payload) => {
        expect(() => SlotService.acquireSoftLock(payload)).toThrow(SlotNotFoundError);
        expect(SlotService.releaseSoftLock(testSlotSingle, payload)).toBe(false);
      });

      // Verify table still exists and data is intact
      const tableCheck = db.prepare(`SELECT count(*) as count FROM slots`).get() as { count: number };
      expect(tableCheck.count).toBeGreaterThan(0);
    });
  });
});
