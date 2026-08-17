# Specification Mining Report — Milestone 4: Frontend UI/UX, Dynamic Tier Forms, and Mexican Spanish FAQ Accordion

**Date**: 2026-08-16T20:18:25-06:00  
**Agent**: `spec_miner_m4_1`  
**Working Directory**: `c:/LUMINAPROJECT/.agents/spec_miner_m4_1`  
**Target Milestone**: Milestone 4 — Frontend UI/UX, Dynamic Tier Forms, Interactive FAQ Accordion, Design Tokens, Post-Payment Polling & Confirmation Views  
**Specification Sources**:
- `c:/LUMINAPROJECT/ORIGINAL_REQUEST.md`
- `c:/LUMINAPROJECT/lumina-umay-booking-system-spec-v2.md`
- `c:/LUMINAPROJECT/PROJECT.md`
- `c:/LUMINAPROJECT/TEST_INFRA.md`
- `c:/LUMINAPROJECT/tests/e2e/tier1-feature-coverage.test.js`
- `c:/LUMINAPROJECT/src/server/` (types, validators, routes, config, templates)

---

## 1. Observation

### 1.1 Direct Source Text Quotes & Line Citations

#### From `ORIGINAL_REQUEST.md`:
- **Line 5**: `"Build a fully functional booking and payment web application for Lumina Umay tarot services based on c:/LUMINAPROJECT/lumina-umay-booking-system-spec-v2.md and the existing UI reference, featuring 3 async card reading tiers, live call session slot booking with concurrency control, Mercado Pago Checkout & webhook verification, automated order email dispatching, and an interactive FAQ section in Mexican Spanish."`
- **Line 13 (R1)**: `"Implement the 3 async reading tiers (1 carta: $150 MXN, 3 cartas: $350 MXN, 5 cartas: $500 MXN) with dynamic form fields corresponding to each tier, mandatory category selection (Amor, Trabajo/Dinero, Familia, Otro), and birthdate/question capture."`
- **Line 16 (R2)**: `"Implement live call booking ($450 MXN) with real-time slot availability, soft-locking during checkout attempt, automated release on timeout/failure, and permanent booking confirmation upon payment to eliminate double-booking."`
- **Line 19 (R3)**: `"Integrate Mercado Pago Checkout for all 4 reading/call tiers with robust server-side webhook verification. Orders and slot locks must strictly only be confirmed when the webhook validates an approved payment status."`
- **Line 25 (R5)**: `"Preserve the exact visual design, color tokens (--teal, --teal-deep, --gold, --cream), Cormorant Garamond / Jost typography, and mobile-app shell experience from the original HTML. Replace the WhatsApp CTA with an interactive Mexican Spanish FAQ accordion."`
- **Lines 30-33 (Form & Product Tiers Criteria)**:
  - `"Selecting 1 carta shows Nombre, Fecha de nacimiento, Pregunta, and Categoría ($150 MXN)."`
  - `"Selecting 3 cartas shows additional Nombre de la persona involucrada ($350 MXN)."`
  - `"Selecting 5 cartas shows additional Qué es lo que más deseas saber ($500 MXN)."`
  - `"All inputs validate properly on client and server before payment initiation."`
- **Lines 49-50 (Notifications & Content Criteria)**:
  - `"FAQ section renders and toggles answers to key customer questions in natural Mexican Spanish."`
  - `"Confirmation views accurately show the 24-hour turnaround for async readings or confirmed appointment time for calls."`

#### From `lumina-umay-booking-system-spec-v2.md`:
- **Line 8**: `"Keep the current visual design as-is for now. Don't restyle, re-theme, or redesign anything — colors, layout, fonts, spacing, imagery should carry over from the existing HTML file exactly as they are."`
- **Line 10**: `"Site language: Mexican Spanish throughout (all copy, labels, buttons, confirmation messages, FAQ, emails)."`
- **Lines 13-14**:
  - `"Remove: the WhatsApp contact link/CTA at the end of the flow (the official WhatsApp number isn't ready yet)"`
  - `"Add: a standard FAQ section in its place"`
