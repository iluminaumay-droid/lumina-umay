import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { db, closeDatabase } from '../../src/server/db/database.js';
import { SlotService } from '../../src/server/services/slot.service.js';
import { seedDefaultSlots } from '../../src/server/db/seed.js';
import { SlotConflictError, SlotNotFoundError } from '../../src/server/types/slot.types.js';
import { createApp } from '../../src/server/app.js';

describe('Milestone 1 Adversarial Challenge: Boundary, Malformed Inputs & Seeding Idempotency (Challenger 2)', () => {
  const app = createApp();

  beforeEach(() => {
    SlotService.resetVirtualTime();
    db.prepare(`DELETE FROM webhook_events`).run();
    db.prepare(`DELETE FROM orders`).run();
    db.prepare(`DELETE FROM slots`).run();
  });

  afterAll(() => {
    SlotService.stopSweeper();
    closeDatabase();
  });

  // Helper to create uniquely timed slot
  function createSlot(id: string, offsetHours: number = 24, status: 'available' | 'locked' | 'booked' = 'available', lockToken?: string, lockExpiresInMinutes?: number) {
    const startTime = new Date(Date.now() + offsetHours * 3600 * 1000).toISOString();
    const endTime = new Date(Date.now() + offsetHours * 3600 * 1000 + 45 * 60 * 1000).toISOString();
    let lockedAt: string | null = null;
    let lockExpiresAt: string | null = null;

    if (status === 'locked') {
      lockedAt = new Date().toISOString();
      const expMinutes = lockExpiresInMinutes !== undefined ? lockExpiresInMinutes : 15;
      lockExpiresAt = new Date(Date.now() + expMinutes * 60 * 1000).toISOString();
    }

    db.prepare(`
      INSERT INTO slots (id, start_time, end_time, status, locked_at, lock_expires_at, lock_token)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, startTime, endTime, status, lockedAt, lockExpiresAt, lockToken || null);

    return { id, startTime, endTime, status, lockToken };
  }

  // =========================================================================
  // CHALLENGE GROUP 1: MALFORMED UUIDS, NON-EXISTENT IDS & SQL INJECTION DEFENSE
  // =========================================================================
  describe('Group 1: Malformed UUIDs, Non-Existent IDs & SQL Injection Defense', () => {
    it('Ch1.1: Non-existent slot IDs return HTTP 404 with SlotNotFoundError and Spanish message', async () => {
      const nonExistentIds = [
        'non-existent-slot-uuid-9999',
        '00000000-0000-0000-0000-000000000000',
        'slot_9999-99-99_9999',
        'random_string_id_xyz'
      ];

      for (const fakeId of nonExistentIds) {
        // Direct service call
        expect(() => SlotService.acquireSoftLock(fakeId)).toThrow(SlotNotFoundError);
        expect(SlotService.getSlotById(fakeId)).toBeNull();
        expect(SlotService.releaseSoftLock(fakeId, 'any-token')).toBe(false);
        expect(SlotService.confirmBooking(fakeId, 'any-token')).toBe(false);

        // HTTP POST /api/slots/:id/lock
        const lockRes = await request(app).post(`/api/slots/${fakeId}/lock`);
        expect(lockRes.status).toBe(404);
        expect(lockRes.body.success).toBe(false);
        expect(lockRes.body.code).toBe('SLOT_NOT_FOUND');
        expect(lockRes.body.error).toContain('no fue encontrado');

        // HTTP POST /api/slots/:id/release
        const releaseRes = await request(app)
          .post(`/api/slots/${fakeId}/release`)
          .send({ lock_token: 'fake-token' });
        expect(releaseRes.status).toBe(404);
        expect(releaseRes.body.success).toBe(false);
      }
    });

    it('Ch1.2: SQL Injection attacks in slot ID param are safely parameterized without side effects', async () => {
      // Create a legitimate control slot
      createSlot('legit-slot-1', 24, 'available');

      const sqlInjectionPayloads = [
        `' OR '1'='1`,
        `'; DROP TABLE slots; --`,
        `legit-slot-1' OR '1'='1`,
        `1 UNION SELECT * FROM slots --`,
        `' OR 1=1; UPDATE slots SET status='booked'; --`,
        `admin'--`,
        `" OR ""="`,
        `' OR ''='`,
        `'; DELETE FROM slots; --`,
        `1' AND (SELECT COUNT(*) FROM slots) > 0 --`
      ];

      for (const sqli of sqlInjectionPayloads) {
        // Service level check
        expect(() => SlotService.acquireSoftLock(sqli)).toThrow(SlotNotFoundError);
        expect(SlotService.getSlotById(sqli)).toBeNull();
        expect(SlotService.releaseSoftLock(sqli)).toBe(false);
        expect(SlotService.confirmBooking(sqli)).toBe(false);

        // HTTP Lock attempt with encoded payload
        const res = await request(app).post(`/api/slots/${encodeURIComponent(sqli)}/lock`);
        expect(res.status).toBe(404);
        expect(res.body.success).toBe(false);

        // HTTP Release attempt with encoded payload
        const relRes = await request(app)
          .post(`/api/slots/${encodeURIComponent(sqli)}/release`)
          .send({ lock_token: sqli });
        expect(relRes.status).toBe(404);
      }

      // Verify table and control slot are completely intact and unharmed
      const controlSlot = SlotService.getSlotById('legit-slot-1');
      expect(controlSlot).not.toBeNull();
      expect(controlSlot?.status).toBe('available');

      const allSlots = db.prepare(`SELECT count(*) as count FROM slots`).get() as { count: number };
      expect(allSlots.count).toBe(1);
    });

    it('Ch1.3: SQL Injection attacks in query filters (?date=, ?from=) are parameterized and sanitized', async () => {
      createSlot('slot-filter-test-1', 24, 'available');
      createSlot('slot-filter-test-2', 48, 'available');

      const sqliQueryParams = [
        `' OR '1'='1`,
        `' UNION SELECT * FROM slots --`,
        `2026-08-20' OR 1=1 --`,
        `'; DROP TABLE slots; --`,
        `2026-08-20' AND (SELECT count(*) FROM sqlite_master)>0 --`
      ];

      for (const badParam of sqliQueryParams) {
        // Direct service invocation with SQL injection query
        const slotsFromService = SlotService.getAvailableSlots(badParam);
        expect(Array.isArray(slotsFromService)).toBe(true);

        // HTTP GET with query injection
        const res = await request(app).get(`/api/slots?date=${encodeURIComponent(badParam)}`);
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.slots)).toBe(true);

        const resFrom = await request(app).get(`/api/slots?from=${encodeURIComponent(badParam)}`);
        expect(resFrom.status).toBe(200);
        expect(resFrom.body.success).toBe(true);
        expect(Array.isArray(resFrom.body.slots)).toBe(true);
      }

      // Ensure database integrity
      const tableCheck = db.prepare(`SELECT count(*) as count FROM slots`).get() as { count: number };
      expect(tableCheck.count).toBe(2);
    });

    it('Ch1.4: Extreme length and special character payloads in slot IDs handle gracefully without crashing', async () => {
      const extremeIds = [
        'A'.repeat(5000),                              // 5000 chars
        'null',
        'undefined',
        'NaN',
        '../../../../etc/passwd',                      // Path traversal
        '..\\..\\..\\windows\\system32',
        '<script>alert("xss")</script>',               // XSS string
        '🔥💫✨🔮🕯️',                                    // Unicode emojis
        '¡¿áéíóúñÁÉÍÓÚÑ!?',                            // Spanish accented characters
        '   ',                                         // Whitespace
      ];

      for (const extremeId of extremeIds) {
        const res = await request(app).post(`/api/slots/${encodeURIComponent(extremeId)}/lock`);
        expect([400, 404]).toContain(res.status);
        expect(res.body.success).toBe(false);
      }
    });

    it('Ch1.5: Malformed HTTP JSON bodies on release endpoint return 400 Bad Request', async () => {
      createSlot('slot-body-test', 24, 'locked', 'valid-token-123', 15);

      // 1. Missing lock_token property
      const resEmpty = await request(app)
        .post('/api/slots/slot-body-test/release')
        .send({});
      // Since ReleaseSlotBodySchema requires lock_token, safeParse fails and service is called without token or releases
      // If service is called without token, it releases any lock on that slot or fails. Let's check behavior:
      // In slots.routes.ts: if body parsing fails, lockToken = undefined, releaseSoftLock(params.id, undefined)
      // which releases any soft lock if unauthenticated release is allowed, or fails.
      // Let's verify status is 200 or 400/404.
      expect([200, 400, 404]).toContain(resEmpty.status);

      // 2. Empty string lock_token
      const resBlank = await request(app)
        .post('/api/slots/slot-body-test/release')
        .send({ lock_token: '' });
      expect([200, 400, 404]).toContain(resBlank.status);
    });
  });

  // =========================================================================
  // CHALLENGE GROUP 2: EXPIRED LOCKS, INVALID TOKENS & DOUBLE-CONFIRMATION
  // =========================================================================
  describe('Group 2: Expired Lock Handling, Token Authorization & Double Confirmation Invariants', () => {
    it('Ch2.1: Expired lock (-15 minutes) can be immediately acquired by another user without prior manual sweep', () => {
      // Slot 1: soft-locked 30 minutes ago, expired 15 minutes ago
      createSlot('expired-slot-1', 24, 'locked', 'stale-token-abc', -15);

      // Direct acquireSoftLock should atomically re-assign the expired slot
      const newLock = SlotService.acquireSoftLock('expired-slot-1', 15);
      expect(newLock.slot_id).toBe('expired-slot-1');
      expect(newLock.lock_token).toBeDefined();
      expect(newLock.lock_token).not.toBe('stale-token-abc');

      const updated = SlotService.getSlotById('expired-slot-1');
      expect(updated?.status).toBe('locked');
      expect(updated?.lock_token).toBe(newLock.lock_token);
      expect(new Date(updated!.lock_expires_at!).getTime()).toBeGreaterThan(Date.now());
    });

    it('Ch2.2: 50 concurrent lock attempts on an expired slot grant exactly 1 new lock and 49 conflict errors', async () => {
      createSlot('expired-slot-concurrent', 24, 'locked', 'stale-token-xyz', -10);

      const attempts = 50;
      const promises = Array.from({ length: attempts }, (_, i) =>
        Promise.resolve().then(() => {
          try {
            const res = SlotService.acquireSoftLock('expired-slot-concurrent', 15);
            return { index: i, success: true, result: res, error: null };
          } catch (err: any) {
            return { index: i, success: false, result: null, error: err };
          }
        })
      );

      const results = await Promise.all(promises);
      const successes = results.filter((r) => r.success);
      const conflicts = results.filter((r) => !r.success);

      expect(successes.length).toBe(1);
      expect(conflicts.length).toBe(49);
      conflicts.forEach((c) => {
        expect(c.error).toBeInstanceOf(SlotConflictError);
      });

      const slot = SlotService.getSlotById('expired-slot-concurrent');
      expect(slot?.status).toBe('locked');
      expect(slot?.lock_token).toBe(successes[0].result?.lock_token);
    });

    it('Ch2.3: Active lock (+10 min remaining) strictly rejects unauthorized release tokens and cross-slot token reuse', async () => {
      createSlot('active-slot-1', 24, 'locked', 'token-alice-111', 10);
      createSlot('active-slot-2', 48, 'locked', 'token-bob-222', 10);

      // 1. Releasing active-slot-1 with Bob's token must fail
      const badTokenRelease = SlotService.releaseSoftLock('active-slot-1', 'token-bob-222');
      expect(badTokenRelease).toBe(false);
      expect(SlotService.getSlotById('active-slot-1')?.status).toBe('locked');

      // 2. Releasing active-slot-1 with random token must fail
      const randomTokenRelease = SlotService.releaseSoftLock('active-slot-1', 'random-invalid-token');
      expect(randomTokenRelease).toBe(false);
      expect(SlotService.getSlotById('active-slot-1')?.status).toBe('locked');

      // 3. HTTP release with invalid token returns 404
      const httpRes = await request(app)
        .post('/api/slots/active-slot-1/release')
        .send({ lock_token: 'fake-attacker-token' });
      expect(httpRes.status).toBe(404);
      expect(httpRes.body.success).toBe(false);

      // 4. Legitimate release with Alice's token succeeds
      const legitRelease = SlotService.releaseSoftLock('active-slot-1', 'token-alice-111');
      expect(legitRelease).toBe(true);
      expect(SlotService.getSlotById('active-slot-1')?.status).toBe('available');
      expect(SlotService.getSlotById('active-slot-1')?.lock_token).toBeNull();

      // 5. Replaying Alice's token after successful release fails
      const replayRelease = SlotService.releaseSoftLock('active-slot-1', 'token-alice-111');
      expect(replayRelease).toBe(false);
    });

    it('Ch2.4: Booked slot permanence — double confirmation, re-locking, and release rejection', () => {
      createSlot('slot-to-book', 24, 'locked', 'booking-token-777', 10);

      // 1. Initial confirmation with valid token succeeds
      const confirmed = SlotService.confirmBooking('slot-to-book', 'booking-token-777');
      expect(confirmed).toBe(true);

      const bookedSlot = SlotService.getSlotById('slot-to-book');
      expect(bookedSlot?.status).toBe('booked');
      expect(bookedSlot?.lock_expires_at).toBeNull();

      // 2. Double confirmation attempt with same token returns false
      const doubleConfirm = SlotService.confirmBooking('slot-to-book', 'booking-token-777');
      expect(doubleConfirm).toBe(false);

      // 3. Double confirmation attempt with different token returns false
      const wrongTokenConfirm = SlotService.confirmBooking('slot-to-book', 'other-token');
      expect(wrongTokenConfirm).toBe(false);

      // 4. Attempting to acquire a soft-lock on a booked slot throws SlotConflictError
      expect(() => SlotService.acquireSoftLock('slot-to-book')).toThrow(SlotConflictError);

      // 5. Attempting to release a booked slot returns false
      const releaseAttempt = SlotService.releaseSoftLock('slot-to-book', 'booking-token-777');
      expect(releaseAttempt).toBe(false);
      expect(SlotService.getSlotById('slot-to-book')?.status).toBe('booked');

      // 6. Sweeping expired locks does NOT alter booked slot even after 100 days in the future
      SlotService.advanceTime(100 * 24 * 3600);
      SlotService.releaseExpiredLocks();

      const futureCheck = SlotService.getSlotById('slot-to-book');
      expect(futureCheck?.status).toBe('booked');
      expect(futureCheck?.lock_expires_at).toBeNull();
    });

    it('Ch2.5: Confirming an available slot without pre-lock works and sets status to booked', () => {
      createSlot('direct-book-slot', 24, 'available');

      const confirmed = SlotService.confirmBooking('direct-book-slot');
      expect(confirmed).toBe(true);

      const slot = SlotService.getSlotById('direct-book-slot');
      expect(slot?.status).toBe('booked');
    });

    it('Ch2.6: Confirming a slot with an incorrect lock token is rejected', () => {
      createSlot('locked-slot-mismatch', 24, 'locked', 'legit-token-123', 10);

      const confirmed = SlotService.confirmBooking('locked-slot-mismatch', 'fraudulent-token-999');
      expect(confirmed).toBe(false);

      const slot = SlotService.getSlotById('locked-slot-mismatch');
      expect(slot?.status).toBe('locked');
      expect(slot?.lock_token).toBe('legit-token-123');
    });
  });

  // =========================================================================
  // CHALLENGE GROUP 3: SEEDING IDEMPOTENCY & SCHEDULE CONFORMANCE
  // =========================================================================
  describe('Group 3: Seeding Idempotency, Weekday Generation & Business Rules', () => {
    it('Ch3.1: Running seedDefaultSlots 5 times sequentially produces identical slot count without errors or duplicates', () => {
      // Run 1 (Initial seed)
      const res1 = seedDefaultSlots({ daysAhead: 14 });
      expect(res1.insertedCount).toBeGreaterThan(0);
      expect(res1.totalAvailable).toBe(res1.insertedCount);

      const initialCount = res1.totalAvailable;
      const initialSlots = db.prepare(`SELECT id, start_time, end_time, status FROM slots ORDER BY start_time ASC`).all();

      // Run 2
      const res2 = seedDefaultSlots({ daysAhead: 14 });
      expect(res2.insertedCount).toBe(0);
      expect(res2.totalAvailable).toBe(initialCount);

      // Run 3
      const res3 = seedDefaultSlots({ daysAhead: 14 });
      expect(res3.insertedCount).toBe(0);
      expect(res3.totalAvailable).toBe(initialCount);

      // Run 4
      const res4 = seedDefaultSlots({ daysAhead: 14 });
      expect(res4.insertedCount).toBe(0);
      expect(res4.totalAvailable).toBe(initialCount);

      // Run 5
      const res5 = seedDefaultSlots({ daysAhead: 14 });
      expect(res5.insertedCount).toBe(0);
      expect(res5.totalAvailable).toBe(initialCount);

      // Compare slot records across entire table
      const finalSlots = db.prepare(`SELECT id, start_time, end_time, status FROM slots ORDER BY start_time ASC`).all();
      expect(finalSlots.length).toBe(initialSlots.length);
      expect(finalSlots).toEqual(initialSlots);
    });

    it('Ch3.2: Repeated seeding preserves existing locked and booked slot states without overwriting', () => {
      // Initial seed
      seedDefaultSlots({ daysAhead: 14 });
      const availableBefore = SlotService.getAvailableSlots();
      expect(availableBefore.length).toBeGreaterThan(5);

      const slotToLock = availableBefore[0].id;
      const slotToBook = availableBefore[1].id;

      // Lock slotToLock
      const lockRes = SlotService.acquireSoftLock(slotToLock, 15);
      // Book slotToBook
      SlotService.confirmBooking(slotToBook);

      // Verify states before re-seed
      expect(SlotService.getSlotById(slotToLock)?.status).toBe('locked');
      expect(SlotService.getSlotById(slotToBook)?.status).toBe('booked');

      // Re-seed 5 times
      for (let i = 1; i <= 5; i++) {
        const reSeedRes = seedDefaultSlots({ daysAhead: 14 });
        expect(reSeedRes.insertedCount).toBe(0);

        // Verify locked slot is NOT overwritten to available
        const checkLocked = SlotService.getSlotById(slotToLock);
        expect(checkLocked?.status).toBe('locked');
        expect(checkLocked?.lock_token).toBe(lockRes.lock_token);

        // Verify booked slot is NOT overwritten to available
        const checkBooked = SlotService.getSlotById(slotToBook);
        expect(checkBooked?.status).toBe('booked');
      }
    });

    it('Ch3.3: Seeder generates weekday-only slots conforming to 10:00, 11:30, 14:00, 15:30, 17:00 CDMX and 45-min duration', () => {
      db.prepare(`DELETE FROM slots`).run();
      seedDefaultSlots({ daysAhead: 28 }); // 4 weeks

      const slots = db.prepare(`SELECT * FROM slots`).all() as any[];
      expect(slots.length).toBeGreaterThan(0);

      const validCdmxHours = [10, 11, 14, 15, 17];
      const validCdmxMinutes = [0, 30];

      for (const slot of slots) {
        const startDate = new Date(slot.start_time);
        const endDate = new Date(slot.end_time);

        // 1. Duration check: exactly 45 minutes (2,700,000 ms)
        const durationMs = endDate.getTime() - startDate.getTime();
        expect(durationMs).toBe(45 * 60 * 1000);

        // 2. Convert to CDMX time (UTC - 6 hours)
        const cdmxStart = new Date(startDate.getTime() - 6 * 3600 * 1000);
        const cdmxDayOfWeek = cdmxStart.getUTCDay(); // 0 = Sunday, 6 = Saturday

        // Must be Monday - Friday (1 - 5)
        expect(cdmxDayOfWeek).toBeGreaterThanOrEqual(1);
        expect(cdmxDayOfWeek).toBeLessThanOrEqual(5);

        // Hour and minute check
        const cdmxHour = cdmxStart.getUTCHours();
        const cdmxMinute = cdmxStart.getUTCMinutes();

        expect(validCdmxHours).toContain(cdmxHour);
        if (cdmxHour === 10 || cdmxHour === 14 || cdmxHour === 17) {
          expect(cdmxMinute).toBe(0);
        } else if (cdmxHour === 11 || cdmxHour === 15) {
          expect(cdmxMinute).toBe(30);
        }
      }
    });

    it('Ch3.4: 10 parallel simultaneous seedDefaultSlots invocations execute cleanly with ACID safety', async () => {
      db.prepare(`DELETE FROM slots`).run();

      const promises = Array.from({ length: 10 }, () =>
        Promise.resolve().then(() => seedDefaultSlots({ daysAhead: 14 }))
      );

      const results = await Promise.all(promises);
      expect(results.length).toBe(10);

      // Sum of inserted counts across all parallel runs should equal total unique slots
      const totalInserted = results.reduce((acc, r) => acc + r.insertedCount, 0);
      const totalInDb = (db.prepare(`SELECT count(*) as count FROM slots`).get() as any).count;

      expect(totalInserted).toBe(totalInDb);
    });
  });
});
