# Original User Request

## Initial Request — 2026-08-16T21:07:04Z

Build a fully functional booking and payment web application for Lumina Umay tarot services based on `c:/LUMINAPROJECT/lumina-umay-booking-system-spec-v2.md` and the existing UI reference, featuring 3 async card reading tiers, live call session slot booking with concurrency control, Mercado Pago Checkout & webhook verification, automated order email dispatching, and an interactive FAQ section in Mexican Spanish.

Working directory: c:/LUMINAPROJECT
Integrity mode: development

## Requirements

### R1. Multi-Tier Async Reading Flow
Implement the 3 async reading tiers (1 carta: $150 MXN, 3 cartas: $350 MXN, 5 cartas: $500 MXN) with dynamic form fields corresponding to each tier, mandatory category selection (Amor, Trabajo/Dinero, Familia, Otro), and birthdate/question capture.

### R2. Live Call Session Slot Booking & Concurrency
Implement live call booking ($450 MXN) with real-time slot availability, soft-locking during checkout attempt, automated release on timeout/failure, and permanent booking confirmation upon payment to eliminate double-booking.

### R3. Mercado Pago Payment & Webhook Verification
Integrate Mercado Pago Checkout for all 4 reading/call tiers with robust server-side webhook verification. Orders and slot locks must strictly only be confirmed when the webhook validates an `approved` payment status.

### R4. Order Notification & Email Dispatching
Implement transaction email notifications sending full customer and order details (name, birthdate, tier, category, specific question/focus, and booked time slot for calls) to Claudia, with configurable SMTP/Resend provider integration.

### R5. UI/UX Preservation & Interactive FAQ
Preserve the exact visual design, color tokens (`--teal`, `--teal-deep`, `--gold`, `--cream`), Cormorant Garamond / Jost typography, and mobile-app shell experience from the original HTML. Replace the WhatsApp CTA with an interactive Mexican Spanish FAQ accordion.

## Acceptance Criteria

### Form & Product Tiers
- [ ] Selecting 1 carta shows Nombre, Fecha de nacimiento, Pregunta, and Categoría ($150 MXN).
- [ ] Selecting 3 cartas shows additional Nombre de la persona involucrada ($350 MXN).
- [ ] Selecting 5 cartas shows additional Qué es lo que más deseas saber ($500 MXN).
- [ ] All inputs validate properly on client and server before payment initiation.

### Booking & Concurrency (Calls)
- [ ] Only currently available slots are displayed to the user.
- [ ] Selecting a slot places a temporary hold/soft-lock during the checkout session.
- [ ] Two simultaneous attempts on the same slot result in only one lock, preventing race conditions.
- [ ] Slot unlocks automatically if payment is abandoned or fails within expiration window.

### Payment & Webhook Security
- [ ] Checkout preferences are generated server-side with correct pricing and metadata.
- [ ] Server exposes a webhook endpoint that verifies Mercado Pago notifications.
- [ ] Client redirect to success page without verified webhook payment does not create an active order or confirmed booking.
- [ ] Webhook triggers order creation, slot permanence, and email notification on `payment.status == 'approved'`.

### Notifications & Content
- [ ] Email dispatcher compiles complete order context and handles placeholder/live credentials gracefully.
- [ ] FAQ section renders and toggles answers to key customer questions in natural Mexican Spanish.
- [ ] Confirmation views accurately show the 24-hour turnaround for async readings or confirmed appointment time for calls.
