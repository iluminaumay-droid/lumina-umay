# Milestone 2 Technical Analysis & Architecture: Mercado Pago Preference Creation & Order Management

**Author**: explorer_m2_1  
**Project**: Lumina Umay Booking & Payment System  
**Milestone**: M2 — Mercado Pago Integration & Webhook Security  
**Target Areas**: Preference Creation (`POST /api/checkout/create-preference`), Server-Side Pricing Enforcement, SQLite Order Model, Preference Payload Design, Error Handling & Spanish Validation.

---

## 1. Executive Summary & Problem Boundary

In Lumina Umay's architecture, customer order creation and payment initialization must follow a **zero-trust security model**. A client application must never dictate product pricing, order status, or slot assignment. 

The primary objective of this investigation is to design the server-side preference creation flow for Mercado Pago Checkout Pro (`POST /api/checkout/create-preference`), the SQLite `orders` table lifecycle, server-enforced pricing tables, slot concurrency hold validation, Mercado Pago SDK/REST integration, and input validation with authentic Mexican Spanish error responses.

---

## 2. Server-Side Price Enforcement & Product Catalog

### 2.1 Pricing Table & Invariants

The pricing for all 4 available services is fixed on the server and defined strictly in Mexican Pesos (MXN). The client may send an `amount` field in the request body, but it **MUST be ignored**:

| Tier Identifier (`tier_id`) | Spanish Display Title | Price (MXN) | Type | Service Description / Delivery SLA |
| :--- | :--- | :--- | :--- | :--- |
| `1_carta` | Lectura de 1 Carta | **$150 MXN** | Async (Email) | Lectura puntual de sí o no. Entrega en máx 24h. |
| `3_cartas` | Lectura de 3 Cartas | **$350 MXN** | Async (Email) | Lectura general de situación. Entrega en máx 24h. |
| `5_cartas` | Lectura de 5 Cartas | **$500 MXN** | Async (Email) | Lectura profunda con enfoque y personas involucradas. Entrega en máx 24h. |
| `llamada` / `call_session` | Sesión por Llamada | **$450 MXN** | Live Call (45m) | Consulta en vivo por videollamada / llamada en horario reservado. |

### 2.2 Category Taxonomies

Every tier requires the user to select one of the 4 mandatory reading categories:
1. `Amor`
2. `Trabajo/Dinero`
3. `Familia`
4. `Otro`

---

## 3. Checkout Preference Creation Endpoint (`POST /api/checkout/create-preference`)

### 3.1 Endpoint Contract & Workflow

- **Method**: `POST`
- **Path**: `/api/checkout/create-preference`
- **Content-Type**: `application/json`

```
┌─────────────────┐       POST /api/checkout/create-preference      ┌─────────────────────────┐
│                 │ ──────────────────────────────────────────────> │                         │
│                 │   { tier_id, category, customer_name, ... }     │   Lumina Express API    │
│                 │                                                 │                         │
│  Client Browser │                                                 │ 1. Validate Zod Schema  │
│   (Frontend)    │                                                 │ 2. Enforce Tier Price   │
│                 │                                                 │ 3. Validate Slot Lock   │
│                 │                                                 │ 4. Insert DB 'orders'   │
│                 │                                                 │ 5. Create MP Preference │
│                 │ <────────────────────────────────────────────── │ 6. Update DB with pref  │
│                 │   { success: true, order_id, preference_id,     │                         │
│                 │     init_point, sandbox_init_point, amount }    └─────────────────────────┘
└─────────────────┘
```

### 3.2 Request DTO & Fields Validation Matrix

```typescript
export interface CreatePreferenceRequestDTO {
  tier_id: '1_carta' | '3_cartas' | '5_cartas' | 'call_session' | 'llamada';
  category: 'Amor' | 'Trabajo/Dinero' | 'Familia' | 'Otro';
  customer_name: string;
  customer_email: string;
  customer_phone?: string;
  customer_birthdate: string; // Format: YYYY-MM-DD
  question: string;
  involved_names?: string;
  core_focus?: string;
  slot_id?: string;
  lock_token?: string;
  amount?: number; // IGNORED on server
}
```

#### Field-Level Validation Rules:
1. **`tier_id`**:
   - Must be one of `['1_carta', '3_cartas', '5_cartas', 'llamada', 'call_session']`.
   - Error on failure: `"Tipo de lectura no válido"`.
