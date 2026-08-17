# Lumina Umay Booking & Payment System — Specification Mining Report

**Date**: 2026-08-16T21:10:00Z  
**Agent**: `spec_miner_survey_1`  
**Working Directory**: `c:/LUMINAPROJECT/.agents/spec_miner_survey_1`  
**Target Specification Sources**:
- `c:/LUMINAPROJECT/ORIGINAL_REQUEST.md`
- `c:/LUMINAPROJECT/lumina-umay-booking-system-spec-v2.md`

---

## 1. Observation

### 1.1 Direct Source Text Quotes & Line Citations

#### From `ORIGINAL_REQUEST.md`:
- **Line 5**: `"Build a fully functional booking and payment web application for Lumina Umay tarot services based on c:/LUMINAPROJECT/lumina-umay-booking-system-spec-v2.md and the existing UI reference, featuring 3 async card reading tiers, live call session slot booking with concurrency control, Mercado Pago Checkout & webhook verification, automated order email dispatching, and an interactive FAQ section in Mexican Spanish."`
- **Lines 12-13 (R1)**: `"Implement the 3 async reading tiers (1 carta: $150 MXN, 3 cartas: $350 MXN, 5 cartas: $500 MXN) with dynamic form fields corresponding to each tier, mandatory category selection (Amor, Trabajo/Dinero, Familia, Otro), and birthdate/question capture."`
- **Lines 15-16 (R2)**: `"Implement live call booking ($450 MXN) with real-time slot availability, soft-locking during checkout attempt, automated release on timeout/failure, and permanent booking confirmation upon payment to eliminate double-booking."`
- **Lines 18-19 (R3)**: `"Integrate Mercado Pago Checkout for all 4 reading/call tiers with robust server-side webhook verification. Orders and slot locks must strictly only be confirmed when the webhook validates an approved payment status."`
- **Lines 21-22 (R4)**: `"Implement transaction email notifications sending full customer and order details (name, birthdate, tier, category, specific question/focus, and booked time slot for calls) to Claudia, with configurable SMTP/Resend provider integration."`
- **Lines 24-25 (R5)**: `"Preserve the exact visual design, color tokens (--teal, --teal-deep, --gold, --cream), Cormorant Garamond / Jost typography, and mobile-app shell experience from the original HTML. Replace the WhatsApp CTA with an interactive Mexican Spanish FAQ accordion."`
- **Lines 30-33 (Form & Product Tiers Criteria)**:
  - `"Selecting 1 carta shows Nombre, Fecha de nacimiento, Pregunta, and Categoría ($150 MXN)."`
  - `"Selecting 3 cartas shows additional Nombre de la persona involucrada ($350 MXN)."`
  - `"Selecting 5 cartas shows additional Qué es lo que más deseas saber ($500 MXN)."`
  - `"All inputs validate properly on client and server before payment initiation."`
- **Lines 36-39 (Booking & Concurrency Criteria)**:
  - `"Only currently available slots are displayed to the user."`
  - `"Selecting a slot places a temporary hold/soft-lock during the checkout session."`
  - `"Two simultaneous attempts on the same slot result in only one lock, preventing race conditions."`
  - `"Slot unlocks automatically if payment is abandoned or fails within expiration window."`
- **Lines 42-45 (Payment & Webhook Security Criteria)**:
  - `"Checkout preferences are generated server-side with correct pricing and metadata."`
  - `"Server exposes a webhook endpoint that verifies Mercado Pago notifications."`
  - `"Client redirect to success page without verified webhook payment does not create an active order or confirmed booking."`
  - `"Webhook triggers order creation, slot permanence, and email notification on payment.status == 'approved'."`
- **Lines 48-50 (Notifications & Content Criteria)**:
  - `"Email dispatcher compiles complete order context and handles placeholder/live credentials gracefully."`
  - `"FAQ section renders and toggles answers to key customer questions in natural Mexican Spanish."`
  - `"Confirmation views accurately show the 24-hour turnaround for async readings or confirmed appointment time for calls."`

#### From `lumina-umay-booking-system-spec-v2.md`:
- **Line 10**: `"Site language: Mexican Spanish throughout (all copy, labels, buttons, confirmation messages, FAQ, emails)."`
- **Lines 13-18**:
  - `"Remove: the WhatsApp contact link/CTA at the end of the flow (the official WhatsApp number isn't ready yet)"`
  - `"Add: a standard FAQ section in its place"`
  - `"Add: full Mercado Pago checkout integration (currently not actually wired up)"`
  - `"Expand: the single 'lectura por mensaje' product into 3 priced tiers (see below)"`
  - `"Keep: the call session product, but it now requires actual slot booking (see Booking Logic)"`
  - `"No email inbox exists yet — flag this as a dependency Claudia needs to set up (e.g. a Gmail or a Resend-verified sender address) before notifications can go out. Build the email-sending logic assuming a placeholder address for now."`
