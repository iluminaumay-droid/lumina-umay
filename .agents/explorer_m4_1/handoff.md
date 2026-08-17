# Frontend Client Architecture & Implementation Plan (Milestone 4)
**Project:** Lumina Umay Tarot Booking & Payment System  
**Author:** Frontend Technical Architect (`explorer_m4_1`)  
**Target Directory:** `src/client/`  
**Status:** COMPLETED (Hard Handoff)  

---

## 1. Observation

### 1.1 Direct Source References & Product Requirements

1. **Brand & Visual Guidelines** (`ORIGINAL_REQUEST.md`, lines 24–26):
   > "Preserve the exact visual design, color tokens (`--teal`, `--teal-deep`, `--gold`, `--cream`), Cormorant Garamond / Jost typography, and mobile-app shell experience from the original HTML. Replace the WhatsApp CTA with an interactive Mexican Spanish FAQ accordion."

2. **Product Tiers & Dynamic Fields** (`ORIGINAL_REQUEST.md`, lines 12–14, 29–33 & `spec-v2.md`, lines 22–44):
   - **Category A — Lecturas de cartas (asíncronas por mensaje/correo)**:
     - **1 carta ($150 MXN)**: Solo preguntas de sí o no. Fields: `Nombre`, `Fecha de nacimiento`, `Pregunta/Consulta`, `Categoría` (`Amor`, `Trabajo/Dinero`, `Familia`, `Otro`). Guarantee: respuesta en 24 horas.
     - **3 cartas ($350 MXN)**: Pregunta o situación general. Fields: `Nombre`, `Fecha de nacimiento`, `Pregunta/Situación`, `Nombre de la persona involucrada (si aplica)`, `Categoría`. Guarantee: respuesta en 24 horas.
     - **5 cartas ($500 MXN)**: Pregunta o situación más profunda. Fields: `Nombre`, `Fecha de nacimiento`, `Pregunta/Situación`, `Nombre de la(s) persona(s) involucrada(s) (si aplica)`, `¿Qué es lo que más deseas saber?` (enfoque prioritario requerido), `Categoría`. Guarantee: respuesta en 24 horas.
   - **Category B — Sesión por llamada ($450 MXN)**:
     - Sesión en vivo de 45 min por videollamada / llamada en horario reservado. Requiere selección de horario con control de concurrencia y soft-lock temporal de 15 minutos.

3. **Mexican Spanish Copywriting & Tone** (`spec-v2.md`, line 10):
   > "Site language: **Mexican Spanish** throughout (all copy, labels, buttons, confirmation messages, FAQ, emails)."

4. **FAQ Requirement (Replacing WhatsApp CTA)** (`spec-v2.md`, lines 13–14, 64–71 & `assertion-helpers.js`, lines 16–37):
   > "Remove: the WhatsApp contact link/CTA at the end of the flow... Add: a standard FAQ section in its place."
   > Mandatory core questions covering: delivery format ("¿Cómo recibo mi lectura?"), 24-hour turnaround ("¿Cuánto tarda en llegar la respuesta?"), rescheduling ("¿Qué pasa si no puedo asistir a mi llamada agendada?"), payment security ("¿Los pagos son seguros?"), and consultation question edits ("¿Puedo cambiar mi pregunta después de pagar?").

5. **Confirmation & Anti-Spoofing Protocol** (`ORIGINAL_REQUEST.md`, lines 44–45, 50 & `spec-v2.md`, lines 48–51):
   > "Client redirect to success page without verified webhook payment does not create an active order or confirmed booking."
   > "Customer sees a confirmation screen: for card readings, a 'responderemos en 24 horas' message; for calls, their confirmed date/time."

### 1.2 Backend API Contracts (`src/server/`)

- **Static File Serving** (`src/server/app.ts`, lines 37–38):
  ```ts
  const clientPath = path.join(process.cwd(), 'src', 'client');
  app.use(express.static(clientPath));
  ```
  Express directly serves files from `src/client/` at the root path (`/`, `/styles.css`, `/app.js`, etc.).

- **Slot Availability API** (`GET /api/slots` -> `src/server/routes/slots.routes.ts`):
  Response:
  ```json
  {
    "success": true,
    "slots": [
      {
        "id": "slot_uuid_123",
        "start_time": "2026-08-20T16:00:00.000Z",
        "end_time": "2026-08-20T16:45:00.000Z",
        "status": "AVAILABLE",
        "date": "2026-08-20",
        "time_start": "10:00",
        "time_end": "10:45"
      }
    ]
  }
  ```

- **Slot Lock API** (`POST /api/slots/:id/lock`):
  Success (200):
  ```json
  {
    "success": true,
    "message": "Horario apartado temporalmente por 15 minutos",
    "slot_id": "slot_uuid_123",
    "lock_token": "lock_uuid_abc",
    "expires_at": "2026-08-20T16:15:00.000Z"
  }
  ```
  Conflict (409):
  ```json
  {
    "success": false,
    "code": "SLOT_LOCK_CONFLICT",
    "error": "El horario seleccionado ya fue apartado por otra persona. Por favor elige otro horario."
  }
  ```

- **Slot Release API** (`POST /api/slots/:id/release`):
  Body: `{ "lock_token": "lock_uuid_abc" }`
  Response (200): `{ "success": true, "message": "Horario liberado exitosamente" }`

- **Checkout Preference Creation API** (`POST /api/checkout/create-preference`):
  Body:
  ```json
  {
    "tier_id": "1_carta" | "3_cartas" | "5_cartas" | "llamada",
    "category": "Amor" | "Trabajo/Dinero" | "Familia" | "Otro",
    "customer_name": "María Elena Garza",
    "customer_email": "maria@ejemplo.com",
    "customer_phone": "5512345678",
    "customer_birthdate": "1994-08-19",
    "question": "¿Encontraré pareja este año?",
    "involved_names": "Carlos Méndez",       // Optional for 3/5 cartas
    "core_focus": "Aspecto prioritario",    // Required for 5 cartas
    "slot_id": "slot_uuid_123",              // Required for llamada
    "lock_token": "lock_uuid_abc"            // Soft-lock token for llamada
  }
  ```
  Response (200):
  ```json
  {
    "success": true,
    "order_id": "ord_1771123456_a1b2c3d4",
    "preference_id": "pref_mp_123456",
    "init_point": "https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=...",
    "sandbox_init_point": "https://sandbox.mercadopago.com.mx/checkout/v1/redirect?pref_id=...",
    "amount": 150
  }
  ```

