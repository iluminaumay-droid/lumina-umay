# Project: Lumina Umay Tarot Booking & Payment System

## Architecture
- **Backend**: Node.js + Express + TypeScript with SQLite (`better-sqlite3` in WAL mode) for atomic transaction support, slot soft-locking with TTL, Mercado Pago SDK/REST integration, HMAC SHA-256 webhook validation, and pluggable email notification engine (Nodemailer/Resend/Mock Logger).
- **Frontend**: Mobile-first responsive web application preserving exact brand tokens (`--teal: #0d2b2a`, `--teal-deep: #081d1c`, `--gold: #d4af37`, `--cream: #fbf8f2`), Cormorant Garamond headings, Jost body font, dynamic form validation per tier, real-time slot calendar picker, interactive Mexican Spanish FAQ accordion (replacing WhatsApp CTA), and tailored post-payment confirmation views.
- **Security & Integrity Model**: Zero-trust client redirects. Order fulfillment and slot permanence are exclusively executed upon server-side webhook verification of `payment.status === 'approved'`. Concurrency locks prevent race conditions and double-booking.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Database & Migrations | SQLite schema initialization for slots, orders, and webhook idempotency events | M1 | Architecture Survey |
| 2 | Slot Seeding & Query API | Query open slots with real-time expiration of stale holds | M1 | Spec v2 § Booking logic |
| 3 | Concurrency Soft-Locking | Atomic 15-minute slot lock with TTL token & HTTP 409 conflict handling | M1 | Original Request R2 |
| 4 | Auto-Release Engine | Background / query-time release of expired locks and cancelled attempts | M1 | Spec v2 § Booking logic |
| 5 | Order Data Model & Validation | Server-side validation for 1 carta ($150), 3 cartas ($350), 5 cartas ($500), and call ($450) | M1 | Original Request R1 |
| 6 | Mercado Pago Preference API | Server-side Checkout Pro preference creation with server-enforced pricing | M2 | Spec v2 § Mercado Pago |
| 7 | Webhook Signature Auth | HMAC SHA-256 (`x-signature`) verification on incoming payment notifications | M2 | Architecture Survey |
| 8 | Server Payment Double-Check | Direct API query (`/v1/payments/{id}`) validating `status == 'approved'` | M2 | Spec v2 § Mercado Pago |
| 9 | Webhook Idempotency | Guard table preventing duplicate processing or multiple emails | M2 | Original Request R3 |
| 10 | Anti-Spoofing Status API | Safe read-only polling endpoint (`/api/orders/:id/status`) for client success screen | M2 | Original Request R3 |
| 11 | Claudia Order Notification Email | Comprehensive HTML/text email with full client, tier, question, and slot context | M3 | Original Request R4 |
| 12 | Customer Confirmation Email | Email receipt with 24h async turnaround SLA or confirmed call appointment details | M3 | Spec v2 § Required flow |
| 13 | Multi-Provider Dispatcher | Pluggable email provider supporting SMTP, Resend, and Mock/Console Logger | M3 | Spec v2 § Context |
| 14 | Design Tokens & Mobile Shell | CSS variables (`--teal`, `--gold`, etc.), Cormorant Garamond/Jost, mobile container | M4 | Original Request R5 |
| 15 | Dynamic Tier Forms | Client form rendering specific required/optional fields for 1, 3, 5 cartas and calls | M4 | Spec v2 § Product menu |
| 16 | Category Dropdown & Validation | Mexican Spanish form validation (`Amor`, `Trabajo/Dinero`, `Familia`, `Otro`, DOB, Question) | M4 | Original Request R1 |
| 17 | Interactive Slot Calendar UI | Real-time date/slot picker with instant soft-lock reservation feedback | M4 | Original Request R2 |
| 18 | Interactive Spanish FAQ Accordion | 7 curated Mexican Spanish Q&As replacing WhatsApp CTA with smooth accordion toggle | M4 | Spec v2 § FAQ section |
| 19 | Dual Confirmation Views | 24h turnaround guarantee banner for card readings; appointment summary for calls | M4 | Spec v2 § Required flow |
| 20 | E2E Test Suite (Tiers 1-4) | Comprehensive opaque-box test suite verifying all 4 tiers, concurrency, webhooks, and UI | M5 | E2E Test Track |
| 21 | Adversarial Hardening (Tier 5) | Stress tests for edge-case race conditions, webhook tampering, and invalid payloads | M5 | Project Pattern Tier 5 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Testing Suite Track | Independent test runner and test cases across Tiers 1-4, publishing TEST_READY.md | none | DONE |
| M1 | Core Database & Concurrency Slot Engine | SQLite setup, slot models, atomic soft-lock transactions, TTL sweeper, unit tests | none | DONE |
| M2 | Mercado Pago Checkout & Webhook Security | Server preference creation, signature auth, payment API validation, idempotency | M1 | DONE |
| M3 | Order Email Dispatcher | Pluggable email service (Nodemailer/Resend/Mock), Claudia & Customer Spanish templates | M1 | DONE |
| M4 | Frontend UI/UX, Dynamic Forms & FAQ | Mobile-app shell, design tokens, dynamic tier forms, slot picker, Spanish FAQ accordion | M1, M2, M3 | IN_PROGRESS |
| M5 | Full Integration & E2E Verification | Pass 100% E2E test suite (Tiers 1-4) and complete Tier 5 adversarial hardening | E2E, M1-M4 | PLANNED |

