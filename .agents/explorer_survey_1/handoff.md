# Technical Architecture & Concurrency Exploration Report
**Project:** Lumina Umay — Booking & Payment Web Application (v2)  
**Author:** Technical Architecture Explorer (`explorer_survey_1`)  
**Date:** 2026-08-16  
**Status:** COMPLETED (Hard Handoff)

---

## 1. Observation

### 1.1 Source Documents & Direct References
From `c:/LUMINAPROJECT/ORIGINAL_REQUEST.md`:
- **R1 (Multi-Tier Async Reading)**: "3 async reading tiers (1 carta: $150 MXN, 3 cartas: $350 MXN, 5 cartas: $500 MXN) with dynamic form fields corresponding to each tier, mandatory category selection (Amor, Trabajo/Dinero, Familia, Otro), and birthdate/question capture." (Lines 12–14)
- **R2 (Live Call Session Slot Booking & Concurrency)**: "Implement live call booking ($450 MXN) with real-time slot availability, soft-locking during checkout attempt, automated release on timeout/failure, and permanent booking confirmation upon payment to eliminate double-booking." (Lines 15–17)
- **R3 (Mercado Pago Payment & Webhook Verification)**: "Integrate Mercado Pago Checkout for all 4 reading/call tiers with robust server-side webhook verification. Orders and slot locks must strictly only be confirmed when the webhook validates an `approved` payment status." (Lines 18–20)
- **R4 (Order Notification & Email Dispatching)**: "Implement transaction email notifications sending full customer and order details (name, birthdate, tier, category, specific question/focus, and booked time slot for calls) to Claudia, with configurable SMTP/Resend provider integration." (Lines 21–23)
- **R5 (UI/UX Preservation & FAQ)**: "Preserve the exact visual design, color tokens (`--teal`, `--teal-deep`, `--gold`, `--cream`), Cormorant Garamond / Jost typography... Replace the WhatsApp CTA with an interactive Mexican Spanish FAQ accordion." (Lines 24–26)

From `c:/LUMINAPROJECT/lumina-umay-booking-system-spec-v2.md`:
- "The attached HTML file is the current site... Ignore that Netlify deployment going forward. Set up a proper GitHub repository for this project and build inside it, structured normally... Keep the current visual design as-is for now." (Lines 4–8)
- "Site language: **Mexican Spanish** throughout (all copy, labels, buttons, confirmation messages, FAQ, emails)." (Line 10)
- "No email inbox exists yet — flag this as a dependency Claudia needs to set up... Build the email-sending logic assuming a placeholder address for now." (Line 18)
- "Only after payment is confirmed does the order/booking get created — nothing is accepted or scheduled on unpaid submissions." (Line 49)
- "Needs a lightweight backend/database (e.g. Supabase) since a static HTML file has no memory of its own... Store available call slots; only show open ones to the customer. Soft-lock a slot on payment attempt, confirm it permanently once Mercado Pago's webhook approves payment, release it if payment doesn't complete. Prevent two customers from booking the same slot." (Lines 58–63)

### 1.2 Environment & System Context
- Operating system: Windows (`win32`), Node.js ecosystem.
- Target execution: Monorepo / unified Express + Vite/React TypeScript architecture with embedded zero-config SQLite (`better-sqlite3`).

---

## 2. Logic Chain

### 2.1 Stack & Repository Architecture Selection
1. **Frontend + Backend Co-location vs Separation**:
   - *Observation*: The application requires dynamic client forms, interactive slot picking, and instant feedback, coupled with a server handling webhooks, database transactions, and Mercado Pago API calls.
   - *Deduction*: A monolithic Node.js/Express server that serves a Vite/React SPA frontend (compiled to static dist in production, proxying in development) provides the cleanest operational profile: single `npm start`, single port, zero CORS issues in production, zero external server dependencies, and clean Git version control.