- **Order Status API** (`GET /api/orders/:order_id/status`):
  Response (200):
  ```json
  {
    "success": true,
    "order_id": "ord_1771123456_a1b2c3d4",
    "status": "PENDING" | "APPROVED" | "PAID" | "REJECTED" | "OVERBOOKED_NEEDS_RESCHEDULING",
    "tier_id": "1_carta",
    "tier_name": "Lectura de 1 Carta",
    "turnaround_message": "Responderemos en un plazo máximo de 24 horas a tu correo electrónico con tu lectura.",
    "slot": {
      "id": "slot_uuid_123",
      "date": "2026-08-20",
      "time_start": "10:00",
      "time_end": "10:45",
      "status": "BOOKED"
    },
    "amount": 150
  }
  ```

---

## 2. Logic Chain

### 2.1 Architecture Rationale: Vanilla Modern Web Standards (Dependency-Free)
1. **Zero-Build Deployment**:
   - The Express backend mounts `express.static('src/client')`.
   - By structuring the frontend as clean, standard HTML5, CSS3 (CSS Variables, Flexbox, CSS Grid), and modern ES6+ JavaScript (`async/await`, `fetch`, DOM APIs), the browser executes code natively without requiring Node bundling steps (Webpack/Vite/Rollup) or transpilation overhead.
   - Result: Instant load times, zero build fragility, 100% compatibility across Chrome, Safari, Firefox, Edge, and iOS/Android mobile browsers.

2. **File Structure**:
   ```
   src/client/
   ├── index.html              # Complete semantic HTML5 markup & app shell
   ├── styles.css              # Dark luxury theme, tokens, animations, responsive grid
   └── app.js                  # State machine, slot picker, validation, checkout & status polling
   ```

### 2.2 UI State Machine & Interaction Flow
1. **Initial Load**:
   - Sets default tier to `1_carta` ($150 MXN).
   - Renders Tier Cards with active styling on `1_carta`.
   - Dynamic form hides `involved_names`, `core_focus`, and `slot-picker-section`.
   - Inspects URL query params: If `order_id` is present (e.g. user redirected back from Mercado Pago), activates Post-Payment Confirmation View and starts status polling.

2. **Tier Selection Transition**:
   - When a user selects a tier:
     - `1_carta` ($150 MXN): Hides `involved_names`, `core_focus`, `slot-picker-section`. Form question placeholder: *"Escribe tu pregunta de Sí o No con claridad..."*. Button text: *"Proceder al Pago Seguro ($150 MXN)"*.
     - `3_cartas` ($350 MXN): Shows `involved_names` ("Nombre de la persona involucrada (si aplica)"). Hides `core_focus` and `slot-picker-section`. Form question placeholder: *"Describe la situación o pregunta general que deseas consultar..."*. Button text: *"Proceder al Pago Seguro ($350 MXN)"*.
     - `5_cartas` ($500 MXN): Shows `involved_names` and `core_focus` ("¿Qué es lo que más deseas saber / descubrir? *"). Hides `slot-picker-section`. Form question placeholder: *"Explica a detalle tu situación, antecedentes y aspectos a profundizar..."*. Button text: *"Proceder al Pago Seguro ($500 MXN)"*.
     - `llamada` ($450 MXN): Hides `involved_names` and `core_focus`. Shows `slot-picker-section`. Triggers `fetchAvailableSlots()`. Button text: *"Proceder al Pago Seguro ($450 MXN)"*.
   - If switching away from `llamada` while a soft-lock is held, automatically dispatches `POST /api/slots/:id/release` to cleanly free the slot for other users.

3. **Slot Selection & Soft-Lock Hold Timer**:
   - `fetchAvailableSlots()` groups slots by `slot.date` (CDMX time).
   - Renders horizontal scrollable date pills (e.g., "Jue 20 Ago", "Vie 21 Ago").
   - Clicking a date renders available time chips (e.g., "10:00 AM", "11:30 AM", "04:00 PM").
   - Clicking a slot time chip:
     - If another slot was previously locked, releases old slot lock.
     - Calls `POST /api/slots/:id/lock`.
     - On HTTP 200: Stores `slot_id`, `lock_token`, `expires_at`. Starts 15-minute countdown ticker in `#slot-lock-banner` (*"⏱️ Horario apartado por 14:59 minutos"*).
     - On HTTP 409: Displays an inline conflict alert (*"El horario seleccionado ya fue apartado por otra persona. Por favor elige otro horario."*) and re-fetches slots.
   - If countdown reaches 00:00: Resets lock, displays expiration alert, and prompts the user to re-select a slot.