## Interface Contracts

### 1. Slots API
- `GET /api/slots`: Returns available slots `{ success: true, slots: [{ id, start_time, end_time, status }] }`.
- `POST /api/slots/:id/lock`: Acquires a 15-minute soft lock. Returns `{ success: true, lock_token, expires_at }` or `409 Conflict`.
- `POST /api/slots/:id/release`: Releases a soft lock with `{ lock_token }`.

### 2. Checkout & Orders API
- `POST /api/checkout/create-preference`: Body `{ tier_id, category, customer_name, customer_email, customer_birthdate, question, involved_names?, core_focus?, slot_id?, lock_token? }`. Returns `{ success: true, order_id, preference_id, init_point, sandbox_init_point }`.
- `GET /api/orders/:order_id/status`: Returns `{ success: true, order_id, status: 'pending'|'paid'|'failed', tier_id, turnaround_message, slot }`.

### 3. Webhooks API
- `POST /api/webhooks/mercadopago`: Receives MP IPN notification, validates signature & payment status via MP REST API, confirms slot permanence, updates order to `paid`, and dispatches emails. Returns `200 OK`.

### 4. Email Service Interface
- `EmailService.sendOrderNotificationToClaudia(order: Order): Promise<boolean>`
- `EmailService.sendConfirmationToCustomer(order: Order): Promise<boolean>`

## Code Layout
```
c:/LUMINAPROJECT/
├── src/
│   ├── server/
│   │   ├── index.ts                # Express application entry point
│   │   ├── config.ts               # Environment and pricing configuration
│   │   ├── db/
│   │   │   ├── schema.sql          # SQLite table definitions
│   │   │   ├── database.ts         # Better-SQLite3 connection & WAL setup
│   │   │   └── seed.ts             # Default slot seeding script
│   │   ├── routes/
│   │   │   ├── slots.routes.ts     # Slot query and lock routes
│   │   │   ├── checkout.routes.ts  # Preference creation & status routes
│   │   │   └── webhook.routes.ts   # Mercado Pago webhook verification
│   │   ├── services/
│   │   │   ├── slot.service.ts     # Atomic soft-locking & TTL sweeper
│   │   │   ├── mercadopago.service.ts # MP SDK & payment verification
│   │   │   └── email.service.ts    # Nodemailer/Resend/Mock dispatcher
│   │   └── templates/
│   │       ├── claudia-notification.html
│   │       └── customer-confirmation.html
│   └── client/
│       ├── index.html              # Main HTML entry with Cormorant Garamond / Jost
│       ├── styles/
│       │   ├── tokens.css          # Design tokens (--teal, --gold, --cream)
│       │   └── main.css            # Mobile-first app shell & accordion styles
│       └── js/
│           ├── app.js              # State management & dynamic tier switching
│           ├── slots.js            # Live slot calendar picker & hold timer
│           ├── faq.js              # Interactive Spanish FAQ accordion
│           └── checkout.js         # Form validation & MP redirect handler
├── tests/
│   ├── e2e/                        # Opaque-box E2E test suite (Tiers 1-4)
│   ├── unit/                       # Unit tests for services & validators
│   └── adversarial/                # Tier 5 stress & concurrency tests
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
├── TEST_INFRA.md                   # E2E Test track documentation
└── TEST_READY.md                   # Test readiness signal
```
