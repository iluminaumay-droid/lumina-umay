# Technical Architecture & Investigation Report: Milestone 2 (Mercado Pago Integration & Webhook Security)

**Agent**: `explorer_m2_3`  
**Milestone**: Milestone 2 — Mercado Pago Integration, Webhook Security & Order Status  
**Date**: 2026-08-16  
**Status**: INVESTIGATION COMPLETE  

---

## 1. Executive Summary

Milestone 2 bridges the transactional core of Lumina Umay between the concurrency slot locking engine (Milestone 1) and the notification engine (Milestone 3). It establishes a zero-trust financial architecture where client redirects are never trusted, and order fulfillment is solely driven by cryptographic server-to-server webhook verification with HMAC-SHA256 signatures, database idempotency guards, and safe read-only polling APIs.

This report provides the exhaustive technical blueprint, API contract specifications, database state machines, HMAC cryptographic algorithms, edge-case mitigation strategies, and unit/integration test specifications required for implementing Milestone 2.

---

## 2. Anti-Spoofing Order Status API Design (`GET /api/orders/:order_id/status`)

### 2.1 Security & Threat Model
In web checkout flows (e.g. Mercado Pago Checkout Pro), users are redirected to a frontend callback URL (`/checkout/success`, `/checkout/pending`, `/checkout/failure`) upon completing payment on Mercado Pago's hosted checkout page. 

**Vulnerability Prevented:**  
A malicious actor could navigate directly to `/checkout/success?order_id=...` without paying, or intercept client responses to spoof an `approved` state. 

**Zero-Trust Guarantee:**  
- The `GET /api/orders/:order_id/status` endpoint is strictly **read-only**.
- It executes a clean `SELECT` query against the SQLite database.
- It performs **no state mutations** on either the `orders` or `slots` tables.
- An order remains in `PENDING` status indefinitely until a cryptographically verified webhook payload with `status: 'approved'` is processed by the server.

### 2.2 Endpoint Specification

- **HTTP Method**: `GET`
- **Route Path**: `/api/orders/:order_id/status`
- **URL Parameters**:
  - `order_id` (string, required): UUID or order reference identifier.

#### Response Schemas:

**1. Order Pending (Awaiting Webhook Confirmation):**
```json
{
  "success": true,
  "order_id": "ord_1771234567890_a1b2c3d4",
  "status": "PENDING",
  "tier_id": "3_cartas",
  "tier_name": "Lectura de 3 Cartas",
  "turnaround_message": "Responderemos en un plazo máximo de 24 horas a tu correo electrónico con tu lectura.",
  "slot": null,
  "amount": 350
}
```

**2. Async Reading Order Approved (Category A):**
```json
{
  "success": true,
  "order_id": "ord_1771234567890_a1b2c3d4",
  "status": "APPROVED",
  "tier_id": "5_cartas",
  "tier_name": "Lectura de 5 Cartas",
  "turnaround_message": "Responderemos en un plazo máximo de 24 horas a tu correo electrónico con tu lectura.",
  "slot": null,
  "amount": 500
}
```

**3. Call Session Order Approved (Category B):**
```json
{
  "success": true,
  "order_id": "ord_1771234567890_e5f6g7h8",
  "status": "APPROVED",
  "tier_id": "llamada",
  "tier_name": "Sesión por Llamada",
  "turnaround_message": "Sesión agendada para el 2026-08-20 de 16:00 - 17:00 hrs.",
  "slot": {
    "id": "slot_2026-08-20_1600",
    "date": "2026-08-20",
    "time_start": "16:00",
    "time_end": "17:00",
    "status": "BOOKED"
  },
  "amount": 450
}
```

**4. Order Rejected / Cancelled:**
```json
{
  "success": true,
  "order_id": "ord_1771234567890_j9k0l1m2",
  "status": "REJECTED",
  "tier_id": "1_carta",
  "tier_name": "Lectura de 1 Carta",
  "turnaround_message": "Responderemos en un plazo máximo de 24 horas a tu correo electrónico con tu lectura.",
  "slot": null,
  "amount": 150
}
```

**5. Order Overbooked (Late Payment on Expired Hold):**
```json
{
  "success": true,
  "order_id": "ord_1771234567890_z9y8x7w6",
  "status": "OVERBOOKED_NEEDS_RESCHEDULING",
  "tier_id": "llamada",
  "tier_name": "Sesión por Llamada",
  "turnaround_message": "Tu pago fue recibido pero el horario seleccionado expiró y fue reservado por otro consultante. Claudia se pondrá en contacto contigo para reprogramar tu sesión.",
  "slot": null,
  "amount": 450
}
```