- **Lines 22-41 (Category A Product Menu)**:
  - `"Async only. No time slot needed. Guarantee: response within 24 hours. Payment required before the order is accepted."`
  - Tier Table: `1 carta: $150 MXN (Solo preguntas de sí o no)`, `3 cartas: $350 MXN (Pregunta o situación general)`, `5 cartas: $500 MXN (Pregunta o situación más profunda)`
  - Fields per tier:
    - `1 carta`: `Nombre`, `Fecha de nacimiento`, `Pregunta`
    - `3 cartas`: `Nombre`, `Fecha de nacimiento`, `Pregunta/Situación`, `Nombre de la persona involucrada (si aplica)`
    - `5 cartas`: `Nombre`, `Fecha de nacimiento`, `Pregunta/Situación`, `Nombre de la(s) persona(s) involucrada(s) (si aplica)`, `Qué es lo que más deseas saber`
  - Required Category Dropdown: `Amor`, `Trabajo/Dinero`, `Familia`, `Otro`
- **Lines 42-44 (Category B Product Menu)**:
  - `"Sesión por llamada: Unchanged in concept from before: live call, requires picking an actual available time slot. This is the only product type that needs the slot-booking/availability system — card readings do not."`
- **Lines 45-52 (Flow Definition)**:
  - `"1. Customer opens the site and picks a reading type/tier"`
  - `"2. Customer fills out the fields for that tier + selects category dropdown (+ picks a call time slot, only for Category B)"`
  - `"3. Customer pays via Mercado Pago"`
  - `"4. Only after payment is confirmed does the order/booking get created — nothing is accepted or scheduled on unpaid submissions"`
  - `"5. Claudia receives an email with the full order details (name, birth date, question/situation, category, tier, and — for calls — the booked slot)"`
  - `"6. Customer sees a confirmation screen: for card readings, a 'responderemos en 24 horas' message; for calls, their confirmed date/time"`
- **Lines 54-57 (Mercado Pago Integration)**:
  - `"Set up real Mercado Pago Checkout Pro (or Checkout API) for all 5 products"`
  - `"Use a webhook/notification callback from Mercado Pago to confirm payment server-side — do not trust the frontend 'payment successful' redirect alone, since that can be reached without actually paying"`
  - `"Only trigger the confirmation email + (for calls) slot-lock after the webhook confirms approved status"`
- **Lines 58-63 (Booking Logic)**:
  - `"Needs a lightweight backend/database (e.g. Supabase [or SQLite/Better-SQLite3]) since a static HTML file has no memory of its own"`
  - `"Store available call slots; only show open ones to the customer"`
  - `"Soft-lock a slot on payment attempt, confirm it permanently once Mercado Pago's webhook approves payment, release it if payment doesn't complete"`
  - `"Prevent two customers from booking the same slot"`
- **Lines 65-71 (FAQ Section)**:
  - Questions: `¿Cómo recibo mi lectura?`, `¿Cuánto tarda en llegar la respuesta?`, `¿Qué pasa si no puedo asistir a mi llamada agendada?`, `¿Los pagos son seguros?`, `¿Puedo cambiar mi pregunta después de pagar?`

---

## 2. Logic Chain

1. **Service Categorization & Pricing Structure**:
   - The application has exactly 4 distinct purchasable offerings:
     - 3 asynchronous card reading tiers (Category A): 1 carta ($150 MXN), 3 cartas ($350 MXN), 5 cartas ($500 MXN).
     - 1 synchronous live call session tier (Category B): Sesión por llamada ($450 MXN).
   - Prices are fixed in Mexican Pesos (MXN). The server must strictly validate and compute prices based on the selected tier, preventing any client-side tampering.

2. **Form Input Composition & Dynamic Field Polymorphism**:
   - All 4 products share a core set of required inputs:
     - `Nombre` (Customer name, min 2 chars)
     - `Fecha de nacimiento` (Date of birth, YYYY-MM-DD format, valid past date)
     - `Email` (Contact email for delivery and receipt)
     - `Categoría` (Enum: `Amor`, `Trabajo/Dinero`, `Familia`, `Otro`)
   - Product-specific dynamic fields:
     - **1 carta**: `Pregunta` (Yes/No question focus)
     - **3 cartas**: `Pregunta/Situación` + optional `Nombre de la persona involucrada`
     - **5 cartas**: `Pregunta/Situación` + optional `Nombre de la(s) persona(s) involucrada(s)` + required `Qué es lo que más deseas saber`
     - **Sesión por llamada**: `Pregunta/Situación` + required `Slot selection` (Date and time).