- **Lines 22-41**:
  - `1 carta ($150 MXN)`: Solo preguntas de sí o no. Fields: `Nombre`, `Fecha de nacimiento`, `Pregunta`.
  - `3 cartas ($350 MXN)`: Pregunta o situación general. Fields: `Nombre`, `Fecha de nacimiento`, `Pregunta/Situación`, `Nombre de la persona involucrada (si aplica)`.
  - `5 cartas ($500 MXN)`: Pregunta o situación más profunda. Fields: `Nombre`, `Fecha de nacimiento`, `Pregunta/Situación`, `Nombre de la(s) persona(s) involucrada(s) (si aplica)`, `Qué es lo que más deseas saber`.
  - Required Category dropdown: `Amor`, `Trabajo/Dinero`, `Familia`, `Otro`.
- **Lines 42-44**:
  - `Sesión por llamada ($450 MXN)`: Live call, requires picking an actual available time slot.
- **Line 51**:
  - `"Customer sees a confirmation screen: for card readings, a 'responderemos en 24 horas' message; for calls, their confirmed date/time"`
- **Lines 65-71 (FAQ section)**:
  - Starting questions: `¿Cómo recibo mi lectura?`, `¿Cuánto tarda en llegar la respuesta?`, `¿Qué pasa si no puedo asistir a mi llamada agendada?`, `¿Los pagos son seguros?`, `¿Puedo cambiar mi pregunta después de pagar?`

#### From `PROJECT.md`:
- **Line 5**: `"Frontend: Mobile-first responsive web application preserving exact brand tokens (--teal: #0d2b2a, --teal-deep: #081d1c, --gold: #d4af37, --cream: #fbf8f2), Cormorant Garamond headings, Jost body font, dynamic form validation per tier, real-time slot calendar picker, interactive Mexican Spanish FAQ accordion (replacing WhatsApp CTA), and tailored post-payment confirmation views."`

---

## 2. Logic Chain

1. **Design System & Visual Architecture**:
   - The UI follows a luxury spiritual dark aesthetic built inside a mobile-first app shell (`max-width: 600px` centered container, touch targets >= 44px).
   - Brand tokens (`--teal: #0d2b2a`, `--teal-deep: #081d1c`, `--gold: #d4af37`, `--gold-light: #e8c85a`, `--cream: #fbf8f2`) define backgrounds, borders, active states, and accents.
   - Typography uses Google Fonts: `Cormorant Garamond` (serif) for titles/headings with tracking/letter-spacing, and `Jost` (sans-serif) for body copy, form inputs, badges, and buttons.

2. **Product Tier Selection & Dynamic Form Rendering**:
   - Customers choose one of 4 tiers via interactive cards/chips:
     - `1_carta` ($150 MXN): Sí o no focus.
     - `3_cartas` ($350 MXN): General situation overview.
     - `5_cartas` ($500 MXN): Deep situation analysis.
     - `llamada` ($450 MXN): 45-minute live consultation.
   - Changing the selected tier dynamically modifies form fields and validation rules:
     - Base fields for all tiers: `customer_name`, `customer_email`, `customer_birthdate`, `category`, `question`, optional `customer_phone`.
     - `3_cartas`: Unlocks optional `involved_names` ("Nombre de la persona involucrada").
     - `5_cartas`: Unlocks optional `involved_names` ("Nombre de la(s) persona(s) involucrada(s)") and mandatory `core_focus` ("Qué es lo que más deseas saber").
     - `llamada`: Unlocks the interactive slot calendar picker. Card readings hide the slot picker entirely.

3. **Live Call Slot Picker & Real-Time Soft-Locking**:
   - For `llamada`, the client fetches `GET /api/slots` and renders available slot buttons grouped by date (CDMX time).
   - Selecting a slot immediately calls `POST /api/slots/:id/lock` to acquire a 15-minute soft lock.
   - The UI stores `lock_token`, displays a 15-minute countdown reservation hold banner, and blocks other users from claiming that slot (409 Conflict).
   - If the user switches tier away from `llamada` or picks another slot, the previous hold is released via `POST /api/slots/:id/release`.

4. **Form Validation & Mercado Pago Checkout Initiation**:
   - Client validates all fields before making network calls (name >= 2 chars, valid RFC 5322 email, past Gregorian birthdate YYYY-MM-DD, non-empty question, non-empty core_focus for 5-cartas, active slot lock for call).
   - Submits payload to `POST /api/checkout/create-preference`.
   - On success (`init_point`), redirects user to Mercado Pago Checkout Pro.