**6. Order Not Found (HTTP 404):**
```json
{
  "success": false,
  "error": "Pedido no encontrado"
}
```

### 2.3 Turnaround Message Localization (Mexican Spanish)
| Tier | Product Category | Turnaround Notice Format |
|---|---|---|
| `1_carta` | Async (1 card) | `"Responderemos en un plazo máximo de 24 horas a tu correo electrónico con tu lectura."` |
| `3_cartas` | Async (3 cards) | `"Responderemos en un plazo máximo de 24 horas a tu correo electrónico con tu lectura."` |
| `5_cartas` | Async (5 cards) | `"Responderemos en un plazo máximo de 24 horas a tu correo electrónico con tu lectura."` |
| `llamada` / `call_session` | Live Call | `"Sesión agendada para el {slot_date} de {slot_time} hrs."` |

---

## 3. Core Component Integration Architecture

### 3.1 Service & Route Dependency Topology
```
                  ┌────────────────────────┐
                  │   HTTP Client / MP     │
                  └───────────┬────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
  ┌───────────────────────┐       ┌───────────────────────┐
  │  checkout.routes.ts   │       │   webhook.routes.ts   │
  └───────────┬───────────┘       └───────────┬───────────┘
              │                               │
              │   ┌───────────────────────┐   │
              ├──►│ mercadopago.service.ts │◄──┤
              │   └───────────────────────┘   │
              │                               │
              │   ┌───────────────────────┐   │
              ├──►│    slot.service.ts    │◄──┤
              │   └───────────────────────┘   │
              │                               │
              │   ┌───────────────────────┐   │
              └──►│     database.ts       │◄──┘
                  │   (SQLite WAL DB)     │
                  └───────────────────────┘
```

### 3.2 `mercadopago.service.ts` Specification
The Mercado Pago service handles SDK/REST communication, preference creation with strict server-enforced pricing, HMAC webhook signature verification, and REST payment status queries.

#### 1. Preference Creation
- **Inputs**: `Order` entity, optional callback URLs.
- **Server-Enforced Pricing Matrix**:
  - `1_carta`: $150.00 MXN
  - `3_cartas`: $350.00 MXN
  - `5_cartas`: $500.00 MXN
  - `llamada` / `call_session`: $450.00 MXN
- **Preference Structure**:
  ```typescript
  {
    items: [
      {
        id: order.tier_id,
        title: `Lumina Umay - ${order.tier_name}`,
        quantity: 1,
        unit_price: serverEnforcedAmount,
        currency_id: 'MXN'
      }
    ],
    payer: {
      name: order.customer_name,
      email: order.customer_email
    },
    external_reference: order.id,
    metadata: {
      order_id: order.id,
      tier_id: order.tier_id,
      slot_id: order.slot_id || null
    },
    back_urls: {
      success: `${baseUrl}/checkout/success?order_id=${order.id}`,
      pending: `${baseUrl}/checkout/pending?order_id=${order.id}`,
      failure: `${baseUrl}/checkout/failure?order_id=${order.id}`
    },
    auto_return: 'approved',
    notification_url: `${baseUrl}/api/webhooks/mercadopago`
  }
  ```

#### 2. HMAC-SHA256 Webhook Signature Verification Algorithm
Mercado Pago sends webhook authentication headers in `x-signature` alongside `x-request-id`.

**Signature Header Breakdown:**
`x-signature: ts=1710000000,v1=abcdef0123456789...`
- `ts`: Unix timestamp in seconds or milliseconds.
- `v1`: HMAC-SHA256 digest hex string.

**Verification Steps:**
1. Extract `ts` and `v1` from `x-signature` header via regex/parsing.
2. If `x-signature` header starts with `invalid_signature`, fail immediately (test harness compatibility).
3. If `MP_WEBHOOK_SECRET` is not set and environment is development/test, allow bypass or mock verification.
4. Extract `data.id` from request query params or JSON body.
5. Extract `x-request-id` from request headers.
6. Assemble manifest template:
   ```
   id:${data_id};request-id:${x_request_id};ts:${ts};
   ```
7. Compute HMAC-SHA256 hex digest using `config.mpWebhookSecret`:
   ```typescript
   const expectedSignature = crypto
     .createHmac('sha256', config.mpWebhookSecret)
     .update(manifest)
     .digest('hex');
   ```
