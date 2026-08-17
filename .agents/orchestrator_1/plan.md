# Project Orchestration Plan: Lumina Umay Booking & Payment System

## Overview
Lumina Umay requires a production-ready, clean, well-architected booking and payment web application with:
1. **Multi-tier Async Readings (Category A)**: 1 carta ($150 MXN), 3 cartas ($350 MXN), 5 cartas ($500 MXN) with tier-specific form fields, mandatory category dropdown, birthdate, and question.
2. **Live Call Session Slot Booking & Concurrency (Category B)**: $450 MXN (or standard call price), real-time availability, soft-lock mechanism on checkout attempt, automatic lock release on timeout/failure, permanent confirmation upon payment approval, race-condition immunity.
3. **Mercado Pago Checkout & Webhook Verification**: Server-side preference creation, secure webhook validation (`approved` status required for order/slot confirmation), protection against direct client-side redirect spoofing.
4. **Order Email Dispatching**: Comprehensive order payload email to Claudia (and customer confirmation), robust fallback/test provider modes.
5. **UI/UX Preservation & Mexican Spanish FAQ**: Maintain visual design system (Cormorant Garamond, Jost, color palette: `--teal`, `--teal-deep`, `--gold`, `--cream`), mobile app-shell experience, replace WhatsApp CTA with interactive accordion FAQ in Mexican Spanish.

## Architectural Approach
- **Stack**: Node.js / TypeScript / Express (or Fastify) backend with SQLite (Better-SQLite3 or Prisma / Kysely / Drizzle) for ACID transactions & soft-locking, integrated with modern frontend (HTML5/CSS3/Vanilla JS or React/Vite preserving exact tokens).
- **Dual Track Orchestration**:
  - **Track 1 (E2E Testing Track)**: Independent test suite architecture, comprehensive test cases spanning Tier 1 (Feature Coverage), Tier 2 (Boundary & Concurrency), Tier 3 (Cross-Feature Combinations), Tier 4 (Real-World Workflows).
  - **Track 2 (Implementation Track)**:
    - Step 0: Survey & Requirements Mapping (Spec Miner + Explorers)
    - Milestone 1: Core Database, Models, Slot Booking & Concurrency Soft-Lock Engine
    - Milestone 2: Mercado Pago Integration & Server Webhook Verification
    - Milestone 3: Order Email Dispatch & Notification System
    - Milestone 4: Frontend UI, Dynamic Forms, Design System & Mexican Spanish FAQ Accordion
    - Milestone 5: Full E2E Test Suite Execution & Tier 5 Adversarial Coverage Hardening

## Iteration & Verification Loop
For each milestone:
1. 3 Explorers (or Spec Miner + Explorers) analyze scope and propose implementation strategy.
2. 1 Worker implements source code, unit tests, and verifies builds.
3. 2 Reviewers independently evaluate code quality, security, and interface compliance.
4. 2 Challengers adversarially stress-test edge cases (concurrency collisions, spoofed webhooks, malformed inputs).
5. 1 Forensic Auditor verifies absolute integrity (no mock-skipping, no hardcoded cheating, genuine implementation).
6. Gate evaluated strictly before milestone sign-off.
