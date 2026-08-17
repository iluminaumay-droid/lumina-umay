import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import request from 'supertest';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { createApp } from '../../src/server/app.js';
import { db, closeDatabase, initDatabase } from '../../src/server/db/database.js';
import { SlotService } from '../../src/server/services/slot.service.js';
import { EmailService } from '../../src/server/services/email.service.js';

describe('Milestone 4 Adversarial Challenger Suite: Slot Soft-Lock Lifecycle, Static Serving & Concurrency Integration', () => {
  let app: ReturnType<typeof createApp>;
  let liveServer: http.Server | undefined;
  let LIVE_PORT = 3000;
  let LIVE_URL = `http://127.0.0.1:${LIVE_PORT}`;

  const testSlotId1 = 'm4-adv-slot-1';
  const testSlotId2 = 'm4-adv-slot-2';
  const testSlotId3 = 'm4-adv-slot-3';

  beforeAll(async () => {
    initDatabase();
    app = createApp();
  });

  beforeEach(() => {
    SlotService.resetVirtualTime();
    EmailService.clearCapturedEmails();
    db.prepare(`DELETE FROM webhook_events`).run();
    db.prepare(`DELETE FROM orders`).run();
    db.prepare(`DELETE FROM slots`).run();

    const now = Date.now();
    const s1Start = new Date(now + 24 * 3600 * 1000).toISOString();
    const s1End = new Date(now + 24 * 3600 * 1000 + 45 * 60 * 1000).toISOString();

    const s2Start = new Date(now + 48 * 3600 * 1000).toISOString();
    const s2End = new Date(now + 48 * 3600 * 1000 + 45 * 60 * 1000).toISOString();

    const s3Start = new Date(now + 72 * 3600 * 1000).toISOString();
    const s3End = new Date(now + 72 * 3600 * 1000 + 45 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO slots (id, start_time, end_time, status)
      VALUES 
        (?, ?, ?, 'available'),
        (?, ?, ?, 'available'),
        (?, ?, ?, 'available')
    `).run(
      testSlotId1, s1Start, s1End,
      testSlotId2, s2Start, s2End,
      testSlotId3, s3Start, s3End
    );
  });

  afterAll(async () => {
    SlotService.stopSweeper();
    if (liveServer?.listening) {
      const server = liveServer;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    closeDatabase();
  });

  // =========================================================================
  // SECTION 1: STATIC ASSET DELIVERY & SPA WILDCARD FALLBACK
  // =========================================================================
  describe('1. Static Asset Delivery & SPA Wildcard Routing', () => {
    it('1.1: Serves root `/` with valid 200 HTML, Cormorant Garamond font link, Jost and UI markup', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/html/);
      expect(res.text).toContain('Lumina Umay');
      expect(res.text).toMatch(/Cormorant/i);
      expect(res.text).toMatch(/Jost/i);
      expect(res.text).toContain('booking-form');
      expect(res.text).toContain('faq-accordion');
    });

    it('1.2: Serves `/index.html` directly with identical full HTML structure', async () => {
      const res = await request(app).get('/index.html');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/html/);
      expect(res.text).toContain('Lumina Umay');
      expect(res.text).toContain('id="slot-picker-section"');
    });

    it('1.3: Serves `/styles.css` containing design tokens (--teal, --gold, --cream)', async () => {
      const res = await request(app).get('/styles.css');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/css/);
      expect(res.text).toContain('--teal');
      expect(res.text).toContain('--gold');
      expect(res.text).toContain('--cream');
    });

    it('1.4: Serves `/style.css` alias if referenced', async () => {
      const res = await request(app).get('/style.css');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/css/);
    });

    it('1.5: Serves `/app.js` containing client state controller and soft-lock engine', async () => {
      const res = await request(app).get('/app.js');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/javascript/);
      expect(res.text).toContain('handleSlotSelection');
      expect(res.text).toContain('/api/slots');
      expect(res.text).toContain('/api/checkout/create-preference');
    });

    it('1.6: SPA Wildcard Fallback — Non-API arbitrary deep routes return index.html (200 OK)', async () => {
      const spaRoutes = [
        '/checkout',
        '/confirmacion',
        '/lecturas/1-carta',
        '/lecturas/3-cartas',
        '/lecturas/5-cartas',
        '/sesiones/en-vivo',
        '/preguntas-frecuentes',
        '/terminos-y-condiciones',
        '/arbitrary/client/path/deep/nested',
      ];

      for (const route of spaRoutes) {
        const res = await request(app).get(route);
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/html/);
        expect(res.text).toContain('Lumina Umay');
        expect(res.text).toContain('id="booking-form"');
      }
    });

    it('1.7: API 404 Isolation — Non-existent `/api/*` routes return 404 JSON, NOT HTML index fallback', async () => {
      const invalidApiRoutes = [
        '/api/nonexistent',
        '/api/slots/unknown/action',
        '/api/checkout/invalid-endpoint',
        '/api/orders/9999/unknown',
        '/api/v2/anything',
      ];

      for (const route of invalidApiRoutes) {
        const res = await request(app).get(route);
        expect(res.status).toBe(404);
        expect(res.headers['content-type']).toMatch(/json/);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toContain('no encontrado');
      }
    });
  });

  // =========================================================================
  // SECTION 2: SLOT SOFT-LOCK ACQUISITION, CONFLICT 409 & CONCURRENCY
  // =========================================================================
  describe('2. Slot Soft-Lock Acquisition & Concurrency Contention', () => {
    it('2.1: Client acquires 15-minute soft lock via POST /api/slots/:id/lock', async () => {
      const res = await request(app).post(`/api/slots/${testSlotId1}/lock`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.slot_id).toBe(testSlotId1);
      expect(res.body.lock_token).toBeDefined();
      expect(typeof res.body.lock_token).toBe('string');
      expect(res.body.lock_token.length).toBeGreaterThan(10);
      expect(res.body.expires_at).toBeDefined();

      const expiresAt = new Date(res.body.expires_at).getTime();
      const expectedMinExpires = Date.now() + 14 * 60 * 1000;
      const expectedMaxExpires = Date.now() + 16 * 60 * 1000;
      expect(expiresAt).toBeGreaterThan(expectedMinExpires);
      expect(expiresAt).toBeLessThan(expectedMaxExpires);

      // Verify DB reflects locked state
      const slotInDb = SlotService.getSlotById(testSlotId1);
      expect(slotInDb?.status).toBe('locked');
      expect(slotInDb?.lock_token).toBe(res.body.lock_token);
    });

    it('2.2: Rejects soft-lock acquisition on non-existent slot ID with 404', async () => {
      const res = await request(app).post('/api/slots/non-existent-uuid-9999/lock');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/no.*encontrado/i);
    });

    it('2.3: Returns 409 Conflict when second client attempts to lock an actively locked slot', async () => {
      // Client 1 locks slot
      const res1 = await request(app).post(`/api/slots/${testSlotId1}/lock`);
      expect(res1.status).toBe(200);

      // Client 2 attempts to lock same slot
      const res2 = await request(app).post(`/api/slots/${testSlotId1}/lock`);
      expect(res2.status).toBe(409);
      expect(res2.body.success).toBe(false);
      expect(res2.body.error).toMatch(/apartado/i);

      // Verify slot lock unchanged in DB
      const slotInDb = SlotService.getSlotById(testSlotId1);
      expect(slotInDb?.lock_token).toBe(res1.body.lock_token);
    });

    it('2.4: High-Concurrency Stress Test — 50 simultaneous parallel lock attempts on same slot yields exactly 1 success (200) and 49 conflicts (409)', async () => {
      const attempts = Array.from({ length: 50 }, () =>
        request(app).post(`/api/slots/${testSlotId1}/lock`)
      );

      const responses = await Promise.all(attempts);

      const successes = responses.filter((r) => r.status === 200 && r.body.success === true);
      const conflicts = responses.filter((r) => r.status === 409 && r.body.success === false);

      expect(successes.length).toBe(1);
      expect(conflicts.length).toBe(49);
      expect(conflicts.every((c) => c.body.error.includes('apartado'))).toBe(true);

      const winningToken = successes[0].body.lock_token;
      const slotInDb = SlotService.getSlotById(testSlotId1);
      expect(slotInDb?.status).toBe('locked');
      expect(slotInDb?.lock_token).toBe(winningToken);
    });
  });

  // =========================================================================
  // SECTION 3: LOCK RELEASE API & EDGE CASES
  // =========================================================================
  describe('3. Slot Soft-Lock Release API', () => {
    it('3.1: Explicit lock release via POST /api/slots/:id/release unlocks slot immediately', async () => {
      const lockRes = await request(app).post(`/api/slots/${testSlotId1}/lock`);
      const token = lockRes.body.lock_token;

      const releaseRes = await request(app)
        .post(`/api/slots/${testSlotId1}/release`)
        .send({ lock_token: token });

      expect(releaseRes.status).toBe(200);
      expect(releaseRes.body.success).toBe(true);
      expect(releaseRes.body.message).toMatch(/liberado/i);

      const slotInDb = SlotService.getSlotById(testSlotId1);
      expect(slotInDb?.status).toBe('available');
      expect(slotInDb?.lock_token).toBeNull();
      expect(slotInDb?.lock_expires_at).toBeNull();

      // Another client can lock it immediately
      const reLockRes = await request(app).post(`/api/slots/${testSlotId1}/lock`);
      expect(reLockRes.status).toBe(200);
      expect(reLockRes.body.lock_token).not.toBe(token);
    });

    it('3.2: Releasing with incorrect / forged lock token returns 404 and leaves slot locked', async () => {
      const lockRes = await request(app).post(`/api/slots/${testSlotId1}/lock`);
      const realToken = lockRes.body.lock_token;

      const forgedRes = await request(app)
        .post(`/api/slots/${testSlotId1}/release`)
        .send({ lock_token: 'forged-uuid-attack-token' });

      expect(forgedRes.status).toBe(404);
      expect(forgedRes.body.success).toBe(false);

      const slotInDb = SlotService.getSlotById(testSlotId1);
      expect(slotInDb?.status).toBe('locked');
      expect(slotInDb?.lock_token).toBe(realToken);
    });

    it('3.3: Releasing with missing or empty lock_token payload returns 400 Bad Request', async () => {
      const lockRes = await request(app).post(`/api/slots/${testSlotId1}/lock`);
      const realToken = lockRes.body.lock_token;

      const emptyBodyRes = await request(app)
        .post(`/api/slots/${testSlotId1}/release`)
        .send({});
      expect(emptyBodyRes.status).toBe(400);

      const emptyTokenRes = await request(app)
        .post(`/api/slots/${testSlotId1}/release`)
        .send({ lock_token: '' });
      expect(emptyTokenRes.status).toBe(400);

      const slotInDb = SlotService.getSlotById(testSlotId1);
      expect(slotInDb?.status).toBe('locked');
      expect(slotInDb?.lock_token).toBe(realToken);
    });

    it('3.4: Releasing an already available slot returns 404', async () => {
      const releaseRes = await request(app)
        .post(`/api/slots/${testSlotId2}/release`)
        .send({ lock_token: 'some-random-token' });

      expect(releaseRes.status).toBe(404);
      expect(releaseRes.body.success).toBe(false);
    });
  });

  // =========================================================================
  // SECTION 4: 15-MINUTE EXPIRATION & RE-ACQUISITION LIFECYCLE
  // =========================================================================
  describe('4. 15-Minute Expiration Lifecycle & Auto-Release', () => {
    it('4.1: Locked slot is excluded from available slots list during 15-minute hold', async () => {
      const lockRes = await request(app).post(`/api/slots/${testSlotId1}/lock`);
      expect(lockRes.status).toBe(200);

      const slotsRes = await request(app).get('/api/slots');
      expect(slotsRes.status).toBe(200);
      const availableIds = slotsRes.body.slots.map((s: any) => s.id);
      expect(availableIds).not.toContain(testSlotId1);
      expect(availableIds).toContain(testSlotId2);
      expect(availableIds).toContain(testSlotId3);
    });

    it('4.2: Slot automatically reclaims to AVAILABLE when virtual time advances past 15 minutes', async () => {
      const lockRes = await request(app).post(`/api/slots/${testSlotId1}/lock`);
      const oldToken = lockRes.body.lock_token;
      expect(lockRes.status).toBe(200);

      // Advance time past 15 minutes (901 seconds)
      SlotService.advanceTime(901);

      // Querying slots triggers lazy sweep
      const slotsRes = await request(app).get('/api/slots');
      expect(slotsRes.status).toBe(200);
      const availableIds = slotsRes.body.slots.map((s: any) => s.id);
      expect(availableIds).toContain(testSlotId1);

      // Verify DB shows available
      const slotInDb = SlotService.getSlotById(testSlotId1);
      expect(slotInDb?.status).toBe('available');
      expect(slotInDb?.lock_token).toBeNull();

      // Old holder cannot release expired lock
      const staleReleaseRes = await request(app)
        .post(`/api/slots/${testSlotId1}/release`)
        .send({ lock_token: oldToken });
      expect(staleReleaseRes.status).toBe(404);
    });

    it('4.3: New client can immediately acquire the slot after 15m expiration', async () => {
      const lockRes1 = await request(app).post(`/api/slots/${testSlotId1}/lock`);
      const oldToken = lockRes1.body.lock_token;

      // 15m + 5s expire
      SlotService.advanceTime(905);

      // Client 2 acquires
      const lockRes2 = await request(app).post(`/api/slots/${testSlotId1}/lock`);
      expect(lockRes2.status).toBe(200);
      expect(lockRes2.body.lock_token).toBeDefined();
      expect(lockRes2.body.lock_token).not.toBe(oldToken);

      const slotInDb = SlotService.getSlotById(testSlotId1);
      expect(slotInDb?.status).toBe('locked');
      expect(slotInDb?.lock_token).toBe(lockRes2.body.lock_token);
    });
  });

  // =========================================================================
  // SECTION 5: FULL LIVE HTTP SERVER E2E RUN (http://localhost:3000)
  // =========================================================================
  describe('5. Live Server E2E Verification against dynamic localhost port', () => {
    beforeAll(async () => {
      const server = app.listen(0, '127.0.0.1');
      liveServer = server;
      await new Promise<void>((resolve) => {
        if (server.listening) {
          LIVE_PORT = (server.address() as any).port;
          LIVE_URL = `http://127.0.0.1:${LIVE_PORT}`;
          resolve();
        } else {
          server.on('listening', () => {
            LIVE_PORT = (server.address() as any).port;
            LIVE_URL = `http://127.0.0.1:${LIVE_PORT}`;
            resolve();
          });
        }
      });
    });

    afterAll(async () => {
      if (liveServer?.listening) {
        const server = liveServer;
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('5.1: Live HTTP GET / serves index.html with 200 OK', async () => {
      const res = await fetch(`${LIVE_URL}/`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('Lumina Umay');
      expect(text).toContain('booking-form');
    });

    it('5.2: Live HTTP GET /styles.css serves valid stylesheet', async () => {
      const res = await fetch(`${LIVE_URL}/styles.css`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('--teal');
    });

    it('5.3: Live HTTP GET /app.js serves client JS controller', async () => {
      const res = await fetch(`${LIVE_URL}/app.js`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('TIER_METADATA');
    });

    it('5.4: Live HTTP SPA Route GET /reservar/sesion returns index.html', async () => {
      const res = await fetch(`${LIVE_URL}/reservar/sesion`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('Lumina Umay');
    });

    it('5.5: Live HTTP GET /api/health returns 200 JSON status', async () => {
      const res = await fetch(`${LIVE_URL}/api/health`);
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;
      expect(json.success).toBe(true);
      expect(json.service).toBe('Lumina Umay API');
    });

    it('5.6: Live HTTP Full Slot Soft-Lock & Release Cycle over network', async () => {
      // 1. Query available slots
      const getRes = await fetch(`${LIVE_URL}/api/slots`);
      expect(getRes.status).toBe(200);
      const getData = (await getRes.json()) as any;
      expect(getData.success).toBe(true);
      expect(getData.slots.length).toBeGreaterThanOrEqual(1);

      const targetSlot = getData.slots[0];

      // 2. Lock slot over network
      const lockRes = await fetch(`${LIVE_URL}/api/slots/${targetSlot.id}/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(lockRes.status).toBe(200);
      const lockData = (await lockRes.json()) as any;
      expect(lockData.success).toBe(true);
      expect(lockData.lock_token).toBeDefined();

      // 3. Competing lock attempt yields 409 Conflict
      const conflictRes = await fetch(`${LIVE_URL}/api/slots/${targetSlot.id}/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(conflictRes.status).toBe(409);

      // 4. Release lock over network
      const releaseRes = await fetch(`${LIVE_URL}/api/slots/${targetSlot.id}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lock_token: lockData.lock_token }),
      });
      expect(releaseRes.status).toBe(200);
      const releaseData = (await releaseRes.json()) as any;
      expect(releaseData.success).toBe(true);

      // 5. Query available slots again -> slot is restored
      const restoredRes = await fetch(`${LIVE_URL}/api/slots`);
      const restoredData = (await restoredRes.json()) as any;
      const ids = restoredData.slots.map((s: any) => s.id);
      expect(ids).toContain(targetSlot.id);
    });

    it('5.7: Live HTTP Create Preference for Live Call with Soft-Lock Hold ($450 MXN)', async () => {
      // Lock slot
      const lockRes = await fetch(`${LIVE_URL}/api/slots/${testSlotId2}/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const lockData = (await lockRes.json()) as any;
      expect(lockRes.status).toBe(200);

      // Create preference
      const prefRes = await fetch(`${LIVE_URL}/api/checkout/create-preference`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tier_id: 'llamada',
          category: 'Amor',
          customer_name: 'Santiago Garza',
          customer_email: 'santiago@example.com',
          customer_birthdate: '1992-07-20',
          question: 'Consulta sobre relación y planes futuros',
          slot_id: testSlotId2,
          lock_token: lockData.lock_token,
        }),
      });

      expect(prefRes.status).toBe(200);
      const prefData = (await prefRes.json()) as any;
      expect(prefData.success).toBe(true);
      expect(prefData.order_id).toBeDefined();
      expect(prefData.init_point).toBeDefined();

      // Check DB order pricing is strictly $450 MXN
      const orderInDb = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(prefData.order_id) as any;
      expect(orderInDb).toBeDefined();
      expect(orderInDb.amount_mxn).toBe(450);
      expect(orderInDb.slot_id).toBe(testSlotId2);
      expect(orderInDb.status.toLowerCase()).toBe('pending');
    });
  });
});