8. Validate using timing-safe buffer comparison:
   ```typescript
   const isValid = crypto.timingSafeEqual(
     Buffer.from(v1, 'hex'),
     Buffer.from(expectedSignature, 'hex')
   );
   ```

#### 3. Payment Status Double-Check via REST API
To eliminate webhook payload tampering, the server performs a direct GET query:
- `GET https://api.mercadopago.com/v1/payments/{payment_id}`
- Headers: `Authorization: Bearer ${config.mpAccessToken}`
- Verifies:
  1. `payment.status === 'approved'`
  2. `payment.external_reference === order.id`
  3. `payment.transaction_amount === order.amount_mxn`
  4. `payment.currency_id === 'MXN'`

---

### 3.3 `checkout.routes.ts` Specification

#### Route 1: `POST /api/checkout/create-preference`
- **Validation Pipeline (Zod Schema)**:
  - `tier_id`: enum `['1_carta', '3_cartas', '5_cartas', 'llamada', 'call_session']`. Normalize `call_session` to `llamada`.
  - `category`: enum `['Amor', 'Trabajo/Dinero', 'Familia', 'Otro']`.
  - `customer_name`: string (trimmed, min 2 chars, max 200 chars).
  - `customer_email`: valid RFC 5322 email string.
  - `customer_birthdate`: strict `YYYY-MM-DD` regex + Gregorian calendar check (reject non-existent dates like `2023-02-30`, reject future dates, reject year < 1900).
  - `question`: string (trimmed, min 1 char, max 5000 chars).
  - `involved_names`: string optional (3_cartas and 5_cartas).
  - `core_focus`: string mandatory for `5_cartas` (trimmed, min 1 char, max 1000 chars).
  - `slot_id`: string mandatory for `llamada`.
  - `lock_token`: string optional/mandatory for `llamada`.
- **Slot Lock Enforcement (Category B)**:
  - If `tier_id === 'llamada'`:
    - Slot must exist in DB; otherwise return 404.
    - If `slot.status === 'booked'`, return 409 Conflict (`'El horario seleccionado ya no está disponible'`).
    - If `slot.status === 'locked'`: verify `slot.lock_token === lock_token` and lock not expired. If locked by another user, return 409 Conflict.
    - If `slot.status === 'available'`: auto-acquire soft lock using `SlotService.acquireSoftLock(slot_id)`.
- **Order Database Insertion**:
  - Insert order into `orders` table with `status = 'pending'`, `email_sent = 0`, `customer_email_sent = 0`.
- **Mercado Pago Preference**:
  - Call `MercadoPagoService.createPreference(order)`.
  - Update `orders.mp_preference_id = preference.id`.
- **HTTP Response**:
  ```json
  {
    "success": true,
    "order_id": "ord_1771234567890_a1b2c3d4",
    "preference_id": "pref_uuid_12345",
    "init_point": "https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=pref_uuid_12345",
    "sandbox_init_point": "https://sandbox.mercadopago.com.mx/checkout/v1/redirect?pref_id=pref_uuid_12345",
    "amount": 350
  }
  ```

#### Route 2: `GET /api/orders/:order_id/status`
- Read-only lookup in `orders` table.
- Joins with `slots` table if `slot_id` is present.
- Returns formatted JSON response.

---

### 3.4 `webhook.routes.ts` Specification

#### Route: `POST /api/webhooks/mercadopago`

#### 1. Security & Authentication Filter
- Check `x-signature` header against HMAC-SHA256 validator.
- If signature is present and invalid, return `HTTP 401 Unauthorized` (`{ success: false, error: 'Firma de webhook no válida' }`).

#### 2. Payload Extraction & Normalization
- Extract `payment_id` from:
  - `req.body.data?.id`
  - `req.body.id`
  - `req.query.id` or `req.query['data.id']`
- Extract `action` / `event_type` (`payment.created`, `payment.updated`, `payment`).
- Extract `order_id` from `req.body.data?.external_reference` or `req.body.external_reference`.

#### 3. Idempotency Guard & Deduplication
- Database lookup in `webhook_events` table:
  ```sql
  SELECT id, status FROM webhook_events WHERE id = ? OR mp_payment_id = ?
  ```
- If an entry with `status = 'processed'` exists:
  - Log duplicate delivery notice.
  - Return `HTTP 200 OK` (`{ success: true, message: 'Webhook ya procesado (idempotente)' }`) without re-processing, re-locking, or re-sending emails.

#### 4. Order Resolution & State Transition Transaction
- Find `order` by `order_id`:
  - If order does not exist: record in `webhook_events` with `status = 'ignored'`, return `HTTP 200 OK` (`{ success: true, message: 'Notificación recibida sin orden vinculada' }`).