2. **Database Engine Selection (`better-sqlite3` in WAL Mode)**:
   - *Observation*: The core risk is race conditions in slot booking where two users click "Pay" on the same slot at the exact same millisecond.
   - *Deduction*: SQLite with `better-sqlite3` operates synchronously within Node event loop execution slices. When configured with Write-Ahead Logging (`PRAGMA journal_mode = WAL;`) and synchronous mode (`PRAGMA synchronous = NORMAL;`), SQLite allows concurrent multi-threaded readers while strictly serializing write transactions without network latency.
   - *Immediate Transaction Lock*: By executing `BEGIN IMMEDIATE` transactions for slot locking, SQLite obtains an exclusive write lock immediately before reading slot availability. This guarantees zero double-booking at the database engine level.

3. **Slot Concurrency & Soft-Locking State Machine**:
   - *Lifecycle*:
     1. `AVAILABLE`: Slot exists, not locked, not booked.
     2. `LOCKED`: User initiated checkout. Slot has `locked_at = now()` and `lock_expires_at = now() + 15 min`, with a unique `lock_token` (UUIDv4).
     3. `BOOKED`: Webhook received with `payment.status == 'approved'`. `status = 'booked'`, `lock_expires_at = NULL`.
     4. `RELEASED / AVAILABLE`: If 15 minutes elapse without confirmed payment, the lock expires automatically.
   - *Atomic SQL Query*:
     ```sql
     UPDATE slots
     SET status = 'locked',
         locked_at = datetime('now'),
         lock_expires_at = datetime('now', '+15 minutes'),
         lock_token = ?,
         updated_at = datetime('now')
     WHERE id = ?
       AND (status = 'available' OR (status = 'locked' AND lock_expires_at < datetime('now')));
     ```
     If `changes === 0`, another checkout session holds the active lock. The API responds with HTTP 409 Conflict (`El horario seleccionado ya fue apartado por otra persona. Por favor elige otro horario.`).

4. **Mercado Pago Webhook Security & Idempotency**:
   - *Observation*: Webhook spoofing and duplicate notifications are standard risks in payment gateways. Netlify or frontend redirect callbacks cannot be trusted alone (`ORIGINAL_REQUEST.md` line 44).
   - *Deduction*:
     1. Webhook endpoint `POST /api/webhooks/mercadopago` extracts `x-signature` header (`ts=<timestamp>,v1=<hash>`) and verifies HMAC-SHA256 signature against `MP_WEBHOOK_SECRET`.
     2. The server queries the Mercado Pago REST API (`GET https://api.mercadopago.com/v1/payments/{id}`) using `MP_ACCESS_TOKEN` to verify the ground truth payment status (`approved`), amount, currency (`MXN`), and `external_reference` (`order_id`).
     3. Idempotency table `webhook_events` stores the processed payment ID. If duplicate webhooks arrive, the system acknowledges with HTTP 200 OK immediately without double-updating or re-emailing.

5. **Notification System**:
   - *Observation*: Claudia does not have an official domain email yet (`spec-v2.md` line 18).
   - *Deduction*: Implement an `EmailService` supporting `nodemailer` (SMTP / Gmail / SendGrid) and `resend`, with an automated fallback to a formatted `Console/Log Dispatcher` and file logger (`.agents/logs/emails.log` or in-memory) when credentials are placeholder values.

---

## 3. Caveats & Assumptions

1. **Timezone Standardization**:
   - All database timestamps (`start_time`, `end_time`, `locked_at`, `lock_expires_at`, `created_at`) must be stored in UTC ISO-8601 strings.
   - Client displays and Claudia's notification emails must explicitly format times in Mexico Central Time (`America/Mexico_City`, UTC-6).
2. **Lock TTL Window**:
   - Default TTL is set to 15 minutes (900 seconds). If a customer takes 16 minutes in Mercado Pago and their lock expires, but another customer books the slot in that 1-minute gap, the webhook will detect that the slot is already booked and transition the order to `manual_review_required` while logging an alert for Claudia.