3. **Booking Concurrency, Soft-Locking & Slot Lifecycle**:
   - Slot reservation requires a finite state machine: `AVAILABLE` -> `SOFT_LOCKED` (on checkout attempt with TTL, e.g. 10-15 minutes) -> `BOOKED/CONFIRMED` (on webhook `approved`) OR `AVAILABLE` (on lock timeout or payment rejection).
   - Concurrency protection: Atomic database transaction / conditional update (`UPDATE slots SET status='SOFT_LOCKED' WHERE id=? AND status='AVAILABLE'`). If 0 rows updated, return HTTP 409 Conflict. This guarantees zero double-booking under high concurrency.

4. **Mercado Pago Checkout & Webhook Security Invariant**:
   - Frontend triggers checkout creation on the server (`/api/checkout/create-preference`).
   - Server creates a Mercado Pago Preference with `items`, `payer`, `metadata`/`external_reference` (containing order reference and slot hold token), `back_urls`, and `notification_url`.
   - The client redirect to the `success` page is strictly presentation-only. The server NEVER confirms an order or locks a slot permanently based on client redirect params.
   - The webhook endpoint receives IPN notifications from Mercado Pago, calls the Mercado Pago API (`/v1/payments/{id}`) to verify actual payment status, and only executes order confirmation, slot permanence, and email notifications if `payment.status === 'approved'`.
   - Idempotency is enforced: duplicate webhook notifications for the same `payment_id` must not create duplicate orders or trigger multiple emails.

5. **Notification System & Claudia Recipient Handling**:
   - Upon payment confirmation, an automated email is dispatched to Claudia with all consultation data: Name, DOB, Service Tier, Category, Amount Paid, Questions/Focus, Involved Person(s), Core desires (for 5 cards), and Booked Slot (for calls).
   - Customer receives a confirmation email / view with clear expectations:
     - Async readings: 24-hour turnaround notice ("Garantía de respuesta en menos de 24 horas").
     - Calls: Date, time, and session guidance.
   - Email provider layer is abstracted with support for Resend, SMTP, and a Mock/Console logger fallback for environments without live API credentials.

6. **Design Preservation, Mexican Spanish Copy & Interactive FAQ**:
   - Preservation of CSS design tokens (`--teal`, `--teal-deep`, `--gold`, `--cream`) and typography (`Cormorant Garamond` serif headings, `Jost` sans-serif body).
   - Mobile-first app shell layout.
   - Removal of obsolete WhatsApp CTA button.
   - Implementation of Mexican Spanish FAQ accordion covering delivery format, 24h turnaround, rescheduling policies, Mercado Pago security, and question modifications.

---