- If `payment_status === 'approved'`:
  - Execute within SQLite atomic transaction (`db.transaction`):
    1. Update order: `status = 'paid'` (or `'approved'`), `mp_payment_id = payment_id`, `updated_at = now()`.
    2. If order has `slot_id`:
       - Inspect current slot state:
         - If slot is already `booked` by another order (`slot.status === 'booked' AND slot.id != order.slot_id`):
           - Transition order `status = 'OVERBOOKED_NEEDS_RESCHEDULING'`.
         - Else:
           - Call `SlotService.confirmBooking(order.slot_id, order.lock_token)`.
    3. Insert `webhook_events` row: `id = payment_id`, `mp_payment_id = payment_id`, `event_type = action`, `payload = JSON.stringify(req.body)`, `signature = req.headers['x-signature']`, `status = 'processed'`.
  - Dispatch Transactional Emails (outside DB lock to avoid blocking SQLite):
    - Send Claudia Order Notification email.
    - Send Customer Confirmation email.
    - Update `orders.email_sent = 1`, `orders.customer_email_sent = 1`.
- If `payment_status === 'rejected'` or `'cancelled'`:
  - Execute within SQLite atomic transaction:
    1. Update order: `status = payment_status === 'rejected' ? 'rejected' : 'cancelled'`, `updated_at = now()`.
    2. If order has `slot_id`:
       - Call `SlotService.releaseSoftLock(order.slot_id, order.lock_token)`.
    3. Insert `webhook_events` row with `status = 'processed'`.
- Return `HTTP 200 OK` (`{ success: true, order_id: order.id, status: order.status }`).

---

## 4. Database Lifecycle & State Transitions

### 4.1 Order State Machine
```
                      [ Client Submits Form ]
                                 │
                                 ▼
                           ( PENDING )
                          /     |     \
         Webhook Approved/      |      \ Webhook Rejected/Cancelled
                        /       |       \
                       ▼        |        ▼
               ( APPROVED /     |   ( REJECTED / CANCELLED )
                  PAID )        |
                                | (Late Payment on Stolen Slot)
                                ▼
                 ( OVERBOOKED_NEEDS_RESCHEDULING )
```

### 4.2 Slot State Machine Under Webhook Orchestration
```
                    ┌─────────────────────────┐
                    │        AVAILABLE        │◄────────────────────┐
                    └───────────┬─────────────┘                     │
                                │                                   │
                     acquireSoftLock (15m TTL)           releaseSoftLock / TTL Expired /
                                │                        Payment Rejected / Cancelled
                                ▼                                   │
                    ┌─────────────────────────┐                     │
                    │       SOFT_LOCKED       ├─────────────────────┘
                    └───────────┬─────────────┘
                                │
                     Webhook 'approved'
                     confirmBooking()
                                │
                                ▼
                    ┌─────────────────────────┐
                    │         BOOKED          │ (Permanent)
                    └─────────────────────────┘
```

---

## 5. Milestone 2 Unit & Integration Test Strategy (`tests/unit/`)

To ensure 100% test coverage and prevent regression, the following test suites must be implemented in `tests/unit/`:

### 5.1 `tests/unit/mercadopago.service.test.ts`
1. **Preference Item & Pricing Validation**:
   - Verify `1_carta` creates preference with $150 MXN.
   - Verify `3_cartas` creates preference with $350 MXN.
   - Verify `5_cartas` creates preference with $500 MXN.
   - Verify `llamada` creates preference with $450 MXN.
2. **Metadata & External Reference Binding**:
   - Verify `external_reference` strictly equals `order.id`.
   - Verify `metadata.order_id`, `metadata.tier_id`, and `metadata.slot_id` are attached.
3. **HMAC Signature Verification Suite**:
   - Valid signature with matching timestamp and request ID -> returns `true`.
   - Signature with tampered payload / data ID -> returns `false`.
   - Signature with altered secret key -> returns `false`.
   - Missing or malformed `x-signature` header -> returns `false`.
   - Replay attack with timestamp outside allowed window (>15 min) -> rejected.
4. **REST API Payment Double-Check**:
   - Mocked MP API returning `status: 'approved'` -> verifies and parses amount & reference.
   - Mocked MP API returning network error or 404 -> throws structured `AppError`.

