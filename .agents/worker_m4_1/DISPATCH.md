## 2026-08-16T20:20:00Z
You are worker_m4_1, a principal frontend and fullstack engineer subagent.
Your working directory is c:/LUMINAPROJECT/.agents/worker_m4_1.

Task:
Implement Milestone 4 (Frontend UI/UX, Dynamic Tier Forms, Mexican Spanish FAQ Accordion, Calendar Soft-Lock UI & Post-Payment Confirmation Views).

Mandatory reading before starting:
- c:/LUMINAPROJECT/ORIGINAL_REQUEST.md
- c:/LUMINAPROJECT/lumina-umay-booking-system-spec-v2.md
- c:/LUMINAPROJECT/PROJECT.md
- c:/LUMINAPROJECT/.agents/spec_miner_m4_1/handoff.md
- c:/LUMINAPROJECT/.agents/explorer_m4_1/handoff.md
- c:/LUMINAPROJECT/.agents/explorer_m4_2/handoff.md

Implementation deliverables:
1. `src/client/index.html`:
   - Mobile-first luxury layout matching Lumina Umay brand tokens.
   - Header with brand title & subtitle ("Lumina Umay", "Lecturas de Tarot & Claridad Espiritual con Claudia").
   - Service tier cards (1 Carta: $150 MXN, 3 Cartas: $350 MXN, 5 Cartas: $500 MXN, Sesión en Vivo por Llamada: $450 MXN) with active highlight states and badge/pricing.
   - Dynamic consultation form:
     - Category selector (`Amor`, `Trabajo/Dinero`, `Familia`, `Otro`).
     - Standard fields: `customer_name`, `customer_email`, `customer_phone`, `customer_birthdate` (YYYY-MM-DD), `question`.
     - Dynamic field `involved_names` (visible/relevant for 3 cartas and 5 cartas).
     - Dynamic field `core_focus` ("Aspecto central o foco principal", required for 5 cartas).
     - 24-hour turnaround SLA notice ("✨ Tu lectura personalizada será grabada y enviada a tu correo dentro de las próximas 24 horas hábiles.") displayed for async tiers (1, 3, 5 cartas).
     - Slot picker container for Live Call: calendar/date selector, available time slots (in CDMX timezone UTC-6), 15-minute soft-lock countdown banner with release button.
     - Checkout CTA button ("Continuar al Pago Seguro con Mercado Pago 🔒").
   - Interactive Mexican Spanish FAQ Accordion (7 questions and answers, replacing WhatsApp CTA, with accessible expand/collapse).
   - Post-payment confirmation view / modal: polls `GET /api/orders/:order_id/status` if returning from payment, showing 24h guarantee for async readings or confirmed appointment time with guidance for calls.
   - Footer with Claudia's blessing ("Con luz, gratitud y bendiciones — Claudia") and copyright.

2. `src/client/styles.css`:
   - Custom CSS variables: `--teal: #0d2b2a;`, `--teal-deep: #081d1c;`, `--gold: #d4af37;`, `--gold-light: #e8c85a;`, `--cream: #fbf8f2;`, `--text-muted: #a0b2b0;`, `--card-bg: rgba(13, 43, 42, 0.65);`, `--border-gold: rgba(212, 175, 55, 0.3);`.
   - Typography: `@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=Jost:wght@300;400;500;600&display=swap');`
   - Mobile-first container (`max-width: 620px; margin: 0 auto; min-height: 100vh; padding: 1.5rem 1rem;`).
   - Luxury dark aesthetic with subtle gold borders, backdrop blur, smooth card hover/active animations, touch targets >= 44px, clean focus outlines, validation error styling, loading spinners, and accordion transitions.

3. `src/client/app.js`:
   - Client controller logic:
     - Tier switching logic: updates active card, shows/hides tier-specific form fields, shows/hides SLA notice vs slot picker, updates submit button label.
     - Slot management: fetches available slots from `/api/slots`, groups by date (CDMX), renders slot buttons, handles slot selection and calls `/api/slots/:id/lock`, starts 15-minute countdown timer with auto-release on expiry or tier switch (`/api/slots/:id/release`).
     - Form validation: validates required fields, email format, birthdate format, phone, and question lengths before submission.
     - Preference creation: submits order payload to `POST /api/checkout/create-preference`, disables submit button with loading spinner, and redirects user to `data.init_point`.
     - Order status polling: checks URL query params (`order_id`, `payment_id`, `status`), opens status confirmation modal, polls `GET /api/orders/:order_id/status` until `status === 'paid'` or failed, displaying the tailored Mexican Spanish confirmation view.

4. `src/server/app.ts` & `package.json`:
   - Ensure `src/server/app.ts` serves static assets properly and provides fallback routing for client single-page navigation.
   - Update `package.json` `build` script to copy `src/client` to `dist/src/client` upon compilation.

5. Verification:
   - Run `npm run typecheck`
   - Run `npm run build`
   - Run `npm test`
   - Run `node tests/e2e/run-all.js`
