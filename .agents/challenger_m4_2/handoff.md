# Empirical Adversarial Challenge Report — Milestone 4

**Agent ID**: `challenger_m4_2`  
**Target Milestone**: Milestone 4 (Slot Soft-Lock Lifecycle, Static Serving & Concurrency Integration)  
**Verdict**: **APPROVE**  
**Timestamp**: 2026-08-17T02:30:00Z  

---

## 1. Observation

### 1.1 Static Asset Delivery & SPA Wildcard Fallback
- **File Paths**: `src/server/app.ts` (lines 38-85), `src/client/index.html`, `src/client/styles.css`, `src/client/app.js`
- **Command & Output**: `npx vitest run tests/adversarial/m4-slot-static-live-challenger.test.ts`
  - `GET /` returned HTTP 200 with `Content-Type: text/html; charset=UTF-8`, containing `"Lumina Umay"`, `"Cormorant Garamond"`, `"Jost"`, `id="booking-form"`, and `id="faq-accordion"`.
  - `GET /index.html` returned HTTP 200 with matching HTML content.
  - `GET /styles.css` returned HTTP 200 with `Content-Type: text/css; charset=UTF-8` and defined `--teal`, `--gold`, and `--cream` design tokens.
  - `GET /app.js` returned HTTP 200 with `Content-Type: application/javascript; charset=UTF-8` and defined client state management, tier metadata, and soft-lock controller.
  - Non-API routes (`/checkout`, `/confirmacion`, `/lecturas/1-carta`, `/sesion-llamada`) successfully triggered SPA fallback serving `index.html` with HTTP 200.
  - API non-existent routes (`/api/nonexistent`, `/api/slots/unknown/action`) returned HTTP 404 with JSON `{ success: false, error: 'Endpoint no encontrado' }` without falling back to HTML.

### 1.2 Slot Soft-Lock Lifecycle & Concurrency
- **File Paths**: `src/server/routes/slots.routes.ts` (lines 8-87), `src/server/services/slot.service.ts` (lines 58-263), `src/client/app.js` (lines 302-517)
- **Lock Acquisition (`POST /api/slots/:id/lock`)**:
  - Returned HTTP 200 with `{ success: true, slot_id, lock_token, expires_at }`.
  - Expiration timestamp `expires_at` was verified to be strictly within the 15-minute window (`now + 15m`).
  - Database verification confirmed `status = 'locked'`, `lock_token = <uuid>`, and `lock_expires_at = <iso>`.
- **Lock Contention & 409 Handling**:
  - Competing request on an actively locked slot returned HTTP 409 Conflict with Spanish message: `"El horario seleccionado ya fue apartado por otra persona. Por favor elige otro horario."`.
  - High concurrency stress test with 50 simultaneous parallel requests on a single available slot granted exactly 1 lock (HTTP 200) and 49 conflicts (HTTP 409), proving atomic transaction safety (`BEGIN IMMEDIATE` in SQLite WAL mode).
- **Lock Release (`POST /api/slots/:id/release`)**:
  - Valid release with matching `lock_token` returned HTTP 200, cleared `locked_at`, `lock_expires_at`, `lock_token` in SQLite, and reverted slot status to `'available'`.
  - Releasing with forged token returned HTTP 404.
  - Releasing with missing/empty token payload returned HTTP 400 Bad Request.
  - Immediately following release, competing clients were able to re-acquire the slot without delay.
- **15-Minute Expiration & Lazy Auto-Sweeper**:
  - Advancing virtual time by 15 minutes + 1 second (901s) triggered lazy sweeper upon `/api/slots` query or lock request, restoring expired slots to `'available'`.
  - Subsequent client was able to acquire a fresh lock with a distinct `lock_token`.
  - Stale `lock_token` from previous holder was rejected with HTTP 404 upon post-expiration release attempt.