2. **`category`**:
   - Must be one of `['Amor', 'Trabajo/Dinero', 'Familia', 'Otro']`.
   - Error on failure: `"Por favor selecciona una categoría válida"`.
3. **`customer_name`**:
   - String, trimmed length $\ge 2$ characters.
   - Error on failure: `"Nombre del consultante requerido"`.
4. **`customer_email`**:
   - Valid RFC-compliant email string.
   - Error on failure: `"Correo electrónico válido requerido"`.
5. **`customer_birthdate`**:
   - Format: `YYYY-MM-DD`.
   - Must be a valid historical calendar date (e.g. reject `2023-02-30`, `1990/05/10`).
   - Must be strictly before today (`birthdate < now`).
   - Must be reasonable ($year \ge 1900$).
   - Error on failure: `"Por favor ingresa una fecha de nacimiento válida."`.
6. **`question`**:
   - String, trimmed length $\ge 1$ character (can accept up to 5,000+ characters).
   - Error on failure: `"Por favor ingresa tu pregunta o consulta"`.
7. **`involved_names`**:
   - Optional for `3_cartas`, `5_cartas`, `llamada`. Trimmed string or `null`.
8. **`core_focus`**:
   - Mandatory for `5_cartas`: trimmed length $\ge 1$ character.
   - Error on failure: `"Por favor especifica qué es lo que más deseas saber"`.
   - Optional/ignored for other tiers.
9. **`slot_id`**:
   - Mandatory for `llamada` / `call_session`.
   - Error on failure: `"Por favor selecciona un horario para tu llamada"`.
   - Must not be provided or ignored for async card reading tiers (`1_carta`, `3_cartas`, `5_cartas`).
10. **`lock_token`**:
    - Optional hold token UUID. If omitted but `slot_id` is available, backend will atomically acquire a new soft-lock.

---

## 4. Slot Concurrency & Hold Validation for Call Sessions

When `tier_id === 'llamada'` or `tier_id === 'call_session'`:
1. Check if `slot_id` exists in `slots` table:
   - If not found $\rightarrow$ HTTP `404 Not Found` (`"Horario no encontrado"`).
2. Check `slot.status`:
   - If `booked` or `BOOKED` $\rightarrow$ HTTP `409 Conflict` (`"El horario seleccionado ya no está disponible"` or `"Este horario ya ha sido confirmado y reservado permanentemente."`).
   - If `locked` or `SOFT_LOCKED`:
     - If `lock_expires_at <= now` (expired lock) $\rightarrow$ Slot is re-claimable; acquire atomic soft lock with new `lock_token`.
     - If `lock_expires_at > now` AND `lock_token` matches the user's active session token $\rightarrow$ Valid hold! Keep existing lock.
     - If `lock_expires_at > now` AND `lock_token` does not match $\rightarrow$ HTTP `409 Conflict` (`"El horario seleccionado ya fue apartado por otra persona. Por favor elige otro horario."`).
   - If `available` or `AVAILABLE`:
     - Atomically lock slot with a 15-minute TTL (`SlotService.acquireSoftLock(slotId, 15)`).

---

## 5. SQLite `orders` Entity Schema & Lifecycle

### 5.1 Database Schema Representation

The table schema in `src/server/db/schema.sql` (Line 24) supports all required fields:

```sql
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,                              -- 'ord_' + Date.now() + '_' + random or UUIDv4
    tier_id TEXT NOT NULL CHECK(tier_id IN ('1_carta', '3_cartas', '5_cartas', 'call_session', 'llamada')),
    category TEXT NOT NULL CHECK(category IN ('Amor', 'Trabajo/Dinero', 'Familia', 'Otro')),
    amount_mxn REAL NOT NULL CHECK(amount_mxn > 0),
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    customer_phone TEXT,
    customer_birthdate TEXT NOT NULL,                 -- Format YYYY-MM-DD
    question TEXT NOT NULL,
    involved_names TEXT,
    core_focus TEXT,
    slot_id TEXT,
    lock_token TEXT,
    mp_preference_id TEXT,
    mp_payment_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'failed', 'cancelled', 'expired', 'manual_review', 'approved', 'rejected', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'OVERBOOKED_NEEDS_RESCHEDULING')),
    email_sent INTEGER NOT NULL DEFAULT 0 CHECK(email_sent IN (0, 1)),
    customer_email_sent INTEGER NOT NULL DEFAULT 0 CHECK(customer_email_sent IN (0, 1)),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY(slot_id) REFERENCES slots(id) ON DELETE SET NULL
);
```