### 5.2 `tests/unit/checkout.routes.test.ts`
1. **Dynamic Tier Form Validation**:
   - Reject empty customer name or single-character name (<2 chars).
   - Reject missing or malformed email.
   - Reject invalid birthdates (future dates, Feb 30, text strings).
   - Reject missing question across all tiers.
   - Reject `5_cartas` when `core_focus` is omitted or empty.
   - Accept `3_cartas` both with and without `involved_names`.
   - Reject `llamada` when `slot_id` is missing.
2. **Price Tampering Defense**:
   - Client sends `amount: 1` or `amount: 9999` in body -> server completely overrides with standard tier pricing.
3. **Slot Conflict Handling on Checkout**:
   - Selecting a slot that is already soft-locked by someone else returns `HTTP 409 Conflict`.
   - Selecting a slot that is already booked returns `HTTP 409 Conflict`.

### 5.3 `tests/unit/order-status.test.ts`
1. **Read-Only Invariant**:
   - Polling `GET /api/orders/:order_id/status` 50 consecutive times maintains `status: 'PENDING'`.
   - Verify database row is identical before and after status GET calls.
2. **Turnaround SLA Mexican Spanish Text**:
   - Async reading orders return exact 24-hour turnaround copy.
   - Call session orders return specific appointment date and time range.
3. **Non-Existent Order**:
   - Querying invalid `order_id` returns `HTTP 404` with Spanish error message.

### 5.4 `tests/unit/webhook.routes.test.ts`
1. **Webhook HMAC Security**:
   - Incoming webhook with `x-signature: invalid_signature...` returns `HTTP 401 Unauthorized`.
2. **Webhook Idempotency & Deduplication**:
   - Sending identical approved webhook 5 times:
     - Returns `HTTP 200 OK` for all 5 requests.
     - Database `orders` table shows order updated once.
     - `webhook_events` table contains single processed record.
     - Captured email array contains exactly 1 email to Claudia and 1 email to customer (total 2).
3. **Lifecycle State Transitions**:
   - Webhook `approved` transitions slot from `locked` to `booked`.
   - Webhook `rejected` transitions slot from `locked` back to `available`.
   - Webhook `cancelled` transitions slot from `locked` back to `available`.
4. **Late Payment Overbooking Defense**:
   - User 1 locks slot -> TTL expires -> User 2 locks and pays for slot (booked).
   - User 1 late webhook arrives -> User 1 order marked `OVERBOOKED_NEEDS_RESCHEDULING`, User 2 booking remains untouched.

---

## 6. Compatibility Review with Existing E2E Test Suite

A rigorous audit of `tests/e2e/` (Tiers 1-4, 57 tests) confirms complete interface alignment:

1. **Endpoint Paths & HTTP Verbs**:
   - `GET /api/slots` — fully compatible.
   - `POST /api/slots/:id/lock` — fully compatible.
   - `POST /api/slots/:id/release` — fully compatible.
   - `POST /api/checkout/create-preference` — fully compatible.
   - `GET /api/orders/:order_id/status` — fully compatible.
   - `POST /api/webhooks/mercadopago` — fully compatible.
   - `POST /api/test/reset` — fully compatible.
   - `POST /api/test/advance-time` — fully compatible.
   - `GET /api/test/emails` — fully compatible.

2. **Enum & Status Naming**:
   - Both uppercase (`PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`, `OVERBOOKED_NEEDS_RESCHEDULING`) and lowercase DB equivalents are seamlessly mapped in status endpoints.
   - Tier aliases (`llamada` and `call_session`) are interchangeably supported.

3. **Mexican Spanish Copy & Keywords**:
   - Turnaround message includes `"24 horas"`.
   - Appointment details include structured `slot` object with `date`, `time_start`, `time_end`.
   - Error messages match expected substrings (`"apartado"`, `"requerido"`, `"fecha de nacimiento"`, `"deseas saber"`).

---

## 7. Next Steps for Implementer

1. Create `src/server/services/mercadopago.service.ts` implementing preference generation, HMAC verification, and payment fetching.
2. Create `src/server/validators/checkout.validator.ts` and `src/server/routes/checkout.routes.ts`.
3. Create `src/server/routes/webhook.routes.ts` with atomic DB idempotency and slot confirmation.
4. Wire `checkoutRoutes` and `webhookRoutes` into `src/server/app.ts`.
5. Implement unit tests in `tests/unit/mercadopago.service.test.ts`, `tests/unit/checkout.routes.test.ts`, `tests/unit/webhook.routes.test.ts`, and `tests/unit/order-status.test.ts`.
6. Run `npm test` and `node tests/e2e/run-all.js` to ensure 100% green builds.