4. **Client-Side Form Validation**:
   - Strictly mirrors server-side validation in `checkout.validator.ts`:
     - `customer_name`: Non-empty, min length 2.
     - `customer_email`: Valid email format (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`).
     - `customer_birthdate`: Valid YYYY-MM-DD, strict Gregorian check, year >= 1900, strictly in past.
     - `category`: Must be selected from `['Amor', 'Trabajo/Dinero', 'Familia', 'Otro']`.
     - `question`: Non-empty, trimmed.
     - `core_focus`: Required when tier is `5_cartas`.
     - `slot_id`: Required when tier is `llamada`.
   - On error: Highlights invalid field in red (`--error`), shows inline error label in Mexican Spanish, scrolls smoothly to first invalid field.

5. **Checkout Submission & Mercado Pago Redirection**:
   - On valid submit:
     - Disables submit button and shows golden spinner.
     - Submits payload to `POST /api/checkout/create-preference`.
     - Saves `{ order_id, tier_id, customer_name, customer_email }` into `sessionStorage`.
     - On HTTP 200: Redirects user to `res.data.init_point || res.data.sandbox_init_point`.
     - On error: Renders friendly error banner at top of form.

6. **Post-Payment Verification & Dual Confirmation Screens**:
   - When returning to the site with `order_id` in URL:
     - Hides booking form, presents confirmation view.
     - Displays polling spinner: *"Verificando confirmación de pago con Mercado Pago..."*
     - Polls `GET /api/orders/:order_id/status` every 2.5 seconds (max 30 attempts).
     - When `status === 'APPROVED'` or `'PAID'`:
       - For Category A (1, 3, 5 cartas): Renders 24-hour turnaround SLA guarantee banner (*"⏰ Claudia responderá en un plazo máximo de 24 horas a tu correo electrónico con tu lectura e interpretación detallada."*), Order ID, and consultation summary.
       - For Category B (Llamada): Renders confirmed appointment date & time (CDMX), Google Meet session notice, and preparation tips (*"Conéctate 5 minutos antes desde un lugar tranquilo..."*).
     - When `status === 'OVERBOOKED_NEEDS_RESCHEDULING'`:
       - Renders rescheduling advisory notice: *"Tu pago fue recibido pero el horario seleccionado expiró y fue reservado por otro consultante. Claudia se pondrá en contacto contigo para reprogramar tu sesión."*

7. **Mexican Spanish FAQ Accordion**:
   - 7 curated accordion questions answering delivery timing, call logistics, rescheduling (4-hour notice), Mercado Pago SSL security, question edits, topic ethics, and data confidentiality.
   - Uses semantic `<details>` and `<summary>` elements with custom CSS chevron animation, accessible out of the box with zero JavaScript dependency.

---

## 3. Caveats & Edge Cases

1. **WhatsApp Contact Absence**:
   - The WhatsApp CTA button is removed and replaced by the FAQ accordion. Phone/WhatsApp input is collected in the form as an optional/backup channel for delivery alerts.

2. **Timezone Standardization (CDMX UTC-6)**:
   - The backend computes and formats slot dates and times in Mexico City time (`America/Mexico_City`). The frontend slot picker and confirmation screens display these exact strings to ensure consistency across all user devices.

3. **Zero-Trust Client Redirects**:
   - The confirmation screen NEVER assumes payment is approved just because the user was redirected back from Mercado Pago. It strictly polls `/api/orders/:order_id/status` until the server-side webhook verifies `payment.status === 'approved'`.

4. **15-Minute Soft Lock TTL**:
   - If a user opens checkout, locks a slot, and abandons the page, the 15-minute countdown will cleanly expire on both client and server, returning the slot to available status.

---

## 4. Conclusion & Complete File Specifications

### 4.1 Detailed Specification for `src/client/index.html`

The complete semantic HTML5 file must include:
1. **Head & Metadata**:
   - UTF-8 charset, responsive viewport, title: `Lumina Umay — Tarot Terapéutico & Guía Espiritual`.
   - Google Fonts preconnect and stylesheet link for `Cormorant Garamond` (400, 600, 700) and `Jost` (300, 400, 500, 600, 700).
   - Stylesheet link: `<link rel="stylesheet" href="/styles.css">`.
2. **Body & Mobile Shell Container (`#app-shell`)**:
   - **Header / Hero Section**:
     - Brand mark (✨ celestial icon), Logo heading `LUMINA UMAY`, Subtitle `Tarot Terapéutico & Guía Espiritual`.
     - Hero tagline in Mexican Spanish.
   - **Step 1: Tier Selection Section (`#tier-selection`)**:
     - Section title: `1. Elige tu Lectura o Sesión`.
     - 4 interactive radio cards:
       - `1_carta` ($150 MXN) — "1 Carta: Sí o No" (Badge: 24 Horas)
       - `3_cartas` ($350 MXN) — "3 Cartas: Panorama General" (Badge: 24 Horas)
       - `5_cartas` ($500 MXN) — "5 Cartas: Tirada Profunda" (Badge: 24 Horas)
       - `llamada` ($450 MXN) — "Sesión en Vivo 1:1" (Badge: Videollamada 45 min)
   - **Step 2: Dynamic Form Section (`#booking-form-section`)**:
     - Section title: `2. Tus Datos & Consulta`.
     - Global error banner `#form-error-banner` (hidden).
     - Form `<form id="booking-form" novalidate>`:
       - `customer_name`: Input text, required.
       - `customer_email`: Input email, required.
       - `customer_phone`: Input tel, optional.
       - `customer_birthdate`: Input date (YYYY-MM-DD), required.
       - `category`: Select dropdown (`Amor`, `Trabajo/Dinero`, `Familia`, `Otro`), required.
       - `#field-involved-names` (wrapper, hidden by default): Input text `involved_names`.
       - `#field-core-focus` (wrapper, hidden by default): Textarea `core_focus`.
       - `question`: Textarea, required.
       - `#slot-picker-section` (wrapper, hidden by default):
         - Subtitle: `Selecciona tu Fecha y Horario (Hora CDMX)`.
         - `#slot-lock-banner` (hidden until locked): Hold timer badge.
         - `#slot-dates-container`: Horizontal scrollable date pills.
         - `#slot-times-grid`: Time slot buttons.
         - `#slot-empty-msg` & `#slot-loading-spinner`.
         - Hidden inputs: `#slot_id` and `#lock_token`.
       - `#order-summary-card`: Dynamic summary displaying selected tier name, price, and turnaround pledge.
       - Submit button `#submit-btn` with `.btn-text` and `.spinner`.
       - Security footnote: `🔒 Pago procesado de forma 100% segura con Mercado Pago y cifrado SSL bancario.`
   - **Step 3: Mexican Spanish FAQ Section (`#faq-section`)**:
     - Section title: `Preguntas Frecuentes`.
     - Subtitle: `Todo lo que necesitas saber sobre tu consulta con Claudia`.
     - 7 `<details class="faq-item">` accordions:
       1. "¿Cómo recibo mi lectura?"
       2. "¿Cuánto tarda en llegar la respuesta?"
       3. "¿Qué pasa si no puedo asistir a mi llamada agendada?"
       4. "¿Los pagos son seguros?"
       5. "¿Puedo cambiar mi pregunta después de pagar?"
       6. "¿Qué tipo de preguntas puedo realizar?"
       7. "¿Mis datos y lecturas son confidenciales?"
   - **Footer Section**:
     - Copyright `© 2026 Lumina Umay. Todos los derechos reservados.`
     - Spiritual guidance disclaimer and accepted payment logos.
   - **Post-Payment Confirmation Modal (`#confirmation-modal`)**:
     - Fixed backdrop overlay (hidden by default).
     - Modal content card containing:
       - Status icon & title.
       - Polling spinner (`#confirmation-polling`).
       - Order details card (`#confirmation-details`).
       - Turnaround SLA banner (`#confirmation-turnaround`).
       - Call appointment details card (`#confirmation-appointment`).
       - Action buttons: "Volver al Inicio" (`#btn-back-home`).
3. **Script tag**: `<script src="/app.js" defer></script>`.

---

### 4.2 Detailed Specification for `src/client/styles.css`

The stylesheet must define:
1. **CSS Custom Properties (Design Tokens)**:
   ```css
   :root {
     --teal-deep: #081d1c;
     --teal: #0d2b2a;
     --teal-card: #133938;
     --teal-card-hover: #194846;
     --teal-border: #1d4d4b;
     --teal-input: #0a2221;
     --teal-glow: rgba(13, 43, 42, 0.85);

     --gold: #d4af37;
     --gold-light: #f3e5ab;
     --gold-dark: #aa8c2c;
     --gold-muted: rgba(212, 175, 55, 0.18);
     --gold-border: rgba(212, 175, 55, 0.4);
     --gold-glow: rgba(212, 175, 55, 0.35);

     --cream: #fbf8f2;
     --cream-muted: #dcd3c1;
     --cream-subtle: #9fa8a3;
     --white: #ffffff;

     --error: #ef5350;
     --error-bg: rgba(239, 83, 80, 0.12);
     --error-border: rgba(239, 83, 80, 0.4);
     --success: #66bb6a;
     --success-bg: rgba(102, 187, 106, 0.12);
     --success-border: rgba(102, 187, 106, 0.4);

     --font-serif: 'Cormorant Garamond', Georgia, serif;
     --font-sans: 'Jost', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;

     --radius-sm: 8px;
     --radius-md: 14px;
     --radius-lg: 20px;
     --radius-full: 9999px;

     --shadow-card: 0 10px 30px -5px rgba(0, 0, 0, 0.5), 0 0 20px rgba(212, 175, 55, 0.08);
     --shadow-gold: 0 4px 20px rgba(212, 175, 55, 0.3);
     --shadow-input: inset 0 2px 4px rgba(0, 0, 0, 0.3);

     --transition: 0.25s cubic-bezier(0.4, 0, 0.2, 1);
   }
   ```
2. **Global & Mobile Shell**:
   - `body`: Background gradient from `--teal-deep` to `--teal`, color `--cream`, font `--font-sans`, min-height 100vh, margin 0.
   - `#app-shell`: Max width 520px, margin `0 auto`, padding `24px 16px 48px`, box-sizing `border-box`.
3. **Typography**:
   - Headings (`h1, h2, h3, .brand-title, .tier-price, .section-title`): Font `--font-serif`, letter-spacing 1px, gold accents.
   - Body & Form labels: Font `--font-sans`, crisp contrast, legible font sizing (14px–16px).
4. **Tier Cards**:
   - Radio card styling: border 1px solid `--teal-border`, background `--teal-card`, border-radius `--radius-md`, padding 16px.
   - Active/Selected state: border 2px solid `--gold`, background `linear-gradient(135deg, #133938 0%, #194846 100%)`, box-shadow `--shadow-gold`.
   - Price badge: Font `--font-serif`, font-size 22px, font-weight 700, color `--gold`.
5. **Form Controls**:
   - Inputs, selects, textareas: background `--teal-input`, border 1px solid `--teal-border`, color `--cream`, border-radius `--radius-sm`, padding 12px 14px, font-size 15px.
   - Focus state: border-color `--gold`, box-shadow `0 0 0 3px var(--gold-muted)`, outline none.
   - Error state: border-color `--error`, box-shadow `0 0 0 3px var(--error-bg)`.
   - Inline error label: font-size 12px, color `--error`, margin-top 4px.
6. **Slot Calendar & Grid**:
   - Date container: display flex, gap 8px, overflow-x auto, scrollbar-width thin.
   - Date pill: padding 8px 14px, border-radius `--radius-sm`, border 1px solid `--teal-border`, cursor pointer. Active: background `--gold`, color `--teal-deep`, font-weight 600.
   - Slot grid: display grid, grid-template-columns repeat(auto-fill, minmax(100px, 1fr)), gap 10px.
   - Slot button: padding 10px, border-radius `--radius-sm`, border 1px solid `--teal-border`, background `--teal-card`, color `--cream`.
   - Active slot: background `--gold`, color `--teal-deep`, font-weight 600, border-color `--gold`.
   - Lock banner: background `--gold-muted`, border 1px solid `--gold-border`, border-radius `--radius-sm`, padding 10px 14px, color `--gold-light`, font-size 13px, display flex, align-items center, gap 8px.
7. **FAQ Accordion**:
   - `<details>`: background `--teal-card`, border 1px solid `--teal-border`, border-radius `--radius-md`, margin-bottom 12px, overflow hidden, transition `--transition`.
   - `<summary>`: padding 16px 18px, font-family `--font-serif`, font-size 17px, font-weight 600, color `--cream`, cursor pointer, list-style none, display flex, justify-content space-between, align-items center.
   - SVG Chevron rotation: `details[open] .faq-chevron { transform: rotate(180deg); }`.
   - Answer content: padding `0 18px 18px`, font-size 14px, color `--cream-muted`, line-height 1.6.
8. **Primary Buttons & Spinners**:
   - `.btn-primary`: width 100%, padding 16px, background `linear-gradient(135deg, var(--gold) 0%, var(--gold-dark) 100%)`, color `--teal-deep`, font-family `--font-sans`, font-size 16px, font-weight 700, letter-spacing 1px, border none, border-radius `--radius-md`, cursor pointer, box-shadow `--shadow-gold`, transition `--transition`.
   - Loading spinner: CSS border-ring animation with `--gold` accent.
9. **Confirmation Modal**:
   - Fixed overlay (`position: fixed; inset: 0; background: rgba(8, 29, 28, 0.85); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 1000;`).
   - Modal card: max-width 480px, width 90%, max-height 90vh, overflow-y auto, background `--teal-card`, border 1px solid `--gold-border`, border-radius `--radius-lg`, padding 28px, box-shadow `--shadow-card`.

---

### 4.3 Detailed Specification for `src/client/app.js`

The client script must implement the complete interactive state engine:

```javascript
/**
 * Lumina Umay — Frontend Client State & Booking Engine
 */

(function () {
  'use strict';

  // --- Constants & Config ---
  const TIER_PRICES = {
    '1_carta': { name: 'Lectura de 1 Carta', price: 150, isCall: false },
    '3_cartas': { name: 'Lectura de 3 Cartas', price: 350, isCall: false },
    '5_cartas': { name: 'Lectura de 5 Cartas', price: 500, isCall: false },
    'llamada': { name: 'Sesión por Llamada', price: 450, isCall: true },
  };

  // --- Application State ---
  const state = {
    selectedTier: '1_carta',
    selectedSlotId: null,
    lockToken: null,
    lockExpiresAt: null,
    lockTimerInterval: null,
    slots: [],
    groupedSlots: {},
    selectedDate: null,
    isSubmitting: false,
    pollInterval: null,
  };

  // --- DOM Elements Cache ---
  const DOM = {
    form: document.getElementById('booking-form'),
    tierRadios: document.querySelectorAll('input[name="tier_id"]'),
    tierCards: document.querySelectorAll('.tier-card'),
    fieldInvolvedNames: document.getElementById('field-involved-names'),
    fieldCoreFocus: document.getElementById('field-core-focus'),
    slotPickerSection: document.getElementById('slot-picker-section'),
    slotDatesContainer: document.getElementById('slot-dates-container'),
    slotTimesGrid: document.getElementById('slot-times-grid'),
    slotLoading: document.getElementById('slot-loading-spinner'),
    slotEmptyMsg: document.getElementById('slot-empty-msg'),
    slotLockBanner: document.getElementById('slot-lock-banner'),
    slotLockTimerText: document.getElementById('slot-lock-timer-text'),
    slotIdInput: document.getElementById('slot_id'),
    lockTokenInput: document.getElementById('lock_token'),
    questionInput: document.getElementById('question'),
    questionLabel: document.getElementById('question-label'),
    summaryTierName: document.getElementById('summary-tier-name'),
    summaryPrice: document.getElementById('summary-price'),
    summaryTurnaround: document.getElementById('summary-turnaround'),
    submitBtn: document.getElementById('submit-btn'),
    submitBtnText: document.getElementById('submit-btn-text'),
    submitSpinner: document.getElementById('submit-spinner'),
    formErrorBanner: document.getElementById('form-error-banner'),
    formErrorText: document.getElementById('form-error-text'),

    // Confirmation Modal
    confirmationModal: document.getElementById('confirmation-modal'),
    confirmSpinner: document.getElementById('confirm-spinner'),
    confirmSuccessBox: document.getElementById('confirm-success-box'),
    confirmOrderId: document.getElementById('confirm-order-id'),
    confirmTierName: document.getElementById('confirm-tier-name'),
    confirmTurnaroundMsg: document.getElementById('confirm-turnaround-msg'),
    confirmSlotDetails: document.getElementById('confirm-slot-details'),
    confirmSlotDate: document.getElementById('confirm-slot-date'),
    confirmSlotTime: document.getElementById('confirm-slot-time'),
    btnBackHome: document.getElementById('btn-back-home'),
  };

  // --- Initialization ---
  function init() {
    bindEvents();
    checkUrlForOrderConfirmation();
    updateTierUI(state.selectedTier);
  }

  // --- Event Bindings ---
  function bindEvents() {
    // Tier Card selection
    DOM.tierRadios.forEach((radio) => {
      radio.addEventListener('change', (e) => {
        handleTierChange(e.target.value);
      });
    });

    // Tier card click helper
    DOM.tierCards.forEach((card) => {
      card.addEventListener('click', () => {
        const radio = card.querySelector('input[type="radio"]');
        if (radio && !radio.checked) {
          radio.checked = true;
          handleTierChange(radio.value);
        }
      });
    });

    // Form submit
    DOM.form.addEventListener('submit', handleFormSubmit);

    // Back to home from confirmation modal
    if (DOM.btnBackHome) {
      DOM.btnBackHome.addEventListener('click', () => {
        DOM.confirmationModal.classList.add('hidden');
        window.history.replaceState({}, document.title, window.location.pathname);
      });
    }
  }

  // --- Tier Switching Logic ---
  function handleTierChange(newTier) {
    if (state.selectedTier === 'llamada' && newTier !== 'llamada' && state.selectedSlotId && state.lockToken) {
      // Release held lock
      releaseCurrentSlotLock(state.selectedSlotId, state.lockToken);
      clearSlotLockState();
    }

    state.selectedTier = newTier;
    updateTierUI(newTier);

    if (newTier === 'llamada') {
      fetchAvailableSlots();
    }
  }

  function updateTierUI(tier) {
    const tierInfo = TIER_PRICES[tier] || TIER_PRICES['1_carta'];

    // Update active class on cards
    DOM.tierCards.forEach((card) => {
      const radio = card.querySelector('input[type="radio"]');
      if (radio && radio.value === tier) {
        card.classList.add('active');
      } else {
        card.classList.remove('active');
      }
    });

    // Dynamic field visibility
    if (tier === '1_carta') {
      DOM.fieldInvolvedNames.classList.add('hidden');
      DOM.fieldCoreFocus.classList.add('hidden');
      DOM.slotPickerSection.classList.add('hidden');
      DOM.questionLabel.textContent = 'Tu Pregunta o Consulta (Sí o No) *';
      DOM.questionInput.placeholder = 'Ej. ¿Conseguiré el empleo al que apliqué este mes?';
      DOM.summaryTurnaround.textContent = '⏰ Garantía: Respuesta en menos de 24 horas por correo';
    } else if (tier === '3_cartas') {
      DOM.fieldInvolvedNames.classList.remove('hidden');
      DOM.fieldCoreFocus.classList.add('hidden');
      DOM.slotPickerSection.classList.add('hidden');
      DOM.questionLabel.textContent = 'Tu Pregunta o Situación General *';
      DOM.questionInput.placeholder = 'Explica la situación o duda general que deseas consultar...';
      DOM.summaryTurnaround.textContent = '⏰ Garantía: Respuesta en menos de 24 horas por correo con audio';
    } else if (tier === '5_cartas') {
      DOM.fieldInvolvedNames.classList.remove('hidden');
      DOM.fieldCoreFocus.classList.remove('hidden');
      DOM.slotPickerSection.classList.add('hidden');
      DOM.questionLabel.textContent = 'Tu Situación o Consulta Detallada *';
      DOM.questionInput.placeholder = 'Explica a detalle tu situación, antecedentes y el contexto general...';
      DOM.summaryTurnaround.textContent = '⏰ Garantía: Respuesta en menos de 24 horas con análisis profundo';
    } else if (tier === 'llamada') {
      DOM.fieldInvolvedNames.classList.add('hidden');
      DOM.fieldCoreFocus.classList.add('hidden');
      DOM.slotPickerSection.classList.remove('hidden');
      DOM.questionLabel.textContent = 'Tema o Enfoque Principal para tu Llamada *';
      DOM.questionInput.placeholder = 'Describe brevemente los temas que deseas abordar durante tu sesión...';
      DOM.summaryTurnaround.textContent = '📞 Sesión en vivo reservada en el horario seleccionado';
    }

    // Update Summary & CTA
    DOM.summaryTierName.textContent = tierInfo.name;
    DOM.summaryPrice.textContent = `$${tierInfo.price} MXN`;
    DOM.submitBtnText.textContent = `Proceder al Pago Seguro ($${tierInfo.price} MXN)`;
  }

  // --- Slots & Concurrency Engine ---
  async function fetchAvailableSlots() {
    DOM.slotLoading.classList.remove('hidden');
    DOM.slotEmptyMsg.classList.add('hidden');
    DOM.slotDatesContainer.innerHTML = '';
    DOM.slotTimesGrid.innerHTML = '';

    try {
      const response = await fetch('/api/slots');
      const data = await response.json();

      DOM.slotLoading.classList.add('hidden');

      if (!data.success || !data.slots || data.slots.length === 0) {
        DOM.slotEmptyMsg.classList.remove('hidden');
        return;
      }

      // Group slots by date
      state.slots = data.slots;
      state.groupedSlots = {};
      data.slots.forEach((slot) => {
        const d = slot.date || slot.start_time.slice(0, 10);
        if (!state.groupedSlots[d]) {
          state.groupedSlots[d] = [];
        }
        state.groupedSlots[d].push(slot);
      });

      const dates = Object.keys(state.groupedSlots).sort();
      if (dates.length === 0) {
        DOM.slotEmptyMsg.classList.remove('hidden');
        return;
      }

      state.selectedDate = dates[0];
      renderDatePills(dates);
      renderSlotTimes(state.selectedDate);
    } catch (err) {
      DOM.slotLoading.classList.add('hidden');
      DOM.slotEmptyMsg.textContent = 'Error al cargar horarios disponibles. Intenta nuevamente.';
      DOM.slotEmptyMsg.classList.remove('hidden');
    }
  }

  function renderDatePills(dates) {
    DOM.slotDatesContainer.innerHTML = '';
    dates.forEach((dateStr) => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = `date-pill ${dateStr === state.selectedDate ? 'active' : ''}`;
      pill.textContent = formatDateLabel(dateStr);
      pill.addEventListener('click', () => {
        state.selectedDate = dateStr;
        document.querySelectorAll('.date-pill').forEach((p) => p.classList.remove('active'));
        pill.classList.add('active');
        renderSlotTimes(dateStr);
      });
      DOM.slotDatesContainer.appendChild(pill);
    });
  }

  function renderSlotTimes(dateStr) {
    DOM.slotTimesGrid.innerHTML = '';
    const daySlots = state.groupedSlots[dateStr] || [];

    if (daySlots.length === 0) {
      DOM.slotTimesGrid.innerHTML = '<p class="text-muted">No hay horarios para este día.</p>';
      return;
    }

    daySlots.forEach((slot) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `slot-btn ${slot.id === state.selectedSlotId ? 'active' : ''}`;
      btn.textContent = `${slot.time_start} hrs`;
      btn.addEventListener('click', () => handleSlotClick(slot.id));
      DOM.slotTimesGrid.appendChild(btn);
    });
  }

  function formatDateLabel(dateStr) {
    const parts = dateStr.split('-');
    const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`;
  }

  async function handleSlotClick(slotId) {
    if (state.selectedSlotId === slotId) return;

    // Release previous lock if any
    if (state.selectedSlotId && state.lockToken) {
      releaseCurrentSlotLock(state.selectedSlotId, state.lockToken);
    }

    try {
      const res = await fetch(`/api/slots/${slotId}/lock`, { method: 'POST' });
      const data = await res.json();

      if (!res.ok || !data.success) {
        showFormError(data.error || 'El horario seleccionado ya no está disponible.');
        fetchAvailableSlots();
        return;
      }

      // Lock acquired successfully
      state.selectedSlotId = slotId;
      state.lockToken = data.lock_token;
      state.lockExpiresAt = new Date(data.expires_at).getTime();

      DOM.slotIdInput.value = slotId;
      DOM.lockTokenInput.value = data.lock_token;

      // Update UI active slot
      document.querySelectorAll('.slot-btn').forEach((b) => b.classList.remove('active'));
      const activeBtn = Array.from(document.querySelectorAll('.slot-btn')).find((b) => b.textContent.includes(data.slot_id));
      renderSlotTimes(state.selectedDate);

      startLockCountdown();
      hideFormError();
    } catch (err) {
      showFormError('No fue posible apartar el horario. Por favor intenta de nuevo.');
    }
  }

  function startLockCountdown() {
    if (state.lockTimerInterval) clearInterval(state.lockTimerInterval);
    DOM.slotLockBanner.classList.remove('hidden');

    function update() {
      const now = Date.now();
      const remainingMs = state.lockExpiresAt - now;

      if (remainingMs <= 0) {
        clearInterval(state.lockTimerInterval);
        clearSlotLockState();
        showFormError('El tiempo de apartado de tu horario ha expirado. Por favor selecciona un nuevo horario.');
        fetchAvailableSlots();
        return;
      }

      const totalSec = Math.floor(remainingMs / 1000);
      const min = Math.floor(totalSec / 60);
      const sec = totalSec % 60;
      DOM.slotLockTimerText.textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }

    update();
    state.lockTimerInterval = setInterval(update, 1000);
  }

  function clearSlotLockState() {
    if (state.lockTimerInterval) clearInterval(state.lockTimerInterval);
    state.selectedSlotId = null;
    state.lockToken = null;
    state.lockExpiresAt = null;
    DOM.slotIdInput.value = '';
    DOM.lockTokenInput.value = '';
    DOM.slotLockBanner.classList.add('hidden');
    renderSlotTimes(state.selectedDate);
  }

  async function releaseCurrentSlotLock(slotId, lockToken) {
    try {
      await fetch(`/api/slots/${slotId}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lock_token: lockToken }),
      });
    } catch (e) {
      // Best-effort release
    }
  }

  // --- Form Validation ---
  function validateForm() {
    hideFormErrors();
    let isValid = true;
    let firstInvalidElem = null;

    function markError(id, msg) {
      const elem = document.getElementById(id);
      const errElem = document.getElementById(`${id}-error`);
      if (elem) elem.classList.add('input-error');
      if (errElem) {
        errElem.textContent = msg;
        errElem.classList.remove('hidden');
      }
      if (!firstInvalidElem && elem) firstInvalidElem = elem;
      isValid = false;
    }

    const name = document.getElementById('customer_name').value.trim();
    if (name.length < 2) {
      markError('customer_name', 'Por favor ingresa tu nombre completo (mínimo 2 letras).');
    }

    const email = document.getElementById('customer_email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      markError('customer_email', 'Ingresa un correo electrónico válido para recibir tu lectura.');
    }

    const birthdate = document.getElementById('customer_birthdate').value.trim();
    if (!isValidBirthdate(birthdate)) {
      markError('customer_birthdate', 'Ingresa una fecha de nacimiento válida en el pasado (AAAA-MM-DD).');
    }

    const category = document.getElementById('category').value;
    if (!category || !['Amor', 'Trabajo/Dinero', 'Familia', 'Otro'].includes(category)) {
      markError('category', 'Por favor selecciona el área de tu consulta.');
    }

    const question = document.getElementById('question').value.trim();
    if (question.length < 1) {
      markError('question', 'Por favor ingresa tu pregunta o consulta.');
    }

    if (state.selectedTier === '5_cartas') {
      const coreFocus = document.getElementById('core_focus').value.trim();
      if (coreFocus.length < 1) {
        markError('core_focus', 'Por favor especifica qué es lo que más deseas saber.');
      }
    }

    if (state.selectedTier === 'llamada') {
      if (!state.selectedSlotId || !state.lockToken) {
        showFormError('Por favor selecciona y aparta un horario disponible para tu llamada.');
        if (!firstInvalidElem) firstInvalidElem = DOM.slotPickerSection;
        isValid = false;
      }
    }

    if (firstInvalidElem) {
      firstInvalidElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (typeof firstInvalidElem.focus === 'function') firstInvalidElem.focus();
    }

    return isValid;
  }

  function isValidBirthdate(dateStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
    const [y, m, d] = dateStr.split('-').map(Number);
    if (y < 1900 || m < 1 || m > 12 || d < 1 || d > 31) return false;
    const dateObj = new Date(Date.UTC(y, m - 1, d));
    if (dateObj.getUTCFullYear() !== y || dateObj.getUTCMonth() !== m - 1 || dateObj.getUTCDate() !== d) return false;
    return dateObj.getTime() < Date.now();
  }

  function hideFormErrors() {
    document.querySelectorAll('.input-error').forEach((el) => el.classList.remove('input-error'));
    document.querySelectorAll('.error-label').forEach((el) => el.classList.add('hidden'));
    hideFormError();
  }

  function showFormError(msg) {
    DOM.formErrorText.textContent = msg;
    DOM.formErrorBanner.classList.remove('hidden');
    DOM.formErrorBanner.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function hideFormError() {
    DOM.formErrorBanner.classList.add('hidden');
  }

  // --- Form Submission & Checkout Redirection ---
  async function handleFormSubmit(e) {
    e.preventDefault();
    if (state.isSubmitting) return;

    if (!validateForm()) return;

    state.isSubmitting = true;
    DOM.submitBtn.disabled = true;
    DOM.submitBtnText.classList.add('hidden');
    DOM.submitSpinner.classList.remove('hidden');

    const payload = {
      tier_id: state.selectedTier,
      category: document.getElementById('category').value,
      customer_name: document.getElementById('customer_name').value.trim(),
      customer_email: document.getElementById('customer_email').value.trim(),
      customer_phone: document.getElementById('customer_phone').value.trim() || undefined,
      customer_birthdate: document.getElementById('customer_birthdate').value.trim(),
      question: document.getElementById('question').value.trim(),
    };

    if (state.selectedTier === '3_cartas' || state.selectedTier === '5_cartas') {
      const inv = document.getElementById('involved_names').value.trim();
      if (inv) payload.involved_names = inv;
    }

    if (state.selectedTier === '5_cartas') {
      payload.core_focus = document.getElementById('core_focus').value.trim();
    }

    if (state.selectedTier === 'llamada') {
      payload.slot_id = state.selectedSlotId;
      payload.lock_token = state.lockToken;
    }

    try {
      const res = await fetch('/api/checkout/create-preference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        showFormError(data.error || 'Ocurrió un error al procesar tu solicitud.');
        state.isSubmitting = false;
        DOM.submitBtn.disabled = false;
        DOM.submitBtnText.classList.remove('hidden');
        DOM.submitSpinner.classList.add('hidden');
        return;
      }

      // Save order id in sessionStorage
      sessionStorage.setItem('last_order_id', data.order_id);

      // Redirect to Mercado Pago
      const redirectUrl = data.init_point || data.sandbox_init_point;
      window.location.href = redirectUrl;
    } catch (err) {
      showFormError('Error de conexión con el servidor de pagos. Por favor intenta de nuevo.');
      state.isSubmitting = false;
      DOM.submitBtn.disabled = false;
      DOM.submitBtnText.classList.remove('hidden');
      DOM.submitSpinner.classList.add('hidden');
    }
  }

  // --- Post-Payment Status Polling ---
  function checkUrlForOrderConfirmation() {
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get('order_id') || params.get('external_reference') || sessionStorage.getItem('last_order_id');

    if (orderId && (params.get('status') || params.get('payment_id') || params.get('collection_status') || params.get('order_id'))) {
      openConfirmationModal(orderId);
    }
  }

  function openConfirmationModal(orderId) {
    DOM.confirmationModal.classList.remove('hidden');
    DOM.confirmSpinner.classList.remove('hidden');
    DOM.confirmSuccessBox.classList.add('hidden');

    let attempts = 0;
    const maxAttempts = 30;

    async function pollStatus() {
      attempts++;
      try {
        const res = await fetch(`/api/orders/${orderId}/status`);
        const data = await res.json();

        if (res.ok && data.success) {
          const status = (data.status || '').toUpperCase();

          if (status === 'APPROVED' || status === 'PAID') {
            clearInterval(state.pollInterval);
            renderConfirmationSuccess(data);
            return;
          }

          if (status === 'OVERBOOKED_NEEDS_RESCHEDULING') {
            clearInterval(state.pollInterval);
            renderConfirmationOverbooked(data);
            return;
          }
        }
      } catch (err) {
        // Continue polling
      }

      if (attempts >= maxAttempts) {
        clearInterval(state.pollInterval);
        renderConfirmationPendingFallback(orderId);
      }
    }

    pollStatus();
    state.pollInterval = setInterval(pollStatus, 2500);
  }

  function renderConfirmationSuccess(orderData) {
    DOM.confirmSpinner.classList.add('hidden');
    DOM.confirmSuccessBox.classList.remove('hidden');

    DOM.confirmOrderId.textContent = `#${orderData.order_id}`;
    DOM.confirmTierName.textContent = orderData.tier_name || 'Lectura Confirmada';
    DOM.confirmTurnaroundMsg.textContent = orderData.turnaround_message;

    if (orderData.slot && orderData.slot.date) {
      DOM.confirmSlotDetails.classList.remove('hidden');
      DOM.confirmSlotDate.textContent = orderData.slot.date;
      DOM.confirmSlotTime.textContent = `${orderData.slot.time_start} - ${orderData.slot.time_end} hrs (Hora CDMX)`;
    } else {
      DOM.confirmSlotDetails.classList.add('hidden');
    }
  }

  function renderConfirmationOverbooked(orderData) {
    DOM.confirmSpinner.classList.add('hidden');
    DOM.confirmSuccessBox.classList.remove('hidden');
    DOM.confirmOrderId.textContent = `#${orderData.order_id}`;
    DOM.confirmTierName.textContent = orderData.tier_name;
    DOM.confirmTurnaroundMsg.textContent = orderData.turnaround_message;
    DOM.confirmSlotDetails.classList.add('hidden');
  }

  function renderConfirmationPendingFallback(orderId) {
    DOM.confirmSpinner.classList.add('hidden');
    DOM.confirmSuccessBox.classList.remove('hidden');
    DOM.confirmOrderId.textContent = `#${orderId}`;
    DOM.confirmTierName.textContent = 'Pago en Proceso de Verificación';
    DOM.confirmTurnaroundMsg.textContent = 'Tu pago se está procesando con Mercado Pago. En cuanto se confirme recibirás la confirmación completa en tu correo.';
    DOM.confirmSlotDetails.classList.add('hidden');
  }

  // --- Start ---
  document.addEventListener('DOMContentLoaded', init);
})();
```

---

## 5. Verification Method

To independently verify the Milestone 4 frontend architecture and implementation:

1. **Static Serving Verification**:
   - Run `npm start` (or start the test server).
   - Fetch `GET http://localhost:3000/` and verify HTTP 200 response delivering `index.html`.
   - Verify `GET http://localhost:3000/styles.css` and `GET http://localhost:3000/app.js` return HTTP 200 with appropriate MIME types (`text/css`, `application/javascript`).