### 5.2 Order State Machine

```
                  ┌──────────────────────┐
                  │       PENDING        │  (Created on /checkout/create-preference)
                  └──────────┬───────────┘
                             │
            ┌────────────────┼────────────────┐
            │ Webhook MP     │ Webhook MP     │ Webhook MP (Expired/Late Hold)
            │ 'approved'     │ 'rejected'/'cancelled'
            ▼                ▼                ▼
     ┌──────────────┐ ┌──────────────┐ ┌────────────────────────────────────┐
     │   APPROVED   │ │   REJECTED   │ │   OVERBOOKED_NEEDS_RESCHEDULING    │
     │    (PAID)    │ │ (CANCELLED)  │ │ (Paid but slot held by other user) │
     └──────────────┘ └──────────────┘ └────────────────────────────────────┘
            │
            ├─ Confirm slot permanently ('booked')
            ├─ Dispatch Claudia email notification
            └─ Dispatch Customer confirmation email
```

---

## 6. Mercado Pago Preference Payload Structure

When generating the Checkout Pro preference via `mercadopago` SDK v2 (or REST API fallback):

```typescript
const preferencePayload = {
  items: [
    {
      id: order.tier_id,
      title: getTierTitle(order.tier_id), // e.g. "Lectura de 3 Cartas - Lumina Umay"
      description: getTierDescription(order.tier_id),
      quantity: 1,
      unit_price: order.amount_mxn, // Enforced: 150, 350, 500, or 450
      currency_id: 'MXN',
    }
  ],
  payer: {
    name: order.customer_name,
    email: order.customer_email,
  },
  back_urls: {
    success: `${baseUrl}/checkout/success?order_id=${order.id}`,
    failure: `${baseUrl}/checkout/failure?order_id=${order.id}`,
    pending: `${baseUrl}/checkout/pending?order_id=${order.id}`,
  },
  auto_return: 'approved',
  external_reference: order.id, // Mandatory: ties payment to DB order
  notification_url: `${baseUrl}/api/webhooks/mercadopago`,
  metadata: {
    order_id: order.id,
    tier_id: order.tier_id,
    category: order.category,
    slot_id: order.slot_id || null,
    customer_birthdate: order.customer_birthdate,
  },
  statement_descriptor: 'LUMINA UMAY',
};
```

### 6.1 Mock / Offline Mode for CI & Automated Testing
When `process.env.MP_ACCESS_TOKEN` is not provided (or in test environment), `MercadoPagoService` must seamlessly generate:
- `preference_id`: `pref_${crypto.randomUUID()}`
- `init_point`: `https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=${preferenceId}`
- `sandbox_init_point`: `https://sandbox.mercadopago.com.mx/checkout/v1/redirect?pref_id=${preferenceId}`

---

## 7. Order Status Polling Endpoint (`GET /api/orders/:order_id/status`)

To provide post-checkout polling for frontend clients without trusting client redirects:

- **Method**: `GET`
- **Path**: `/api/orders/:order_id/status`
- **Response**:
```json
{
  "success": true,
  "order_id": "ord_1723845000_1234",
  "status": "PENDING",
  "tier_id": "3_cartas",
  "tier_name": "Lectura de 3 Cartas",
  "turnaround_message": "Responderemos en un plazo máximo de 24 horas a tu correo electrónico con tu lectura.",
  "slot": null,
  "amount": 350
}
```

For call session orders (`llamada`):
```json
{
  "success": true,
  "order_id": "ord_1723845000_5678",
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

---

## 8. Summary of Proposed Files to Implement in Milestone 2

1. **`src/server/types/checkout.types.ts`**: Complete TypeScript DTOs, tier configurations, and status types.
2. **`src/server/validators/checkout.validator.ts`**: Zod validation schemas with strict birthdate calendar validation and conditional tier rules.
3. **`src/server/services/mercadopago.service.ts`**: Mercado Pago SDK v2 initialization, preference creation, payment verification, and HMAC signature authentication.
4. **`src/server/services/order.service.ts`**: SQLite order entity creation, slot lock verification, status polling query, and turnaround message generation.
5. **`src/server/routes/checkout.routes.ts`**: Express router exposing `POST /create-preference` and `GET /:order_id/status` (also mounted at `/api/orders/:order_id/status`).
6. **`src/server/app.ts`**: Register checkout router and order status router.