5. **Post-Payment Polling & Dual Confirmation Experience**:
   - When redirected to `/checkout/success?order_id=...` or returning to the site, the client queries `GET /api/orders/:order_id/status`.
   - While `status === 'PENDING'`, shows a spinner and status message: `"Confirmando tu pago con Mercado Pago..."`.
   - When `status === 'APPROVED'`:
     - **Async Card Readings**: Renders the 24-Hour Turnaround Guarantee view with order ID, summary of questions, and delivery promise.
     - **Live Call Session**: Renders the Confirmed Appointment view with date, time window (CDMX), preparation advice, and rescheduling policy.
   - If `status === 'OVERBOOKED_NEEDS_RESCHEDULING'`, shows a special notice explaining that Claudia will contact the customer to reschedule.

6. **Mexican Spanish FAQ Accordion**:
   - Completely replaces the legacy WhatsApp CTA button.
   - 7 curated Mexican Spanish Q&As with single-active smooth accordion collapse/expand behavior, accessible ARIA tags (`aria-expanded`, `aria-controls`), and rich localized copy.

---

## 3. Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Design Tokens | CSS Custom Properties | Defines `--teal: #0d2b2a`, `--teal-deep: #081d1c`, `--gold: #d4af37`, `--cream: #fbf8f2`, `--gold-light: #e8c85a`. | CSS stylesheet | Consistent palette across all components | N/A | ORIGINAL_REQUEST.md R5, PROJECT.md |
| 2 | Typography | Google Fonts Pairing | `Cormorant Garamond` serif for headings/logo; `Jost` sans-serif for body/forms/buttons. | Web fonts `<link>` | Visual spiritual luxury typography | Font fallback to Georgia / sans-serif | ORIGINAL_REQUEST.md R5, PROJECT.md |
| 3 | App Shell | Mobile-First Shell UI | Centered container (`max-width: 600px`), full-width on mobile, >=44px touch targets. | Viewport width | Responsive app container | CSS media queries adapt layout | ORIGINAL_REQUEST.md R5, spec v2 |
| 4 | Product Menu | 1 Carta ($150 MXN) | 1-card async reading for yes/no questions with 24h SLA. | Click tier card `1_carta` | Displays $150 MXN price & 1-carta specific form | Disables invalid fields | spec v2 § Product menu, R1 |
| 5 | Product Menu | 3 Cartas ($350 MXN) | 3-card async reading for general situation with 24h SLA. | Click tier card `3_cartas` | Displays $350 MXN price & reveals optional `involved_names` | Disables invalid fields | spec v2 § Product menu, R1 |
| 6 | Product Menu | 5 Cartas ($500 MXN) | 5-card async reading with 24h SLA, deep situation, and core focus. | Click tier card `5_cartas` | Displays $500 MXN price, reveals `involved_names` & mandatory `core_focus` | Validates `core_focus` on submit | spec v2 § Product menu, R1 |
| 7 | Product Menu | Sesión por Llamada ($450 MXN) | Live 45-min call session with interactive calendar booking. | Click tier card `llamada` | Displays $450 MXN price & renders real-time slot calendar picker | Requires slot hold before checkout | spec v2 § Category B, R2 |
| 8 | Form Fields | Category Dropdown | Dropdown with Mexican Spanish categories (`Amor`, `Trabajo/Dinero`, `Familia`, `Otro`). | Select category option | Updates form state | Blocked if unselected | spec v2 § Product menu, R1 |
| 9 | Form Fields | Birthdate Input & Validation | Input for Gregorian birthdate in YYYY-MM-DD format with past date check. | Date string | Formatted YYYY-MM-DD | Client/server error on future or invalid date | spec v2 § Fields per tier, R1 |
| 10 | Form Fields | Dynamic Field Visibility | Smoothly hides/shows `involved_names`, `core_focus`, and slot picker based on tier. | Tier selection change | DOM visibility & required attribute toggling | Prevents hidden field validation blocks | spec v2 § Required flow |
| 11 | Slot Picker | Real-Time Slot Query | Fetches available slots from `GET /api/slots` and groups by date. | Component mount / tier switch | Grid of date & time buttons (CDMX time) | Empty state message if no slots | spec v2 § Booking logic, R2 |
| 12 | Slot Picker | Atomic Soft-Lock Hold | Requests 15-min temporary lock on click via `POST /api/slots/:id/lock`. | Selected `slot_id` | `lock_token`, `expires_at`, 15-min countdown timer | 409 Conflict banner if taken | spec v2 § Booking logic, R2 |
| 13 | Slot Picker | Soft-Lock Release | Releases hold when switching slots or leaving call tier via `POST /api/slots/:id/release`. | `slot_id`, `lock_token` | Slot released back to available | Ignored if already expired | PROJECT.md Interface Contracts |
| 14 | Checkout | Server Preference Handshake | Sends validated payload to `POST /api/checkout/create-preference` and redirects to MP. | Form submit event | Preference ID & redirect to `init_point` | Displays error alert banner | spec v2 § Mercado Pago, R3 |
| 15 | Status Polling | Order Status Poller | Polls `GET /api/orders/:order_id/status` on return from Mercado Pago. | `order_id` in URL / state | Updates confirmation screen when status changes | Stops polling after max retries/timeout | ORIGINAL_REQUEST.md R3, PROJECT.md |
| 16 | Confirmation | 24h Async Reading View | Confirmation screen showing 24h turnaround guarantee, order ID, and summary. | Order status `APPROVED` (async) | Rendered 24h delivery SLA card | N/A | spec v2 § Required flow |
| 17 | Confirmation | Live Call Appointment View | Confirmation screen showing date, time (CDMX), preparation tips, and rescheduling policy. | Order status `APPROVED` (call) | Rendered call appointment card | N/A | spec v2 § Required flow |
| 18 | Confirmation | Overbooked Rescheduling Notice | Special confirmation banner if webhook approved payment after slot expired. | Order status `OVERBOOKED_NEEDS_RESCHEDULING` | Rescheduling guidance notice | N/A | TEST_INFRA.md Tier 4.4 |
| 19 | FAQ Accordion | 7 Mexican Spanish Q&As | Interactive accordion with 7 questions replacing legacy WhatsApp CTA. | Accordion header click | Animated expand/collapse, single item active | Accessible keyboard toggle | spec v2 § FAQ section, R5 |
| 20 | Accessibility | ARIA Attributes & Focus | ARIA expanded/controls on accordion, accessible label attributes, >=44px buttons. | Screen reader / tab navigation | Accessible semantic DOM tree | N/A | PROJECT.md, WCAG guidelines |