3. **Admin Slot Seeding**:
   - Call slots are seeded via a seed script or admin API (default: Monday–Friday 10:00–18:00 in 45-minute blocks).
4. **Email Credentials**:
   - In development/sandbox mode without active SMTP credentials, email dispatch succeeds gracefully in `MOCK` mode, logging full HTML/text payloads to server console and storing email status in the database.

---

## 4. Conclusion & Technical Specifications

### 4.1 System Architecture Diagram
```
+-------------------------------------------------------------------------------+
|                             CLIENT BROWSER (SPA)                             |
|  - Cormorant Garamond / Jost Typography, Teal & Gold Tokens                   |
|  - Dynamic Form (1, 3, 5 cartas vs Live Call Slot Picker)                    |
|  - Interactive FAQ Accordion (Mexican Spanish)                                |
+-----------------------+-------------------------------+-----------------------+
                        |                               ^
     1. GET /api/slots  |                               | 4. Success Redirect
     2. POST /api/checkout                              |    (Polling Status)
                        v                               |
+-------------------------------------------------------------------------------+
|                          EXPRESS / TYPESCRIPT BACKEND                         |
|                                                                               |
|  [ Routes ]           [ Services ]                 [ Storage ]                |
|  - /api/slots   --->  - SlotService (Soft-lock TTL) -> SQLite (better-sqlite3) |
|  - /api/checkout ---> - MercadoPagoService (Pref)      WAL Mode & ACID        |
|  - /api/webhooks ---> - WebhookVerifier (HMAC SHA256)  Tables: slots, orders, |
|  - /api/orders  --->  - EmailService (Nodemailer)              webhook_events |
+-----------------------+-------------------------------+-----------------------+
                        |                               ^
     3. Create Pref     |                               | 5. Webhook Notification
        (Checkout Pro)  v                               |    (x-signature)
+-------------------------------------------------------+-----------------------+
|                              MERCADO PAGO GATEWAY                             |
|  - Checkout Pro Hosted Payment Page (Card, SPEI, OXXO)                        |
|  - Server-to-Server Payment Webhook Confirmation                              |
+-------------------------------------------------------------------------------+
```

### 4.2 Database DDL Schema (SQLite)

```sql
-- Pragmas
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

-- Slots Table (Category B - Live Calls)
CREATE TABLE IF NOT EXISTS slots (
    id TEXT PRIMARY KEY,
    start_time TEXT NOT NULL,         -- ISO8601 UTC string (e.g. '2026-08-20T17:00:00.000Z')
    end_time TEXT NOT NULL,           -- ISO8601 UTC string (e.g. '2026-08-20T17:45:00.000Z')
    status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'locked', 'booked', 'cancelled')),
    locked_at TEXT,                   -- Timestamp when soft lock was acquired
    lock_expires_at TEXT,             -- Expiration timestamp for soft lock (NOW + 15 min)
    lock_token TEXT,                  -- UUID token for checkout session ownership
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_slots_status_time ON slots(status, start_time);
CREATE INDEX IF NOT EXISTS idx_slots_lock_expires ON slots(lock_expires_at);

-- Orders Table (Category A & Category B)
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,              -- UUIDv4
    product_tier TEXT NOT NULL CHECK(product_tier IN ('1_carta', '3_cartas', '5_cartas', 'call_session')),
    category TEXT NOT NULL CHECK(category IN ('Amor', 'Trabajo/Dinero', 'Familia', 'Otro')),
    amount_mxn REAL NOT NULL,         -- 150.00, 350.00, 500.00, 450.00
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    customer_birthdate TEXT NOT NULL, -- Format YYYY-MM-DD
    question TEXT NOT NULL,
    involved_person TEXT,             -- Required for 3 and 5 cartas (if applicable)
    desired_focus TEXT,               -- Required for 5 cartas ("Qué es lo que más deseas saber")
    slot_id TEXT,                     -- FK to slots(id) for call sessions
    lock_token TEXT,
    mp_preference_id TEXT,
    mp_payment_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'cancelled', 'expired', 'manual_review')),
    email_sent INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY(slot_id) REFERENCES slots(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_mp_payment ON orders(mp_payment_id);

-- Webhook Events Table (Audit & Idempotency)
CREATE TABLE IF NOT EXISTS webhook_events (
    id TEXT PRIMARY KEY,              -- MP notification ID or hash
    mp_payment_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,            -- Raw JSON payload
    status TEXT NOT NULL CHECK(status IN ('processed', 'ignored', 'failed')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_payment ON webhook_events(mp_payment_id);
```

