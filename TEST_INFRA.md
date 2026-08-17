# Test Infrastructure: Lumina Umay E2E Test Suite

## Overview
This document defines the architectural design, execution framework, test data fixtures, and requirement-to-test mapping for the **Lumina Umay Tarot Booking & Payment System** End-to-End (E2E) Test Suite.

The test suite is built in accordance with the specifications in `ORIGINAL_REQUEST.md`, `lumina-umay-booking-system-spec-v2.md`, and `PROJECT.md`. It provides opaque-box, requirement-driven verification across 4 distinct test tiers (57 total test cases).

---

## Test Framework & Architecture

### Technology Stack
- **Test Runner**: Node.js native test runner (`node:test`) + assertions (`node:assert/strict`).
- **Runtime**: Node.js v20+ / v26+ (Zero external npm dependencies required for test execution).
- **Communication Protocol**: Native `fetch` / HTTP REST requests against target API endpoints.
- **Test Modes**:
  1. **Live Server Mode**: Executes HTTP requests against a running backend instance (`TEST_BASE_URL=http://localhost:3000`).
  2. **In-Process Spec Harness Mode**: Autonomous execution using built-in reference mock server when running standalone or in CI prior to full server deployment.

### Directory Layout
```
c:/LUMINAPROJECT/
├── tests/
│   ├── e2e/
│   │   ├── helpers/
│   │   │   ├── test-client.js           # HTTP client helper for REST API calls
│   │   │   ├── mock-server.js           # Spec-compliant in-process mock server
│   │   │   ├── test-harness.js          # Unified test harness & lifecycle manager
│   │   │   └── assertion-helpers.js     # Domain assertion utilities (copy, prices, dates)
│   │   ├── tier1-feature-coverage.test.js    # Tier 1: Product Tiers (1/3/5 cartas, calls) & FAQ (30 tests)
│   │   ├── tier2-boundary-concurrency.test.js # Tier 2: Boundaries, race conditions & webhooks (12 tests)
│   │   ├── tier3-cross-feature.test.js       # Tier 3: Transitions, idempotency & lifecycle (10 tests)
│   │   ├── tier4-real-world-scenarios.test.js # Tier 4: Full async & call workflows (5 tests)
│   │   └── run-all.js                        # Master CLI test runner with ANSI reporting
├── TEST_INFRA.md                             # Test infrastructure specifications
└── TEST_READY.md                             # Test suite readiness & execution instructions
```

---

## Test Tiers & Requirements Mapping

### Tier 1: Feature Coverage (30 Tests)
| Sub-Suite | Description | Minimum Required | Implemented Tests | Key Assertions |
|---|---|---|---|---|
| **1 Carta ($150 MXN)** | Async 1-card reading for yes/no questions | >= 5 | 6 | $150 MXN pricing, question & birthdate required, 24h SLA message |
| **3 Cartas ($350 MXN)** | Async 3-card reading for general situation | >= 5 | 6 | $350 MXN pricing, optional involved name, question & category required |
| **5 Cartas ($500 MXN)** | Async 5-card deep reading | >= 5 | 6 | $500 MXN pricing, mandatory core focus (`Qué es lo que más deseas saber`) |
| **Sesión por Llamada ($450 MXN)** | Live scheduled call consultation | >= 5 | 6 | $450 MXN pricing, slot query, soft-lock acquisition, conflict handling |
| **FAQ Accordion & UI** | Interactive Mexican Spanish FAQ | >= 5 | 6 | 5 core Mexican Spanish Q&As, accordion state toggle, no WhatsApp CTA |

### Tier 2: Boundary & Concurrency (12 Tests)
| Category | Test Case | Target Behavior |
|---|---|---|
| **Input Boundaries** | Extreme question length (5,000 chars) | Handled cleanly without server crash or database truncation error |
| **Input Boundaries** | Extreme / minimal name length | Validated according to boundary rules (min 2 chars) |
| **Date Boundaries** | Future birthdate (`2050-01-01`) | HTTP 400 Bad Request: `"Por favor ingresa una fecha de nacimiento válida."` |
| **Date Boundaries** | Non-existent date (`2023-02-30`) | HTTP 400 Bad Request with Spanish error message |
| **Enum Boundaries** | Invalid category enum (`"Salud"`) | HTTP 400 Bad Request rejecting unlisted categories |
| **Sanitization** | XSS script tags in name/question | HTML-escaped and safely stored without injection risk |
| **Concurrency** | 10 simultaneous slot lock requests | Exactly 1 lock granted (HTTP 200), 9 requests receive HTTP 409 Conflict |
| **Concurrency** | Lock release & immediate re-acquire | Released slot immediately available for next customer |
| **Auto-Release** | Expired soft-lock TTL sweeper | Slots with past `expires_at` automatically reset to `AVAILABLE` |
| **Security** | Anti-spoofing client redirect | Direct `/checkout/success` navigation without webhook never approves order |
| **Security** | Tampered webhook signature | Invalid HMAC SHA-256 header rejected with HTTP 401/403 |
| **Security** | Unapproved payment webhook | Payment status `rejected` / `cancelled` marks order failed, not approved |

