# Lumina Umay — Booking System Build (v2)

## Context — read this first
The attached HTML file is the current site. It's currently a single static HTML file pasted directly into Netlify — that live Netlify link is being provided as a **design reference only**, not the deployment target. Ignore that Netlify deployment going forward.

**Set up a proper GitHub repository for this project** and build inside it, structured normally (not forced into a single flat HTML file) so it can be managed and version-controlled going forward. Once the repo exists, deployment will be handled separately (likely reconnecting to Netlify via the new repo, or another host) — that part isn't required as part of this task, just get the repo set up correctly with clean commits.

**Keep the current visual design as-is for now.** Don't restyle, re-theme, or redesign anything — colors, layout, fonts, spacing, imagery should carry over from the existing HTML file exactly as they are. This task is about adding functionality (Mercado Pago, booking logic, FAQ, new product tiers), not a redesign. Visual changes can come later as a separate task.

Site language: **Mexican Spanish** throughout (all copy, labels, buttons, confirmation messages, FAQ, emails).

## What's changing from the current site
- **Remove**: the WhatsApp contact link/CTA at the end of the flow (the official WhatsApp number isn't ready yet)
- **Add**: a standard FAQ section in its place
- **Add**: full Mercado Pago checkout integration (currently not actually wired up)
- **Expand**: the single "lectura por mensaje" product into 3 priced tiers (see below)
- **Keep**: the call session product, but it now requires actual slot booking (see Booking Logic)
- **No email inbox exists yet** — flag this as a dependency Claudia needs to set up (e.g. a Gmail or a Resend-verified sender address) before notifications can go out. Build the email-sending logic assuming a placeholder address for now.

## Product menu

### Category A — Lecturas de cartas (mensaje, sin llamada)
Async only. No time slot needed. Guarantee: response within 24 hours. Payment required before the order is accepted.

| Tier | Precio (MXN) | Uso |
|---|---|---|
| 1 carta | $150 | Solo preguntas de sí o no |
| 3 cartas | $350 | Pregunta o situación general |
| 5 cartas | $500 | Pregunta o situación más profunda |

**Fields per tier:**
- **1 carta**: Nombre, Fecha de nacimiento, Pregunta
- **3 cartas**: Nombre, Fecha de nacimiento, Pregunta/Situación, Nombre de la persona involucrada (si aplica)
- **5 cartas**: Nombre, Fecha de nacimiento, Pregunta/Situación, Nombre de la(s) persona(s) involucrada(s) (si aplica), Qué es lo que más deseas saber

**Every tier also includes** a required dropdown to classify the reading:
- Amor
- Trabajo/Dinero
- Familia
- Otro

### Category B — Sesión por llamada
Unchanged in concept from before: live call, requires picking an actual available time slot. This is the only product type that needs the slot-booking/availability system — card readings do not.

## Required flow (applies to both categories)
1. Customer opens the site and picks a reading type/tier
2. Customer fills out the fields for that tier + selects category dropdown (+ picks a call time slot, only for Category B)
3. Customer pays via Mercado Pago
4. **Only after payment is confirmed** does the order/booking get created — nothing is accepted or scheduled on unpaid submissions
5. Claudia receives an email with the full order details (name, birth date, question/situation, category, tier, and — for calls — the booked slot)
6. Customer sees a confirmation screen: for card readings, a "responderemos en 24 horas" message; for calls, their confirmed date/time

## Mercado Pago integration
- Set up real Mercado Pago Checkout Pro (or Checkout API) for all 5 products (1/3/5 cartas + call session — call session price wasn't given, carry over whatever the current price is unless told otherwise)
- Use a webhook/notification callback from Mercado Pago to confirm payment server-side — do not trust the frontend "payment successful" redirect alone, since that can be reached without actually paying
- Only trigger the confirmation email + (for calls) slot-lock after the webhook confirms `approved` status

## Booking logic (Category B only)
- Needs a lightweight backend/database (e.g. Supabase) since a static HTML file has no memory of its own — this is the one piece that can't live purely in the HTML file
- Store available call slots; only show open ones to the customer
- Soft-lock a slot on payment attempt, confirm it permanently once Mercado Pago's webhook approves payment, release it if payment doesn't complete
- Prevent two customers from booking the same slot

## FAQ section (replaces WhatsApp CTA)
Standard FAQ block, in Spanish. Suggested starting questions (edit/expand as needed):
- ¿Cómo recibo mi lectura?
- ¿Cuánto tarda en llegar la respuesta?
- ¿Qué pasa si no puedo asistir a mi llamada agendada?
- ¿Los pagos son seguros?
- ¿Puedo cambiar mi pregunta después de pagar?

## Definition of done
1. All 5 products (1/3/5 cartas + call session) are purchasable through real Mercado Pago checkout
2. No order/booking is created unless payment is confirmed via webhook
3. Card reading tiers collect the correct fields per tier + category dropdown, with no slot selection involved
4. Call sessions require picking a real, available slot, and double-booking is impossible
5. Claudia receives an email with full order details after each confirmed payment
6. WhatsApp CTA is gone; FAQ section is in its place
7. Entire site copy is in Mexican Spanish