### 4.3 Slot Concurrency & Soft-Locking Algorithm (`SlotService`)

```typescript
// server/services/slot.service.ts
import { db } from '../db/database';
import { v4 as uuidv4 } from 'uuid';

export class SlotService {
  /**
   * Retrieves all slots that are available or whose soft-lock has expired.
   */
  static getAvailableSlots(): Array<{ id: string; startTime: string; endTime: string }> {
    // Release any expired locks first
    this.releaseExpiredLocks();

    const stmt = db.prepare(`
      SELECT id, start_time as startTime, end_time as endTime 
      FROM slots 
      WHERE status = 'available' 
        AND start_time > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      ORDER BY start_time ASC
    `);
    return stmt.all() as any;
  }

  /**
   * Atomically acquires a 15-minute soft-lock on a slot.
   * Throws Error if slot is unavailable or already locked by another session.
   */
  static acquireSoftLock(slotId: string): { lockToken: string; expiresAt: string } {
    const lockToken = uuidv4();
    
    // SQLite transaction with immediate write lock
    const lockTx = db.transaction(() => {
      const updateStmt = db.prepare(`
        UPDATE slots
        SET status = 'locked',
            locked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
            lock_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+15 minutes'),
            lock_token = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?
          AND (
            status = 'available' 
            OR (status = 'locked' AND lock_expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
          )
      `);

      const result = updateStmt.run(lockToken, slotId);
      if (result.changes === 0) {
        throw new Error('SLOT_ALREADY_LOCKED');
      }

      const slot = db.prepare(`SELECT lock_expires_at FROM slots WHERE id = ?`).get(slotId) as { lock_expires_at: string };
      return { lockToken, expiresAt: slot.lock_expires_at };
    });

    return lockTx();
  }

  /**
   * Permanently confirms a slot booking upon verified payment webhook.
   */
  static confirmBooking(slotId: string, lockToken: string): boolean {
    const confirmTx = db.transaction(() => {
      const updateStmt = db.prepare(`
        UPDATE slots
        SET status = 'booked',
            lock_expires_at = NULL,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND (
          (status = 'locked' AND lock_token = ?) OR
          status = 'available'
        )
      `);
      const result = updateStmt.run(slotId, lockToken);
      return result.changes > 0;
    });

    return confirmTx();
  }

  /**
   * Clean up expired locks back to 'available'.
   */
  static releaseExpiredLocks(): number {
    const stmt = db.prepare(`
      UPDATE slots
      SET status = 'available',
          locked_at = NULL,
          lock_expires_at = NULL,
          lock_token = NULL,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE status = 'locked' 
        AND lock_expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `);
    return stmt.run().changes;
  }
}
```

### 4.4 Mercado Pago Webhook Verification & Order Dispatch Flow

```typescript
// server/services/mercadopago.service.ts
import crypto from 'crypto';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import { db } from '../db/database';
import { SlotService } from './slot.service';
import { EmailService } from './email.service';

export class MercadoPagoService {
  private static client = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN || 'TEST-00000000-0000-0000-0000-000000000000',
  });

  /**
   * Verifies HMAC signature on incoming webhook.
   */
  static verifyWebhookSignature(xSignature: string, xRequestId: string, dataId: string): boolean {
    const secret = process.env.MP_WEBHOOK_SECRET;
    if (!secret || secret === 'placeholder_webhook_secret') {
      // In development mode with placeholder secret, log and allow
      console.warn('[Webhook] MP_WEBHOOK_SECRET is not configured or is placeholder; skipping strict crypto check in dev.');
      return true;
    }

    try {
      const parts = xSignature.split(',');
      let ts = '';
      let v1 = '';
      for (const part of parts) {
        const [k, v] = part.trim().split('=');
        if (k === 'ts') ts = v;
        if (k === 'v1') v1 = v;
      }

      const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
      const computedHash = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
      return crypto.timingSafeEqual(Buffer.from(computedHash), Buffer.from(v1));
    } catch (e) {
      console.error('[Webhook Signature Verification Failed]', e);
      return false;
    }
  }

  /**
   * Handles payment webhook event with full idempotency & payment API double-check.
   */
  static async handlePaymentWebhook(paymentId: string, eventId: string, rawBody: any): Promise<void> {
    // 1. Idempotency Check
    const existing = db.prepare(`SELECT id, status FROM webhook_events WHERE mp_payment_id = ?`).get(paymentId) as any;
    if (existing && existing.status === 'processed') {
      console.log(`[Webhook] Payment ${paymentId} already processed. Skipping.`);
      return;
    }

    // 2. Query Mercado Pago Payment API directly
    const paymentClient = new Payment(this.client);
    const payment = await paymentClient.get({ id: paymentId });

    if (!payment || payment.status !== 'approved') {
      console.log(`[Webhook] Payment ${paymentId} status is '${payment?.status}', not approved.`);
      return;
    }

    const orderId = payment.external_reference;
    if (!orderId) {
      throw new Error(`Payment ${paymentId} is missing external_reference (orderId)`);
    }

    // 3. Atomically finalize Order and confirm Slot in SQLite
    const finalizeTx = db.transaction(() => {
      const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as any;
      if (!order) {
        throw new Error(`Order ${orderId} not found for payment ${paymentId}`);
      }

      if (order.status === 'paid') {
        console.log(`[Webhook] Order ${orderId} already marked as paid.`);
        return order;
      }

      // If call session, confirm slot
      if (order.product_tier === 'call_session' && order.slot_id) {
        const slotConfirmed = SlotService.confirmBooking(order.slot_id, order.lock_token);
        if (!slotConfirmed) {
          console.error(`[CRITICAL] Slot ${order.slot_id} could not be confirmed for Order ${orderId}! Flagging manual review.`);
          db.prepare(`UPDATE orders SET status = 'manual_review', mp_payment_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
            .run(paymentId, orderId);
          return order;
        }
      }

      // Mark order as paid
      db.prepare(`
        UPDATE orders 
        SET status = 'paid', 
            mp_payment_id = ?, 
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') 
        WHERE id = ?
      `).run(paymentId, orderId);

      // Record webhook event
      db.prepare(`
        INSERT OR REPLACE INTO webhook_events (id, mp_payment_id, event_type, payload, status, created_at)
        VALUES (?, ?, 'payment.approved', ?, 'processed', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      `).run(eventId || paymentId, paymentId, JSON.stringify(rawBody));

      return order;
    });

    const updatedOrder = finalizeTx();

    // 4. Trigger Email Notification to Claudia
    if (updatedOrder && updatedOrder.status !== 'manual_review') {
      try {
        await EmailService.sendOrderNotificationToClaudia(updatedOrder);
        db.prepare(`UPDATE orders SET email_sent = 1 WHERE id = ?`).run(orderId);
      } catch (err) {
        console.error(`[Email Dispatch Error] Failed to send email for order ${orderId}:`, err);
      }
    }
  }
}
```

### 4.5 Email Notification Schema & Spanish Template
**Recipient:** Claudia (`CLAUDIA_NOTIFICATION_EMAIL` or fallback `claudia.luminaumay@gmail.com`)  
**Subject:** `✨ Nueva Consulta Lumina Umay: [Tier] - [Cliente]`

**Content Model:**
1. **Detalles del Cliente:**
   - Nombre: `customer_name`
   - Email: `customer_email`
   - Fecha de Nacimiento: `customer_birthdate` (e.g. 14 de Mayo de 1998)
2. **Detalles de la Consulta:**
   - Tipo de Lectura: `1 Carta ($150 MXN)` / `3 Cartas ($350 MXN)` / `5 Cartas ($500 MXN)` / `Sesión en Vivo por Llamada ($450 MXN)`
   - Categoría: `Amor` / `Trabajo/Dinero` / `Familia` / `Otro`
   - Pregunta / Situación: `question`
   - Persona Involucrada: `involved_person` (solo 3 y 5 cartas)
   - Deseo de Enfoque Principal: `desired_focus` (solo 5 cartas)
3. **Horario de Llamada (solo para Sesión en Vivo):**
   - Fecha y Hora: `start_time` formateado a Horario Centro de México (ej. Jueves 20 de Agosto, 17:00 hrs)
   - Duración: 45 minutos
4. **Información de Pago:**
   - Monto Pagado: `$X.00 MXN`
   - ID de Pago Mercado Pago: `mp_payment_id`
   - Fecha de Confirmación: `updated_at`

### 4.6 Environment Variable Contract (`.env.example`)
```bash
# Server Configuration
PORT=3000
NODE_ENV=development
APP_BASE_URL=http://localhost:3000