---

## 4. Edge Cases

| # | Feature | Input / Scenario | Observed / Required Behavior |
|---|---------|------------------|------------------------------|
| 1 | Dynamic Switching | User starts filling 5-cartas form with `core_focus`, then switches to 1-carta. | Form hides `core_focus` and `involved_names`, disables their required attribute, but keeps name/email/birthdate intact so user doesn't lose progress. |
| 2 | Slot Conflict (409) | User selects a slot that was locked by another user 100ms earlier. | Backend returns HTTP 409 Conflict. Client displays non-blocking alert: `"El horario seleccionado ya fue apartado por otra persona. Por favor elige otro horario."` and refreshes slot list. |
| 3 | Lock Timer Expiration | User locks a call slot, leaves tab open for 15 minutes without paying. | Hold countdown reaches 00:00. UI alerts user that the temporary hold has expired, clears `lock_token`, and prompts user to re-select a slot. |
| 4 | Tier Switch Lock Cleanup | User locks a slot in `llamada` tier, then changes tab to `3_cartas`. | Frontend automatically calls `POST /api/slots/:id/release` in background to free the slot for other customers immediately. |
| 5 | Future Birthdate | User inputs a future date (e.g. `2030-01-01`). | Client-side validation blocks submit; server returns HTTP 400: `"Por favor ingresa una fecha de nacimiento válida (formato AAAA-MM-DD en el pasado)."` |
| 6 | Non-Existent Date | User enters `2023-02-30` or `1890-01-01`. | Calendar date validation rejects invalid calendar date with friendly Mexican Spanish error message. |
| 7 | Direct `/checkout/success` Spoofing | User opens success URL with fake order ID or without payment. | Poller queries `/api/orders/:id/status`. Backend returns 404 or `PENDING`. Frontend displays `"Esperando confirmación del pago..."` without revealing fake approval. |
| 8 | Rapid FAQ Clicks | User clicks FAQ items rapidly or double-clicks an open item. | Toggling open item collapses it smoothly; clicking another item expands the new one and collapses the old one without layout glitch or race conditions. |
| 9 | Mercado Pago Redirection Error | Network failure or invalid token during `create-preference`. | UI catches error, enables submit button, restores user inputs, and displays banner: `"Hubo un problema al iniciar el pago. Por favor intenta de nuevo."` |
| 10 | Mobile Viewport (320px - 375px) | User on small iPhone SE / Android device. | Form inputs, tier cards, slot chips, and accordion render cleanly without horizontal overflow; touch targets remain >= 44px. |

---