## 3. Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Product Catalog | Lectura 1 Carta ($150 MXN) | 1-card async tarot reading for yes/no questions with 24h turnaround. | `nombre`, `fecha_nacimiento`, `email`, `categoria`, `pregunta` | Preference ID / Checkout URL, 24h confirmation | 400 Bad Request on missing/invalid fields | Spec v2 § Product menu & Original Request R1 |
| 2 | Product Catalog | Lectura 3 Cartas ($350 MXN) | 3-card async tarot reading for general situations with 24h turnaround. | `nombre`, `fecha_nacimiento`, `email`, `categoria`, `pregunta`, `nombre_involucrado` (opt) | Preference ID / Checkout URL, 24h confirmation | 400 Bad Request on missing/invalid fields | Spec v2 § Product menu & Original Request R1 |
| 3 | Product Catalog | Lectura 5 Cartas ($500 MXN) | 5-card deep async tarot reading with core focus capture and 24h turnaround. | `nombre`, `fecha_nacimiento`, `email`, `categoria`, `pregunta`, `personas_involucradas` (opt), `deseo_saber` | Preference ID / Checkout URL, 24h confirmation | 400 Bad Request on missing/invalid fields | Spec v2 § Product menu & Original Request R1 |
| 4 | Product Catalog | Sesión por Llamada ($450 MXN) | Live 1-on-1 scheduled call consultation with calendar slot booking. | `nombre`, `fecha_nacimiento`, `email`, `categoria`, `pregunta`, `slot_id` | Preference ID / Checkout URL, confirmed date/time view | 400/409 on invalid or taken slot | Spec v2 § Category B & Original Request R2 |
| 5 | Dynamic Forms | Tier-Adaptive Form UI | Dynamic client-side and server-side form field rendering based on selected tier. | Selected Tier ID | Dynamic input form fields with validation attributes | Disables submission until valid | Original Request R1 & Acceptance Criteria |
| 6 | Form Validation | Category Dropdown Enforcement | Mandatory selection of reading category from fixed enum. | Dropdown selection (`Amor`, `Trabajo/Dinero`, `Familia`, `Otro`) | Validated category string | Validation error if unselected or outside enum | Spec v2 § Product menu & Original Request R1 |
| 7 | Form Validation | Birthdate Validation | Validation of user birthdate in YYYY-MM-DD format. | Birthdate string | Validated Date object (must be past date, reasonable age range) | Validation error on invalid format, future date, or age out of bounds | Spec v2 § Fields per tier & Original Request R1 |
| 8 | Slot Booking | Real-Time Slot Querying | API endpoint returning only currently available/unlocked call slots. | Date range / query params | List of available slots (`id`, `date`, `time_start`, `time_end`) | Returns empty list if no slots available | Spec v2 § Booking logic & Original Request R2 |
| 9 | Concurrency | Slot Soft-Locking Mechanism | Places a temporary hold with TTL (e.g. 10-15 min) on a slot during checkout. | `slot_id`, session identifier / hold token | Lock confirmation with expiration timestamp | 409 Conflict if slot is already soft-locked or booked | Spec v2 § Booking logic & Original Request R2 |
| 10 | Concurrency | Atomic Lock & Race Condition Shield | Atomic database transaction ensuring two simultaneous clicks on the same slot grant only one lock. | Concurrent lock requests for same `slot_id` | 1 successful lock, all other requests receive 409 Conflict | 409 Conflict with user-friendly Spanish message | Original Request R2 & Acceptance Criteria |
| 11 | Concurrency | Auto-Release on Abandonment/Timeout | Background cleanup or query-time release of expired soft locks back to `AVAILABLE`. | Current timestamp > `lock_expires_at` | Slot status reverted to `AVAILABLE` | Silent release; slot becomes claimable | Spec v2 § Booking logic & Original Request R2 |
| 12 | Payment | Server-Side Preference Creation | Secure generation of Mercado Pago Checkout Pro preferences with server-enforced pricing. | Validated order payload & hold token | `preference_id`, `init_point`, `sandbox_init_point` | 400 on validation failure, 500 on MP API error | Spec v2 § Mercado Pago & Original Request R3 |
| 13 | Payment & Security | Webhook Endpoint & Signature Auth | Public webhook endpoint receiving IPN payment notifications from Mercado Pago. | MP notification query (`topic`/`id`) or body (`type`/`data.id`), headers | HTTP 200 OK to Mercado Pago | Rejects unauthenticated/tampered requests | Spec v2 § Mercado Pago & Original Request R3 |
| 14 | Payment & Security | Server-Side Payment Verification | Backend fetches payment state from Mercado Pago API using server access token. | Payment ID from webhook | Verified payment object (`status`, `transaction_amount`, `external_reference`) | Ignores unverified or missing payment records | Spec v2 § Mercado Pago & Original Request R3 |
| 15 | Payment & Security | Anti-Spoofing Redirect Protection | Prevents unauthorized order/booking creation if a user navigates directly to `/checkout/success`. | Client redirect URL query parameters | Read-only polling / status check; never confirms order from client | Returns unconfirmed status if webhook has not approved | Original Request R3 & Acceptance Criteria |
| 16 | Payment & Security | Webhook Idempotency Control | Ensures repeated delivery of the same webhook payment notification executes actions only once. | `payment_id` | Single execution of order creation and email dispatch | Returns 200 OK without re-sending emails or re-locking | Spec v2 § Mercado Pago integration |
| 17 | Order Management | Permanent Booking Confirmation | Transitions soft-locked slot to permanent `BOOKED` state upon `approved` payment. | Webhook `approved` event, `order_id`, `slot_id` | Slot marked `BOOKED`, linked to `order_id` | Logs error if slot hold was invalid | Spec v2 § Booking logic & Original Request R2 |
| 18 | Notifications | Claudia Order Notification Email | Comprehensive email dispatched to Claudia with complete order and customer consultation data. | Confirmed order object | Formatted HTML/Plaintext email sent to Claudia | Logs error, queues retry, does not break webhook 200 response | Spec v2 § Required flow & Original Request R4 |
| 19 | Notifications | Customer Confirmation Email & View | Confirmation email and screen displaying 24h SLA for async readings or confirmed date/time for calls. | Confirmed order object | Client confirmation screen + customer email | Graceful fallback view if email dispatch fails | Spec v2 § Required flow & Original Request R4 |
| 20 | Notifications | Pluggable Email Dispatcher | Abstracted email provider supporting Resend, SMTP, and Local/Mock Logger fallback. | Email payload, provider config | Email delivery result | Falls back gracefully to mock logger when credentials missing | Spec v2 § Context & Original Request R4 |
| 21 | UI/UX | Design System & Token Preservation | CSS styling preserving exact palette (`--teal`, `--teal-deep`, `--gold`, `--cream`) and typography (`Cormorant Garamond`, `Jost`). | CSS design tokens & asset files | Consistent luxury spiritual aesthetic | Visual regression prevention | Spec v2 § Context & Original Request R5 |
| 22 | UI/UX | Mobile App-Shell Experience | Responsive container shell optimized for mobile and desktop screens. | Viewport dimensions | Responsive, centered app shell UI | Adapts fluidly across screen sizes | Original Request R5 |
| 23 | UI/UX & Content | Interactive Mexican Spanish FAQ | Accordion FAQ replacing deprecated WhatsApp CTA with 5 core questions and answers. | User accordion click / toggle | Smooth expand/collapse of FAQ answers | Seamless toggle without page jumps | Spec v2 § FAQ section & Original Request R5 |
| 24 | Localization | Mexican Spanish Copy Compliance | 100% Mexican Spanish localization across all labels, buttons, placehoders, error messages, and emails. | User interaction / error triggers | Natural Mexican Spanish copy | Spanish error banners & validation hints | Spec v2 § Context & Original Request |