### Tier 3: Cross-Feature Combinations & State Transitions (10 Tests)
| Test Case | Description | Expected State Transition |
|---|---|---|
| **Form Dynamic Switch** | Switch between 1-carta and 5-cartas forms | Dynamically updates required fields (`core_focus` becomes mandatory) |
| **Slot to Webhook Approval** | Full happy-path state machine | `AVAILABLE` -> `SOFT_LOCKED` -> `BOOKED` (Order `PENDING` -> `APPROVED`) |
| **Slot to Payment Rejection** | Failed payment recovery | `AVAILABLE` -> `SOFT_LOCKED` -> `AVAILABLE` (Order `PENDING` -> `REJECTED`) |
| **Slot to Payment Cancel** | Cancelled payment recovery | Soft-lock immediately released back to `AVAILABLE` |
| **Webhook Idempotency** | 5 duplicate `approved` webhooks | Processed exactly once, returns HTTP 200, sends 1 email to Claudia |
| **Rejection Idempotency** | Duplicate `rejected` webhooks | Safe idempotent execution without database locks or crashes |
| **Order Status Polling** | Client polling during webhook receipt | Seamless transition from `PENDING` to `APPROVED` with 24h/time details |
| **Claudia Email Integrity** | Verify practitioner email payload | Contains Customer Name, DOB, Tier, Category, Amount, Question, Slot |
| **Customer Email Integrity** | Verify client email payload | Contains 24h turnaround SLA (cards) or confirmed appointment (call) |
| **Pluggable Fallback** | Unconfigured SMTP/Resend | Logs structured payload to mock transport without throwing exceptions |

### Tier 4: Real-World Application Workflows (5 Tests)
| Test Case | Workflow Summary |
|---|---|
| **4.1 Async 3-Cards Lifecycle** | Selection -> Preference creation -> Webhook approval -> Claudia email -> Customer confirmation -> Status check (24h promise) |
| **4.2 Call Booking Lifecycle** | Slot query -> Soft-lock hold -> Preference creation -> Webhook approval -> Permanent booking -> Appointment view |
| **4.3 Declined Slot Recovery** | User A soft-locks slot -> User B blocked (409) -> User A payment declined -> Slot auto-unlocked -> User B successfully books |
| **4.4 Overbooking Defense** | Webhook payment arrives after lock TTL expiration when slot was re-booked -> Flags order for rescheduling, preserves User 2 slot |
| **4.5 Multi-Tier Concurrent Batch** | Simultaneous simulated orders across all 4 tiers without database corruption or state leakage |

---

## Execution Instructions

### Running All Tests
```bash
node tests/e2e/run-all.js
```

### Running Individual Tiers
```bash
# Tier 1: Feature Coverage
node --test tests/e2e/tier1-feature-coverage.test.js

# Tier 2: Boundary & Concurrency
node --test tests/e2e/tier2-boundary-concurrency.test.js

# Tier 3: Cross-Feature Combinations
node --test tests/e2e/tier3-cross-feature.test.js

# Tier 4: Real-World Scenarios
node --test tests/e2e/tier4-real-world-scenarios.test.js
```

### Running Against Live Server
```bash
TEST_BASE_URL=http://localhost:3000 node tests/e2e/run-all.js
```

---

## Verification Criteria & Expected Outputs
- **HTTP Status Codes**:
  - `200 OK`: Successful preference creation, slot lock, webhook receipt, status check.
  - `400 Bad Request`: Validation failure on missing/invalid input fields.
  - `401 / 403 Unauthorized/Forbidden`: Invalid or tampered webhook HMAC signature.
  - `409 Conflict`: Attempt to soft-lock or book an unavailable/held slot.
- **Pricing Invariants**:
  - 1 carta = `$150 MXN`
  - 3 cartas = `$350 MXN`
  - 5 cartas = `$500 MXN`
  - Sesión por llamada = `$450 MXN`
- **Language & Localization**:
  - 100% natural Mexican Spanish copy in confirmation messages, validation hints, FAQ, and email templates.