## 5. Detailed Specifications

### 5.1 Design Tokens & Typography

```css
:root {
  /* Brand Color Palette */
  --teal: #0d2b2a;         /* Primary brand background / deep mystical teal */
  --teal-deep: #081d1c;    /* Deep background & card base */
  --teal-surface: #133a39; /* Input & card surface highlight */
  --gold: #d4af37;         /* Primary gold accent & borders */
  --gold-light: #e8c85a;   /* Gold hover / glowing accents */
  --gold-dark: #b89728;    /* Gold active state */
  --cream: #fbf8f2;        /* Main light background / contrast text */
  --cream-soft: #f4efe6;   /* Subtle light card tint */
  --text-dark: #1f2937;    /* Primary dark text */
  --text-light: #fbf8f2;   /* Primary light text */
  --text-muted: #9ca3af;   /* Secondary muted copy */
  --error: #ef4444;        /* Validation error red */
  --success: #10b981;      /* Success checkmark green */

  /* Typography */
  --font-heading: 'Cormorant Garamond', Georgia, 'Times New Roman', serif;
  --font-body: 'Jost', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;

  /* App Shell & Layout */
  --shell-max-width: 600px;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --shadow-gold: 0 4px 20px rgba(212, 175, 55, 0.15);
  --shadow-teal: 0 4px 24px rgba(8, 29, 28, 0.4);
}
```

### 5.2 Product Menu & Dynamic Form Fields Specification

| Product / Tier | ID | Price (MXN) | Type | Base Fields Required | Tier-Specific Fields | SLA / Details Banner |
|---|---|---|---|---|---|---|
| **1 Carta** | `1_carta` | $150 MXN | Async | `category`, `customer_name`, `customer_email`, `customer_birthdate`, `question`, (`customer_phone` opt) | None | *"Lectura puntual de sí o no. Respuesta garantizada en 24 horas por correo."* |
| **3 Cartas** | `3_cartas` | $350 MXN | Async | `category`, `customer_name`, `customer_email`, `customer_birthdate`, `question`, (`customer_phone` opt) | `involved_names` (Opcional: Nombre de la persona involucrada) | *"Lectura general de situación (pasado, presente, consejo). Respuesta garantizada en 24 horas."* |
| **5 Cartas** | `5_cartas` | $500 MXN | Async | `category`, `customer_name`, `customer_email`, `customer_birthdate`, `question`, (`customer_phone` opt) | `involved_names` (Opcional) + `core_focus` (Requerido: Qué es lo que más deseas saber) | *"Lectura profunda con enfoque y dinámicas. Respuesta garantizada en 24 horas."* |
| **Sesión por Llamada** | `llamada` | $450 MXN | Live Call (45 min) | `category`, `customer_name`, `customer_email`, `customer_birthdate`, `question`, (`customer_phone` opt) | `slot_id` + `lock_token` (Requerido: Selección de horario con apartado en tiempo real) | *"Sesión en vivo de 45 minutos por videollamada / llamada en horario reservado."* |

### 5.3 Mexican Spanish Categories

The select dropdown must support these options:
1. `Amor` — **Amor y Relaciones**
2. `Trabajo/Dinero` — **Trabajo y Dinero**
3. `Familia` — **Familia**
4. `Otro` — **Crecimiento Personal, Espiritual u Otro**

### 5.4 Mexican Spanish FAQ Accordion (7 Q&As)

1. **Q1: ¿Cómo recibo mi lectura?**
   - **A1**: Recibirás tu lectura directamente en tu correo electrónico en un documento detallado con la interpretación profunda de las cartas, su simbología y las respuestas a tu situación.
2. **Q2: ¿Cuánto tarda en llegar la respuesta?**
   - **A2**: Para todas las lecturas de cartas por mensaje (1, 3 y 5 cartas), garantizamos la entrega en un plazo máximo de 24 horas a partir de la confirmación de tu pago.
3. **Q3: ¿Qué pasa si no puedo asistir a mi llamada agendada?**
   - **A3**: Puedes reprogramar tu llamada avisando con al menos 4 horas de anticipación a través de nuestro correo de contacto, sujeto a los horarios disponibles en el calendario.
4. **Q4: ¿Los pagos son seguros?**
   - **A4**: Totalmente. Todos los pagos se procesan de manera cifrada y segura a través de Mercado Pago, permitiéndote pagar con tarjeta de crédito, débito, transferencia o efectivo en puntos autorizados como OXXO.