---

## 4. Edge Cases

| # | Feature | Input / Scenario | Observed / Required Behavior |
|---|---------|------------------|------------------------------|
| 1 | Concurrency | 2 users submit checkout on the exact same call slot within 10ms. | Atomic database transaction ensures only User 1 receives the soft-lock and preference. User 2 receives HTTP 409 Conflict: `"El horario seleccionado ya fue apartado por otra persona. Por favor elige otro horario."` |
| 2 | Slot Timeout | User soft-locks a slot, proceeds to Mercado Pago, but closes the browser / abandons checkout. | Soft-lock expires after TTL (10-15 mins). Background sweeper or slot availability query resets slot to `AVAILABLE`. Slot becomes visible and bookable by other customers. |
| 3 | Late Payment after Lock Expiry | User keeps Mercado Pago window open for 45 minutes (past lock TTL), slot is booked by someone else, then User 1 finishes payment. | Webhook receives `approved` payment for User 1. System detects slot is already `BOOKED` by User 2. System flags order as `OVERBOOKED_NEEDS_RESCHEDULING`, logs alert, notifies Claudia with urgency, and avoids crashing or overwriting User 2's booking. |
| 4 | Payment Failure / Rejection | User attempts payment but card is declined or payment status is `rejected` / `cancelled`. | Webhook receives `rejected` / `cancelled`. Order is marked `FAILED`. If a call slot was soft-locked by this attempt, the soft lock is immediately released back to `AVAILABLE`. |
| 5 | Webhook Redelivery / Duplication | Mercado Pago sends the exact same `payment.created` / `payment.updated` webhook 3 times. | Server checks database for existing processed `payment_id`. Subsequent webhooks return HTTP 200 OK immediately without creating duplicate orders or sending duplicate emails to Claudia. |
| 6 | Client Spoofing / Direct Success Visit | Malicious user opens `/checkout/success?payment_id=fake123&status=approved` without paying. | Frontend queries backend for order status. Backend checks database; since no verified webhook with `approved` status was received, order is not confirmed. UI displays `"Esperando confirmación del pago..."` or `"No se encontró un pago válido."` |
| 7 | Input Sanitization & XSS | User inputs `<script>alert('hack')</script>` or SQL injection payloads into `Nombre` or `Pregunta`. | Server sanitizes and escapes all strings before storing in database and before rendering into HTML email templates. |
| 8 | Invalid Birthdate Edge Cases | User inputs future birthdate (e.g. `2030-01-01`), February 30th (`2000-02-30`), or non-date string. | Server and client validation rejects input with message: `"Por favor ingresa una fecha de nacimiento válida."` |
| 9 | Missing Optional Fields | 3 cartas submitted without `Nombre de la persona involucrada` or 5 cartas without `Personas involucradas`. | Submission is accepted cleanly. Email to Claudia and confirmation displays `"No especificado"` or omits the optional field cleanly without `undefined` / `null` text. |
| 10 | Missing Mandatory Field in Tier | 5 cartas submitted without `Qué es lo que más deseas saber` or 1 carta without `Pregunta`. | Form submission is blocked on frontend and rejected on backend with HTTP 400 Bad Request: `"Por favor completa todos los campos requeridos para este tipo de lectura."` |
| 11 | Price Manipulation Attempt | Client attempts `POST /api/checkout/create-preference` with body `{ tier: '5_cartas', amount: 1 }`. | Server ignores client-supplied `amount` and strictly looks up the price from authoritative server catalog: 5 cartas = $500 MXN. |
| 12 | Email Service Outage | Resend or SMTP credentials are invalid, or network times out during Claudia email dispatch. | Email failure is caught and logged. Webhook returns HTTP 200 OK to Mercado Pago (preventing infinite webhook retry loops). Order remains safely recorded in database with email status `PENDING_RETRY` or `FAILED`. |
| 13 | Placeholder Email Credentials | System running in test/development mode with placeholder Claudia email (`claudia@luminaway.com`) and mock email transport. | Email dispatcher safely prints structured order payload to server logs without throwing unhandled exceptions. |
| 14 | FAQ Accordion Interactions | User clicks multiple FAQ accordion items rapidly or toggles open item. | Accordion smoothly expands/collapses clicked item, maintaining clear state without layout shifts or text overlaps. |