# SQLite Database
DATABASE_PATH=./data/lumina_umay.sqlite

# Mercado Pago Credentials
MP_ACCESS_TOKEN=TEST-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MP_PUBLIC_KEY=TEST-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MP_WEBHOOK_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Email Notification Configuration (Nodemailer / SMTP)
NOTIFICATION_EMAIL_TO=claudia.luminaumay@gmail.com
EMAIL_PROVIDER=mock # Options: 'smtp', 'resend', 'mock'
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=placeholder_sender@gmail.com
SMTP_PASS=placeholder_app_password
EMAIL_FROM="Lumina Umay Reservaciones <no-reply@luminaumay.com>"

# Optional Resend API Key
RESEND_API_KEY=re_placeholder_xxxxxxxxxxxx
```

---

## 5. Verification Method

To independently verify the architecture and implementation:

1. **Concurrency Race Condition Test (`tests/concurrency.test.ts`)**:
   - Seed a test slot in SQLite.
   - Fire 10 simultaneous asynchronous promises attempting to acquire a soft-lock on the exact same slot ID using `Promise.all()`.
   - Assert: Exactly 1 promise resolves successfully with a valid `lockToken`; 9 promises reject with `SLOT_ALREADY_LOCKED` (HTTP 409).
   - Assert: SQLite database contains exactly 1 active lock with `status = 'locked'`.

2. **Lock Expiration & Sweeper Test**:
   - Seed a slot with `lock_expires_at` set to 1 minute in the past.
   - Request `GET /api/slots`.
   - Assert: The expired slot is automatically reset to `status = 'available'` and returned in the available list.

3. **Webhook Verification & Idempotency Test (`tests/webhook.test.ts`)**:
   - Generate an HMAC-SHA256 signature using test secret and verify valid vs invalid signature payloads.
   - Send duplicate webhook payloads with the same `payment_id`.
   - Assert: First call updates order to `paid`, confirms slot, and invokes email dispatcher; second call returns HTTP 200 without duplicate email dispatch or errors.

4. **Tier Validation Test**:
   - Test validation schemas for 1 carta (must disallow missing birthdate/question), 3 cartas (must include involved person), 5 cartas (must include desired focus), and call session (must require valid `slot_id`).

---
*End of Report — Lumina Umay Technical Architecture Explorer*