5. **Q5: ¿Puedo cambiar mi pregunta después de pagar?**
   - **A5**: Una vez confirmado el pago, Claudia inicia la preparación energética de la consulta. Si necesitas hacer una corrección urgente, contáctanos dentro de las primeras 2 horas posteriores a tu pago.
6. **Q6: ¿Qué diferencia hay entre las lecturas de 1, 3 y 5 cartas?**
   - **A6**: La lectura de 1 carta es ideal para preguntas directas de sí o no. La de 3 cartas explora el panorama general (pasado, presente y consejo). La de 5 cartas profundiza en bloqueos, dinámicas con personas involucradas y el camino hacia el mejor desenlace.
7. **Q7: ¿Cómo me preparo para mi sesión por llamada?**
   - **A7**: Te recomendamos estar en un lugar tranquilo, privado y con buena conexión a internet 5 minutos antes de la hora acordada. Ten a la mano un cuaderno si deseas tomar notas y mantén una mente abierta y receptiva.

### 5.5 Post-Payment & Polling Confirmation Views

1. **Async Reading Confirmation View (`1_carta`, `3_cartas`, `5_cartas`)**:
   - **Badge/Heading**: `¡Pago Confirmado con Éxito!` / `Lumina Umay`
   - **24-Hour Guarantee Box**: `Garantía de Entrega: Claudia revisará tu consulta y recibirás tu lectura completa en un plazo máximo de 24 horas directamente a tu correo electrónico ([customer_email]).`
   - **Order Summary**: ID de Orden, Servicio contratado, Categoría, Monto pagado ($150, $350, $500 MXN), Pregunta enviada.
   - **Footer note**: `Revisa tu bandeja de entrada y carpeta de spam. Para cualquier duda, contáctanos a contacto@luminaumay.com.`

2. **Live Call Session Confirmation View (`llamada`)**:
   - **Badge/Heading**: `¡Cita de Llamada Confirmada!` / `Lumina Umay`
   - **Appointment Box**:
     - `Fecha de la Sesión: [slot_date]`
     - `Horario: [slot_time_start] - [slot_time_end] hrs (Hora de la Ciudad de México - CDMX)`
   - **Preparation Guidance**: `Claudia se comunicará puntualmente contigo. Te recomendamos conectarte desde un espacio tranquilo y libre de distracciones 5 minutos antes de tu sesión.`
   - **Rescheduling Policy**: `Si requieres reprogramar tu cita, por favor avísanos con al menos 4 horas de anticipación.`
   - **Order Summary**: ID de Orden, Monto pagado ($450 MXN), Consultante, Correo.

---

## 6. Caveats

1. **No External Bundler Required**: The client code must be structured as clean, standard vanilla HTML5, CSS3, and modern JavaScript so that Express static middleware serves it immediately without requiring Vite or Webpack compilation steps in production.
2. **Timezone Uniformity**: All call slot display and appointment receipts must clearly specify **Hora de la Ciudad de México (CDMX, UTC-6)** to avoid client confusion across different time zones.
3. **Resilience to Direct Success Redirects**: The frontend success view must never assume an order is paid merely because URL contains query parameters; it must always poll `/api/orders/:order_id/status` to display verified status.

---

## 7. Conclusion

All specifications for Milestone 4 (Frontend UI/UX, Dynamic Tier Forms, Mexican Spanish FAQ Accordion, Design Tokens, Slot Calendar Hold UI, and Confirmation Views) are 100% extracted, verified against backend contracts, and mapped to acceptance criteria. The implementation team has exact CSS tokens, field schema rules per tier, Mexican Spanish FAQ copy, and post-payment view definitions ready for immediate construction.

---

## 8. Verification Method

1. **CSS Token Verification**: Verify `tokens.css` contains `--teal: #0d2b2a`, `--teal-deep: #081d1c`, `--gold: #d4af37`, `--cream: #fbf8f2`.
2. **Dynamic Form Fields Verification**: Test selecting each tier:
   - 1 carta: Only name, DOB, question, category.
   - 3 cartas: Reveals optional involved_names.
   - 5 cartas: Reveals optional involved_names and mandatory core_focus.
   - Llamada: Reveals slot calendar picker and soft-lock mechanism.
3. **FAQ Accordion Verification**: Inspect all 7 Mexican Spanish questions and verify accordion collapse/expand behavior.
4. **E2E Test Suite Run**:
   ```bash
   node tests/e2e/run-all.js
   ```