---

## 5. Comprehensive Domain Specifications

### 5.1 Data Models & Schemas

#### 5.1.1 Slot Model (Category B)
```typescript
interface Slot {
  id: string; // UUID or string (e.g. "slot_2026-08-20_1600")
  date: string; // YYYY-MM-DD
  time_start: string; // HH:mm (e.g. "16:00")
  time_end: string; // HH:mm (e.g. "17:00")
  status: 'AVAILABLE' | 'SOFT_LOCKED' | 'BOOKED';
  hold_token: string | null; // Random session token for current checkout attempt
  locked_at: string | null; // ISO timestamp
  lock_expires_at: string | null; // ISO timestamp (e.g. locked_at + 15 min)
  order_id: string | null; // Linked upon approved payment
  created_at: string;
  updated_at: string;
}
```

#### 5.1.2 Order Model
```typescript
interface Order {
  id: string; // UUID (e.g. "ord_1723847291000")
  tier_id: '1_carta' | '3_cartas' | '5_cartas' | 'llamada';
  tier_name: string; // e.g. "Lectura de 1 Carta", "Sesión por Llamada"
  category: 'Amor' | 'Trabajo/Dinero' | 'Familia' | 'Otro';
  amount: number; // 150, 350, 500, 450
  currency: 'MXN';
  
  // Customer Data
  customer_name: string;
  customer_email: string;
  customer_birthdate: string; // YYYY-MM-DD
  
  // Tier Specific Data
  question: string;
  involved_names?: string | null; // For 3 & 5 cartas
  core_focus?: string | null; // For 5 cartas ("Qué es lo que más deseas saber")
  
  // Call Specific Data
  slot_id?: string | null;
  slot_date?: string | null;
  slot_time?: string | null;
  
  // Payment Lifecycle
  payment_status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'REFUNDED';
  mp_preference_id?: string | null;
  mp_payment_id?: string | null;
  mp_merchant_order_id?: string | null;
  
  // Notification Lifecycle
  email_claudia_status: 'PENDING' | 'SENT' | 'FAILED' | 'MOCK_LOGGED';
  email_customer_status: 'PENDING' | 'SENT' | 'FAILED' | 'MOCK_LOGGED';
  
  created_at: string;
  updated_at: string;
}
```

---

### 5.2 API Interface Specifications