### 1.3 Live Server E2E Verification against `http://localhost:3000`
- **Tool Commands & Results**:
  - `npx tsx tests/adversarial/run-m4-live-e2e.js`: **54 passed, 0 failed** across all 5 test suites (Static assets, SPA wildcard, slot locking, 409 contention, release, 15m expiration, preference creation).
  - `npx vitest run tests/adversarial/m4-slot-static-live-challenger.test.ts`: **25 passed, 0 failed**.
  - `npx vitest run tests/adversarial/m4-client-adversarial.test.ts`: **20 passed, 0 failed**.
  - `node tests/e2e/run-all.js`: **57 passed, 0 failed** (100% of Master E2E Suite).
  - `npm run build`: Exit code 0, TypeScript compiled and assets synchronized into `dist/`.

---

## 2. Logic Chain

1. **Static Serving Verification**: Observations in §1.1 demonstrate that `app.ts` configures static file resolution across development (`src/client`) and production (`dist/src/client`, `dist/client`) directories. Direct file hits serve CSS/JS/HTML assets with proper MIME types, non-API paths resolve to `index.html` for client-side routing, and `/api/*` requests are strictly trapped by the 404 JSON handler.
2. **Atomic Soft-Locking Invariant**: Observations in §1.2 confirm that `SlotService.acquireSoftLock` executes within an immediate SQLite transaction (`BEGIN IMMEDIATE`) with a conditional update `WHERE status IN ('available', 'AVAILABLE') OR (status IN ('locked', 'SOFT_LOCKED') AND lock_expires_at <= ?)`. This ensures race conditions are impossible under high concurrency (verified via 50 simultaneous parallel requests yielding exactly 1 winner and 49 HTTP 409 responses).
3. **Lock Release & TTL Reclaim**: Observations in §1.2 demonstrate that locks can be explicitly relinquished via `POST /api/slots/:id/release` or automatically reclaimed via lazy sweeping upon TTL expiration (> 15 minutes). Both paths safely return the slot to `'available'` without data corruption or dangling tokens.
4. **Live Server Integration**: Observations in §1.3 demonstrate that the full application stack running as a live HTTP server on port 3000 successfully integrates static asset delivery, slot booking workflows, dynamic forms, Spanish FAQ accordion, and Mercado Pago preference creation.
5. **Conclusion Derivation**: Because all empirical tests (unit, adversarial, live harness, and E2E) passed with 100% success and zero regressions against spec requirements, Milestone 4 satisfies all acceptance criteria.

---

## 3. Caveats

- Tests were run with in-memory / local SQLite test databases using SQLite WAL mode. Production deployment must ensure the host filesystem supports SQLite WAL locks.
- Mercado Pago checkout preferences were tested with server-side SDK/REST mock preference generation; actual credit card processing requires live Mercado Pago credentials as specified in Spec v2.

---

## 4. Conclusion

**Verdict: APPROVE**

Milestone 4 (Slot Soft-Lock Lifecycle, Static Serving & Concurrency Integration) is fully implemented, verified, and hardened against concurrency collisions, malicious payloads, and routing edge cases. All functional requirements (R1-R5) and acceptance criteria are satisfied.

---

## 5. Verification Method

To independently reproduce and verify this assessment, execute the following commands in `c:/LUMINAPROJECT`:

```bash
# 1. Verify TypeScript build and asset compilation
npm run build

# 2. Run Milestone 4 Adversarial Vitest Suite
npx vitest run tests/adversarial/m4-slot-static-live-challenger.test.ts

# 3. Run Milestone 4 Client Logic Adversarial Suite
npx vitest run tests/adversarial/m4-client-adversarial.test.ts

# 4. Run Milestone 4 Live HTTP Server Harness (http://localhost:3000)
npx tsx tests/adversarial/run-m4-live-e2e.js

# 5. Run Master E2E Test Suite (all 57 tests across Tiers 1-4)
node tests/e2e/run-all.js
```

### Invalidation Conditions
- Any failure in the 54-assertion live HTTP harness (`run-m4-live-e2e.js`).
- Failure of parallel lock acquisition test to grant exactly 1 lock under contention.
- Inability of non-API routes to serve `index.html` or `/api/*` returning HTML instead of 404 JSON.
