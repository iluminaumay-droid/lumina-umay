#!/usr/bin/env node
/**
 * LUMINA UMAY — MILESTONE 4 EMPIRICAL CHALLENGER LIVE HARNESS
 * Live Server E2E Verification against http://localhost:3000
 * Tests static asset delivery, SPA wildcard routing, slot soft-lock lifecycle,
 * 15-minute expiration, 409 conflict contention, and checkout integration.
 */

import http from 'http';
import { createApp } from '../../src/server/app.js';
import { initDatabase, db, closeDatabase } from '../../src/server/db/database.js';
import { SlotService } from '../../src/server/services/slot.service.js';

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

let passedCount = 0;
let failedCount = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  ❌ FAIL: ${message}`);
    failedCount++;
    throw new Error(`Assertion Failed: ${message}`);
  } else {
    console.log(`  ✅ PASS: ${message}`);
    passedCount++;
  }
}

async function runLiveTest() {
  console.log('\n======================================================');
  console.log('🔮 LUMINA UMAY — M4 EMPIRICAL LIVE CHALLENGER HARNESS');
  console.log('======================================================');
  console.log(`Target: ${BASE_URL}\n`);

  initDatabase();
  const app = createApp();
  const server = app.listen(PORT);

  await new Promise((resolve) => {
    if (server.listening) resolve();
    else server.on('listening', resolve);
  });

  console.log(`[Harness] Live HTTP Server listening on port ${PORT}\n`);

  try {
    // -----------------------------------------------------------------------
    // TEST SUITE 1: STATIC ASSETS & SPA WILDCARD ROUTING
    // -----------------------------------------------------------------------
    console.log('--- 1. STATIC ASSET DELIVERY & SPA WILDCARD ---');

    // 1.1 Root /
    const resRoot = await fetch(`${BASE_URL}/`);
    assert(resRoot.status === 200, 'GET / returns HTTP 200');
    assert(resRoot.headers.get('content-type')?.includes('text/html'), 'GET / returns text/html');
    const htmlRoot = await resRoot.text();
    assert(htmlRoot.includes('Lumina Umay'), 'GET / HTML contains "Lumina Umay"');
    assert(htmlRoot.includes('booking-form'), 'GET / HTML contains booking form');
    assert(htmlRoot.includes('faq-accordion'), 'GET / HTML contains Mexican Spanish FAQ accordion');

    // 1.2 /index.html
    const resIndex = await fetch(`${BASE_URL}/index.html`);
    assert(resIndex.status === 200, 'GET /index.html returns HTTP 200');
    assert(resIndex.headers.get('content-type')?.includes('text/html'), 'GET /index.html returns text/html');

    // 1.3 /styles.css
    const resCss = await fetch(`${BASE_URL}/styles.css`);
    assert(resCss.status === 200, 'GET /styles.css returns HTTP 200');
    assert(resCss.headers.get('content-type')?.includes('text/css'), 'GET /styles.css returns text/css');
    const cssText = await resCss.text();
    assert(cssText.includes('--teal'), 'GET /styles.css defines --teal design token');
    assert(cssText.includes('--gold'), 'GET /styles.css defines --gold design token');
    assert(cssText.includes('--cream'), 'GET /styles.css defines --cream design token');

    // 1.4 /app.js
    const resJs = await fetch(`${BASE_URL}/app.js`);
    assert(resJs.status === 200, 'GET /app.js returns HTTP 200');
    assert(resJs.headers.get('content-type')?.includes('javascript'), 'GET /app.js returns application/javascript');
    const jsText = await resJs.text();
    assert(jsText.includes('TIER_METADATA'), 'GET /app.js contains TIER_METADATA');
    assert(jsText.includes('handleSlotSelection'), 'GET /app.js contains handleSlotSelection');

    // 1.5 SPA Wildcard Routes (Non-API)
    const spaRoutes = ['/checkout', '/confirmacion', '/sesion-llamada', '/lecturas/1-carta'];
    for (const route of spaRoutes) {
      const resSpa = await fetch(`${BASE_URL}${route}`);
      assert(resSpa.status === 200, `SPA Wildcard GET ${route} returns HTTP 200`);
      const spaHtml = await resSpa.text();
      assert(spaHtml.includes('id="booking-form"'), `SPA Wildcard GET ${route} serves index.html app shell`);
    }

    // 1.6 API 404 Route Isolation
    const resApi404 = await fetch(`${BASE_URL}/api/non-existent-endpoint`);
    assert(resApi404.status === 404, 'GET /api/non-existent-endpoint returns HTTP 404');
    assert(resApi404.headers.get('content-type')?.includes('json'), 'API 404 returns JSON (not HTML index fallback)');
    const json404 = await resApi404.json();
    assert(json404.success === false, 'API 404 response has success: false');

    // -----------------------------------------------------------------------
    // TEST SUITE 2: SLOT SOFT-LOCK ACQUISITION, 409 CONFLICT & CONCURRENCY
    // -----------------------------------------------------------------------
    console.log('\n--- 2. SLOT SOFT-LOCK ACQUISITION & CONFLICT 409 ---');

    // Seed test slots
    SlotService.resetVirtualTime();
    db.prepare('DELETE FROM slots').run();
    db.prepare('DELETE FROM orders').run();

    const now = Date.now();
    const testSlot1 = 'live-slot-1';
    const testSlot2 = 'live-slot-2';
    const slot1Start = new Date(now + 24 * 3600 * 1000).toISOString();
    const slot1End = new Date(now + 24 * 3600 * 1000 + 45 * 60 * 1000).toISOString();
    const slot2Start = new Date(now + 48 * 3600 * 1000).toISOString();
    const slot2End = new Date(now + 48 * 3600 * 1000 + 45 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO slots (id, start_time, end_time, status)
      VALUES (?, ?, ?, 'available'), (?, ?, ?, 'available')
    `).run(testSlot1, slot1Start, slot1End, testSlot2, slot2Start, slot2End);

    // 2.1 Query available slots
    const resSlots = await fetch(`${BASE_URL}/api/slots`);
    assert(resSlots.status === 200, 'GET /api/slots returns HTTP 200');
    const slotsData = await resSlots.json();
    assert(slotsData.success === true, 'GET /api/slots returns success: true');
    assert(slotsData.slots.length === 2, 'GET /api/slots lists 2 available slots');

    // 2.2 Acquire soft-lock
    const resLock1 = await fetch(`${BASE_URL}/api/slots/${testSlot1}/lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    assert(resLock1.status === 200, `POST /api/slots/${testSlot1}/lock returns HTTP 200`);
    const lock1Data = await resLock1.json();
    assert(lock1Data.success === true, 'Soft-lock acquisition returns success: true');
    assert(typeof lock1Data.lock_token === 'string' && lock1Data.lock_token.length > 10, 'Soft-lock returns valid lock_token UUID');
    assert(new Date(lock1Data.expires_at).getTime() > Date.now() + 14 * 60 * 1000, 'Soft-lock expires_at is ~15 minutes in the future');

    // 2.3 Competing lock on same slot -> 409 Conflict
    const resLockConflict = await fetch(`${BASE_URL}/api/slots/${testSlot1}/lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    assert(resLockConflict.status === 409, 'Competing POST /api/slots/:id/lock returns HTTP 409 Conflict');
    const conflictData = await resLockConflict.json();
    assert(conflictData.success === false, 'Conflict response has success: false');
    assert(conflictData.error.includes('apartado'), 'Conflict response has informative Spanish message');

    // 2.4 Concurrent race condition — 30 simultaneous lock requests on testSlot2
    const parallelLockPromises = Array.from({ length: 30 }, () =>
      fetch(`${BASE_URL}/api/slots/${testSlot2}/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const parallelResponses = await Promise.all(parallelLockPromises);
    const success200 = parallelResponses.filter((r) => r.status === 200);
    const conflict409 = parallelResponses.filter((r) => r.status === 409);

    assert(success200.length === 1, '30 simultaneous lock attempts grant exactly 1 lock (HTTP 200)');
    assert(conflict409.length === 29, '30 simultaneous lock attempts result in 29 conflicts (HTTP 409)');

    // -----------------------------------------------------------------------
    // TEST SUITE 3: LOCK RELEASE & RE-ACQUISITION
    // -----------------------------------------------------------------------
    console.log('\n--- 3. LOCK RELEASE & RE-ACQUISITION ---');

    // 3.1 Release with invalid token returns 404
    const resInvalidRelease = await fetch(`${BASE_URL}/api/slots/${testSlot1}/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lock_token: 'bogus-token-123' })
    });
    assert(resInvalidRelease.status === 404, 'Release with invalid token returns HTTP 404');

    // 3.2 Release with valid token returns 200
    const resValidRelease = await fetch(`${BASE_URL}/api/slots/${testSlot1}/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lock_token: lock1Data.lock_token })
    });
    assert(resValidRelease.status === 200, 'Release with matching lock_token returns HTTP 200');

    // 3.3 Re-acquire slot immediately after release
    const resReacquire = await fetch(`${BASE_URL}/api/slots/${testSlot1}/lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    assert(resReacquire.status === 200, 'Slot can be locked again immediately after release');
    const reacquireData = await resReacquire.json();

    // -----------------------------------------------------------------------
    // TEST SUITE 4: 15-MINUTE EXPIRATION & LAZY SWEEP
    // -----------------------------------------------------------------------
    console.log('\n--- 4. 15-MINUTE EXPIRATION & AUTO-SWEEPER ---');

    // Currently testSlot1 is locked
    const resSlotsLocked = await fetch(`${BASE_URL}/api/slots`);
    const slotsLockedData = await resSlotsLocked.json();
    const lockedIds = slotsLockedData.slots.map((s) => s.id);
    assert(!lockedIds.includes(testSlot1), 'Locked slot is excluded from available slots list');

    // Advance virtual time by 15 minutes + 10 seconds (910s)
    SlotService.advanceTime(910);

    // Query available slots -> lazy sweeper restores testSlot1 to AVAILABLE
    const resSlotsRestored = await fetch(`${BASE_URL}/api/slots`);
    const slotsRestoredData = await resSlotsRestored.json();
    const restoredIds = slotsRestoredData.slots.map((s) => s.id);
    assert(restoredIds.includes(testSlot1), 'Slot is swept back to AVAILABLE after 15 minutes expiration');

    // Competing client acquires new lock after expiration
    const resNewLock = await fetch(`${BASE_URL}/api/slots/${testSlot1}/lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    assert(resNewLock.status === 200, 'New client successfully acquires lock after 15m expiration');
    const newLockData = await resNewLock.json();
    assert(newLockData.lock_token !== reacquireData.lock_token, 'New lock token is generated for new holder');

    // -----------------------------------------------------------------------
    // TEST SUITE 5: CHECKOUT PREFERENCE CREATION INTEGRATION
    // -----------------------------------------------------------------------
    console.log('\n--- 5. CHECKOUT PREFERENCE INTEGRATION ---');

    // 5.1 Call session checkout with active lock hold ($450 MXN)
    const resPrefCall = await fetch(`${BASE_URL}/api/checkout/create-preference`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tier_id: 'llamada',
        category: 'Trabajo/Dinero',
        customer_name: 'David Mendez',
        customer_email: 'david@example.com',
        customer_birthdate: '1988-11-12',
        question: 'Orientación para nuevo proyecto empresarial',
        slot_id: testSlot1,
        lock_token: newLockData.lock_token
      })
    });
    assert(resPrefCall.status === 200, 'POST /api/checkout/create-preference for live call returns HTTP 200');
    const prefCallData = await resPrefCall.json();
    assert(prefCallData.success === true, 'Checkout preference created successfully');
    assert(typeof prefCallData.order_id === 'string', 'Returned valid order_id');
    assert(typeof prefCallData.init_point === 'string', 'Returned Mercado Pago init_point');

    // Check DB for server-enforced pricing
    const orderCall = db.prepare('SELECT * FROM orders WHERE id = ?').get(prefCallData.order_id);
    assert(orderCall.amount_mxn === 450, 'Enforced $450 MXN in database for live call');
    assert(orderCall.slot_id === testSlot1, 'Order associated with locked slot');

    // 5.2 Async 1 Carta reading checkout ($150 MXN)
    const resPref1C = await fetch(`${BASE_URL}/api/checkout/create-preference`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tier_id: '1_carta',
        category: 'Amor',
        customer_name: 'Claudia Woods',
        customer_email: 'claudia@example.com',
        customer_birthdate: '1975-03-22',
        question: '¿Tendré noticias de este trámite pronto?'
      })
    });
    assert(resPref1C.status === 200, 'POST /api/checkout/create-preference for 1 carta returns HTTP 200');
    const pref1CData = await resPref1C.json();
    const order1C = db.prepare('SELECT * FROM orders WHERE id = ?').get(pref1CData.order_id);
    assert(order1C.amount_mxn === 150, 'Enforced $150 MXN in database for 1 carta');

    console.log('\n======================================================');
    console.log(`🎉 HARNESS COMPLETE: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log('======================================================\n');
  } finally {
    SlotService.stopSweeper();
    await new Promise((resolve) => server.close(resolve));
    closeDatabase();
  }
}

runLiveTest().catch((err) => {
  console.error('\n💥 Unhandled error in live harness:', err);
  process.exit(1);
});
