import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { db, closeDatabase } from '../../src/server/db/database.js';
import { SlotService } from '../../src/server/services/slot.service.js';
import { SlotConflictError, SlotNotFoundError } from '../../src/server/types/slot.types.js';
import { createApp } from '../../src/server/app.js';

describe('SlotService & Concurrency Engine Unit Tests', () => {
  const testSlotId1 = 'test-slot-uuid-1';
  const testSlotId2 = 'test-slot-uuid-2';
  const testSlotExpired = 'test-slot-expired-uuid';
  const app = createApp();

  beforeEach(() => {
    // Reset virtual time offset
    SlotService.resetVirtualTime();

    // Clean and seed test slots
    db.prepare(`DELETE FROM slots`).run();

    const futureTimeStart1 = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const futureTimeEnd1 = new Date(Date.now() + 24 * 60 * 60 * 1000 + 45 * 60 * 1000).toISOString();

    const futureTimeStart2 = new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString();
    const futureTimeEnd2 = new Date(Date.now() + 26 * 60 * 60 * 1000 + 45 * 60 * 1000).toISOString();

    const futureTimeStart3 = new Date(Date.now() + 28 * 60 * 60 * 1000).toISOString();
    const futureTimeEnd3 = new Date(Date.now() + 28 * 60 * 60 * 1000 + 45 * 60 * 1000).toISOString();

    const expiredLockedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const expiredExpiresAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO slots (id, start_time, end_time, status)
      VALUES (?, ?, ?, 'available')
    `).run(testSlotId1, futureTimeStart1, futureTimeEnd1);

    db.prepare(`
      INSERT INTO slots (id, start_time, end_time, status)
      VALUES (?, ?, ?, 'available')
    `).run(testSlotId2, futureTimeStart2, futureTimeEnd2);

    db.prepare(`
      INSERT INTO slots (id, start_time, end_time, status, locked_at, lock_expires_at, lock_token)
      VALUES (?, ?, ?, 'locked', ?, ?, 'stale-token-123')
    `).run(testSlotExpired, futureTimeStart3, futureTimeEnd3, expiredLockedAt, expiredExpiresAt);
  });

  afterAll(() => {
    SlotService.stopSweeper();
    closeDatabase();
  });

  it('T1: getAvailableSlots returns only available slots and lazily sweeps expired locks', () => {
    const slots = SlotService.getAvailableSlots();
    expect(slots.length).toBe(3); // testSlotId1, testSlotId2, testSlotExpired (swept)
    expect(slots.find((s) => s.id === testSlotExpired)?.status).toBe('AVAILABLE');
  });

  it('T2: acquireSoftLock successfully locks an available slot', () => {
    const result = SlotService.acquireSoftLock(testSlotId1, 15);
    expect(result.slot_id).toBe(testSlotId1);
    expect(result.lock_token).toBeDefined();
    expect(new Date(result.expires_at).getTime()).toBeGreaterThan(Date.now());

    const slot = SlotService.getSlotById(testSlotId1);
    expect(slot?.status).toBe('locked');
    expect(slot?.lock_token).toBe(result.lock_token);
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
    expect(slot?.lock_token).toBe(successfulLocks[0].res?.lock_token);
  });

  it('T6: releaseSoftLock releases lock with matching token and rejects invalid token', () => {
    const lock = SlotService.acquireSoftLock(testSlotId1);

    // Invalid token fails
    const invalidRelease = SlotService.releaseSoftLock(testSlotId1, 'invalid-token');
    expect(invalidRelease).toBe(false);
    expect(SlotService.getSlotById(testSlotId1)?.status).toBe('locked');

    // Valid token succeeds
    const validRelease = SlotService.releaseSoftLock(testSlotId1, lock.lock_token);
    expect(validRelease).toBe(true);
    expect(SlotService.getSlotById(testSlotId1)?.status).toBe('available');
    expect(SlotService.getSlotById(testSlotId1)?.lock_token).toBeNull();
  });

  it('T7: confirmBooking permanently books slot and clears lock_expires_at', () => {
    const lock = SlotService.acquireSoftLock(testSlotId1);
    const confirmed = SlotService.confirmBooking(testSlotId1, lock.lock_token);
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

  it('T9: HTTP API - GET /api/slots returns available slots', async () => {
    const res = await request(app).get('/api/slots');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.slots)).toBe(true);
    expect(res.body.slots.length).toBe(3);
    expect(res.body.slots[0]).toHaveProperty('id');
    expect(res.body.slots[0]).toHaveProperty('start_time');
    expect(res.body.slots[0]).toHaveProperty('end_time');
  });

  it('T10: HTTP API - POST /api/slots/:id/lock locks slot and subsequent lock gives 409', async () => {
    const lockRes = await request(app).post(`/api/slots/${testSlotId1}/lock`);
    expect(lockRes.status).toBe(200);
    expect(lockRes.body.success).toBe(true);
    expect(lockRes.body.slot_id).toBe(testSlotId1);
    expect(lockRes.body.lock_token).toBeDefined();

    // Second lock attempt
    const lockRes2 = await request(app).post(`/api/slots/${testSlotId1}/lock`);
    expect(lockRes2.status).toBe(409);
    expect(lockRes2.body.success).toBe(false);
    expect(lockRes2.body.error).toContain('apartado');
  });

  it('T11: HTTP API - POST /api/slots/:id/release releases lock', async () => {
    const lockRes = await request(app).post(`/api/slots/${testSlotId1}/lock`);
    const token = lockRes.body.lock_token;

    const releaseRes = await request(app)
      .post(`/api/slots/${testSlotId1}/release`)
      .send({ lock_token: token });

    expect(releaseRes.status).toBe(200);
    expect(releaseRes.body.success).toBe(true);

    // Can lock again
    const lockAgain = await request(app).post(`/api/slots/${testSlotId1}/lock`);
    expect(lockAgain.status).toBe(200);
  });

  it('T12: releaseSoftLock rejects missing, empty, or whitespace lock token and keeps slot locked', () => {
    const lock = SlotService.acquireSoftLock(testSlotId1);
    expect(lock.lock_token).toBeDefined();

    // Undefined token
    expect(SlotService.releaseSoftLock(testSlotId1, undefined)).toBe(false);
    expect(SlotService.getSlotById(testSlotId1)?.status).toBe('locked');

    // Empty string token
    expect(SlotService.releaseSoftLock(testSlotId1, '')).toBe(false);
    expect(SlotService.getSlotById(testSlotId1)?.status).toBe('locked');

    // Whitespace token
    expect(SlotService.releaseSoftLock(testSlotId1, '   ')).toBe(false);
    expect(SlotService.getSlotById(testSlotId1)?.status).toBe('locked');

    // Valid token still works
    expect(SlotService.releaseSoftLock(testSlotId1, lock.lock_token)).toBe(true);
    expect(SlotService.getSlotById(testSlotId1)?.status).toBe('available');
  });

  it('T13: HTTP API - POST /api/slots/:id/release with missing lock_token returns 400 Bad Request', async () => {
    const lockRes = await request(app).post(`/api/slots/${testSlotId1}/lock`);
    expect(lockRes.status).toBe(200);
    const token = lockRes.body.lock_token;

    // Release with empty body -> must return 400 Bad Request
    const emptyReleaseRes = await request(app)
      .post(`/api/slots/${testSlotId1}/release`)
      .send({});
    expect(emptyReleaseRes.status).toBe(400);
    expect(emptyReleaseRes.body.success).toBe(false);
    expect(SlotService.getSlotById(testSlotId1)?.status).toBe('locked');

    // Release with empty string lock_token -> must return 400 Bad Request
    const emptyTokenRes = await request(app)
      .post(`/api/slots/${testSlotId1}/release`)
      .send({ lock_token: '' });
    expect(emptyTokenRes.status).toBe(400);
    expect(emptyTokenRes.body.success).toBe(false);
    expect(SlotService.getSlotById(testSlotId1)?.status).toBe('locked');

    // Release with valid token succeeds
    const validReleaseRes = await request(app)
      .post(`/api/slots/${testSlotId1}/release`)
      .send({ lock_token: token });
    expect(validReleaseRes.status).toBe(200);
    expect(validReleaseRes.body.success).toBe(true);
    expect(SlotService.getSlotById(testSlotId1)?.status).toBe('available');
  });

  it('T14: getAvailableSlots with specific date filter strictly isolates slots for that date', () => {
    // Seed slots across 3 distinct dates
    db.prepare(`DELETE FROM slots`).run();

    const date1 = '2026-09-10';
    const date2 = '2026-09-11';
    const date3 = '2026-09-12';

    db.prepare(`
      INSERT INTO slots (id, start_time, end_time, status)
      VALUES 
        ('slot-d1-1', '${date1}T16:00:00.000Z', '${date1}T16:45:00.000Z', 'available'),
        ('slot-d1-2', '${date1}T17:00:00.000Z', '${date1}T17:45:00.000Z', 'available'),
        ('slot-d2-1', '${date2}T16:00:00.000Z', '${date2}T16:45:00.000Z', 'available'),
        ('slot-d3-1', '${date3}T16:00:00.000Z', '${date3}T16:45:00.000Z', 'available')
    `).run();

    // Query for date1: should return exactly 2 slots, all on date1
    const slotsD1 = SlotService.getAvailableSlots(date1);
    expect(slotsD1.length).toBe(2);
    expect(slotsD1.every((s) => s.start_time.startsWith(date1))).toBe(true);

    // Query for date2: should return exactly 1 slot on date2
    const slotsD2 = SlotService.getAvailableSlots(date2);
    expect(slotsD2.length).toBe(1);
    expect(slotsD2[0].id).toBe('slot-d2-1');

    // Query for date3: should return exactly 1 slot on date3
    const slotsD3 = SlotService.getAvailableSlots(date3);
    expect(slotsD3.length).toBe(1);
    expect(slotsD3[0].id).toBe('slot-d3-1');

    // Query for non-existent date: should return 0 slots
    const slotsEmpty = SlotService.getAvailableSlots('2026-09-20');
    expect(slotsEmpty.length).toBe(0);
  });

  it('T15: HTTP API - GET /api/slots?date=YYYY-MM-DD returns only slots for that specific date', async () => {
    db.prepare(`DELETE FROM slots`).run();

    const dateA = '2026-10-01';
    const dateB = '2026-10-02';

    db.prepare(`
      INSERT INTO slots (id, start_time, end_time, status)
      VALUES 
        ('slot-a1', '${dateA}T15:00:00.000Z', '${dateA}T15:45:00.000Z', 'available'),
        ('slot-b1', '${dateB}T15:00:00.000Z', '${dateB}T15:45:00.000Z', 'available')
    `).run();

    const res = await request(app).get(`/api/slots?date=${dateA}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.slots.length).toBe(1);
    expect(res.body.slots[0].id).toBe('slot-a1');
  });
});