#### 1. `GET /api/slots`
- **Purpose**: Retrieve open, bookable slots for the live call calendar.
- **Query Params**: `date` (optional filter, `YYYY-MM-DD`), `from_date` (optional).
- **Behavior**: Auto-expires stale soft locks (`lock_expires_at < NOW()`) and returns all slots with `status = 'AVAILABLE'`.
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "slots": [
      {
        "id": "slot_2026-08-20_1600",
        "date": "2026-08-20",
        "time_start": "16:00",
        "time_end": "17:00",
        "status": "AVAILABLE"
      }
    ]
  }
  ```

#### 2. `POST /api/checkout/create-preference`
- **Purpose**: Validate order input, place soft-lock on slot (if call session), create Mercado Pago preference, and return checkout URL.
- **Request Body**:
  ```json
  {
    "tier_id": "3_cartas", // "1_carta" | "3_cartas" | "5_cartas" | "llamada"
    "category": "Amor", // "Amor" | "Trabajo/Dinero" | "Familia" | "Otro"
    "customer_name": "Valeria Gómez",
    "customer_email": "valeria@example.com",
    "customer_birthdate": "1995-04-12",
    "question": "¿Cómo evolucionará mi relación en los próximos meses?",
    "involved_names": "Carlos Méndez", // Optional
    "core_focus": null, // Required only for 5_cartas
    "slot_id": null // Required only for llamada
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "order_id": "ord_987654321",
    "preference_id": "123456789-abcdef-...",
    "init_point": "https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=...",
    "sandbox_init_point": "https://sandbox.mercadopago.com.mx/checkout/v1/redirect?pref_id=..."
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: `{"success": false, "error": "Campos requeridos faltantes o inválidos"}`
  - `409 Conflict`: `{"success": false, "error": "El horario seleccionado ya no está disponible. Por favor elige otro."}`

#### 3. `POST /api/webhooks/mercadopago`
- **Purpose**: Handle asynchronous notifications from Mercado Pago.
- **Query / Body**: `topic=payment&id=12345` OR `{"type": "payment", "data": {"id": "12345"}}`
- **Behavior**:
  1. Extract payment ID.
  2. Fetch payment resource from Mercado Pago API (`/v1/payments/{id}`).
  3. Extract `external_reference` (order_id) and `status`.
  4. If `status === 'approved'`:
     - Transition order to `APPROVED`.
     - Transition slot (if call) from `SOFT_LOCKED` to `BOOKED`.
     - Dispatch notification email to Claudia.
     - Dispatch confirmation email to Customer.
  5. If `status === 'rejected'` or `'cancelled'`:
     - Transition order to `REJECTED`.
     - Release soft lock on slot back to `AVAILABLE`.
  6. Return HTTP `200 OK` immediately.

#### 4. `GET /api/orders/:order_id/status`
- **Purpose**: Polling endpoint for frontend success view to verify if order has been approved by webhook.
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "order_id": "ord_987654321",
    "status": "APPROVED", // "PENDING" | "APPROVED" | "REJECTED"
    "tier_id": "3_cartas",
    "tier_name": "Lectura de 3 Cartas",
    "turnaround_message": "Responderemos en un plazo máximo de 24 horas a tu correo.",
    "slot": null
  }
  ```

---

### 5.3 Notification Payloads & Email Templates (Mexican Spanish)

#### 5.3.1 Email to Claudia (Practitioner Notification)
- **Subject**: `✨ Nueva Lectura Pagada: [Tier Name] - [Customer Name]`
- **Body Content**:
  - **Detalles del Pedido**:
    - ID del Pedido: `ord_987654321`
    - ID de Pago Mercado Pago: `1234567890`
    - Servicio: `Lectura de 3 Cartas`
    - Monto: `$350 MXN`
    - Categoría: `Amor`
    - Fecha y Hora de Compra: `16 de Agosto de 2026, 21:15 hrs`
  - **Datos del Consultante**:
    - Nombre Completo: `Valeria Gómez`
    - Correo Electrónico: `valeria@example.com`
    - Fecha de Nacimiento: `12 de Abril de 1995`
  - **Contenido de la Consulta**:
    - Pregunta / Situación: `¿Cómo evolucionará mi relación en los próximos meses?`
    - Persona(s) Involucrada(s): `Carlos Méndez`
    - Qué es lo que más desea saber: `N/A` (o texto si 5 cartas)
    - Horario de Llamada Agendada: `N/A` (o `20 de Agosto de 2026 a las 16:00 hrs` para llamadas)

#### 5.3.2 Email to Customer (Confirmation)
- **Subject**: `🔮 Confirmación de tu consulta en Lumina Umay - [Order ID]`
- **Body Content (Async Readings - 1, 3, 5 Cartas)**:
  - `"¡Hola [Nombre]! Hemos recibido tu solicitud y confirmado tu pago para tu [Nombre del Servicio]."`
  - `"Claudia revisará tu consulta con total dedicación. Tu lectura detallada será enviada a este correo electrónico en un plazo máximo de 24 horas."`
  - `"Resumen de tu consulta: Categoría: [Categoría] | Pregunta: [Pregunta]"`
- **Body Content (Live Call Session)**:
  - `"¡Hola [Nombre]! Tu sesión de llamada en vivo ha quedado confirmada."`
  - `"Cita agendada: [Fecha] a las [Hora] (Hora del Centro de México)."`
  - `"Te recomendamos estar en un lugar tranquilo y con buena conexión 5 minutos antes de la hora acordada."`

---

### 5.4 Mexican Spanish FAQ Specifications

| # | Question (Pregunta) | Verified Mexican Spanish Answer (Respuesta) |
|---|---------------------|---------------------------------------------|
| 1 | **¿Cómo recibo mi lectura?** | Recibirás tu lectura directamente en tu correo electrónico en un documento detallado con la interpretación profunda de las cartas, su simbología y las respuestas a tu situación. |
| 2 | **¿Cuánto tarda en llegar la respuesta?** | Para todas las lecturas de cartas por mensaje (1, 3 y 5 cartas), garantizamos la entrega en un plazo máximo de 24 horas a partir de la confirmación de tu pago. |
| 3 | **¿Qué pasa si no puedo asistir a mi llamada agendada?** | Puedes reprogramar tu llamada avisando con al menos 4 horas de anticipación a través de nuestro correo de contacto, sujeto a los horarios disponibles en el calendario. |
| 4 | **¿Los pagos son seguros?** | Totalmente. Todos los pagos se procesan de manera cifrada y segura a través de Mercado Pago, permitiéndote pagar con tarjeta de crédito, débito, transferencia o efectivo en puntos autorizados. |
| 5 | **¿Puedo cambiar mi pregunta después de pagar?** | Una vez confirmado el pago, Claudia inicia la preparación energética de la consulta. Si necesitas hacer una corrección urgente, contáctanos dentro de las primeras 2 horas posteriores a tu pago. |

---

## 6. Caveats

1. **Email Delivery Provider Setup**: As highlighted in the specification, Claudia does not currently have an active domain inbox or production Resend sender key configured. The application must feature a pluggable notification architecture that logs cleanly to console/mock storage when running in sandbox/development mode without crashing the webhook handler.
2. **Mercado Pago Sandbox vs Production**: The preference creation and webhook handler must support both Mercado Pago Sandbox credentials (`TEST-...`) and Production credentials (`APP_USR-...`) seamlessly via environment variables (`MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`).
3. **Timezone Handling**: All call booking slots and timestamps should be explicitly handled in Mexico Central Time (`America/Mexico_City`, UTC-6) to ensure consistent scheduling for both Claudia and clients across different geographical timezones.

---

## 7. Conclusion

All requirements for the Lumina Umay booking and payment web application have been exhaustively identified, categorized, and structured:
- **4 Product Tiers**: 1 carta ($150 MXN), 3 cartas ($350 MXN), 5 cartas ($500 MXN), and Sesión por llamada ($450 MXN).
- **Dynamic Field & Validation Architecture**: Precise required vs optional fields per tier, birthdate format enforcement, and fixed category enum (`Amor`, `Trabajo/Dinero`, `Familia`, `Otro`).
- **Concurrency & Soft-Locking Engine**: Guaranteed race-condition immunity with atomic slot soft-locking, configurable TTL auto-release, and permanent lock upon payment.
- **Mercado Pago Webhook Security**: Zero trust on client-side redirects; strict order/booking confirmation exclusively driven by server-side verified `payment.status == 'approved'` webhooks with idempotency protection.
- **Notification & Communication System**: Full consultation context payload dispatched to Claudia and customer confirmation tailored to 24h async SLA or scheduled call time.
- **Design System & Mexican Spanish Localization**: Exact visual token preservation (`--teal`, `--teal-deep`, `--gold`, `--cream`, `Cormorant Garamond`, `Jost`), elimination of WhatsApp CTA, and inclusion of a 5-question interactive FAQ accordion in natural Mexican Spanish.

---

## 8. Verification Method

To verify the completeness and accuracy of this specification extraction:
1. **Spec Alignment Inspection**: Inspect `c:/LUMINAPROJECT/ORIGINAL_REQUEST.md` and `c:/LUMINAPROJECT/lumina-umay-booking-system-spec-v2.md` against Section 1 (Observation quotes) and Section 3 (Features Discovered table).
2. **Field Contract Validation**: Verify that 1 carta requires only name, DOB, question, category; 3 cartas adds optional involved person; 5 cartas adds optional involved person + mandatory core focus; and call requires slot selection.
3. **Concurrency Model Verification**: Verify Section 4 (Edge Cases #1-#4) against SQL atomic transaction rules (`UPDATE slots WHERE id=? AND status='AVAILABLE'`).
4. **Webhook Security Verification**: Verify Section 4 (Edge Cases #5-#6) against Mercado Pago API integration patterns ensuring `/checkout/success` does not update database state directly.