2. **Visual & Design Tokens Verification**:
   - Inspect CSS variables in DevTools to confirm exact brand tokens:
     - `--teal: #0d2b2a`
     - `--teal-deep: #081d1c`
     - `--gold: #d4af37`
     - `--cream: #fbf8f2`
   - Verify Google Fonts `Cormorant Garamond` on headings/prices and `Jost` on forms and buttons.

3. **Dynamic Form & Validation Verification**:
   - Select **1 Carta**: Verify only Name, Email, Phone, Birthdate, Category, and Question are displayed.
   - Select **3 Cartas**: Verify `involved_names` field appears dynamically.
   - Select **5 Cartas**: Verify `involved_names` and `core_focus` appear and `core_focus` is marked required.
   - Select **Sesión por Llamada**: Verify the slot picker container renders date pills and CDMX time slots.
   - Test client validation: Submit empty form and verify error styling and Mexican Spanish error messages.

4. **Slot Concurrency & 15-Min Soft Lock Verification**:
   - On the Call tier, click a slot chip. Verify an API call `POST /api/slots/:id/lock` is made and the 15-minute countdown banner appears.
   - Open a secondary incognito browser session: verify the locked slot is no longer selectable (or returns HTTP 409 Conflict if clicked concurrently).
   - Switch away to `1 Carta` on the first browser: verify `POST /api/slots/:id/release` is dispatched and the slot becomes available again on refresh.

5. **Mercado Pago Checkout & Confirmation Polling Verification**:
   - Fill out valid form data for each of the 4 tiers and submit.
   - Verify network call `POST /api/checkout/create-preference` returns `order_id` and `init_point`.
   - Simulate payment redirect with `?order_id=ord_...&status=approved` in URL.
   - Verify confirmation modal activates and polls `GET /api/orders/:order_id/status` until `APPROVED`, displaying the correct 24-hour turnaround SLA (for async readings) or confirmed appointment date/time (for calls).

6. **Interactive FAQ Verification**:
   - Verify all 7 Mexican Spanish FAQ items expand and collapse smoothly upon click.
   - Confirm complete absence of any deprecated WhatsApp CTA links.
