# Lumina Umay — Milestone 3: Order Email Dispatcher Architecture & Investigation Report

**Agent**: `explorer_m3_1`  
**Milestone**: Milestone 3 (Order Email Dispatcher)  
**Target Working Directory**: `c:/LUMINAPROJECT/.agents/explorer_m3_1`  
**Date**: 2026-08-16T22:00:00Z  
**Status**: `INVESTIGATION_COMPLETE`

---

## 1. Executive Summary & Problem Scope

In Lumina Umay, upon receiving an approved Mercado Pago payment webhook (`payment.status === 'approved'`), two critical transaction emails must be dispatched:
1. **Practitioner Notification to Claudia** (`claudia@luminaumay.com`): Contains 100% of the customer and consultation context (customer name, email, phone, birthdate, tier name, category, specific question/situation, involved person(s), core focus for 5 cartas, and booked CDMX time slot for live call sessions).
2. **Customer Order Confirmation & Receipt**: Provides order receipt details, setting clear customer expectations — specifically the **24-hour turnaround SLA** for asynchronous card readings (1, 3, 5 cartas) or confirmed **CDMX appointment date/time** and session preparation guidelines for live call sessions.

### Key Milestone 3 Objectives
1. **Pluggable Multi-Provider Transport Architecture**:
   - Configurable in `src/server/config.ts` via `EMAIL_PROVIDER`: `'smtp' | 'resend' | 'mock' | 'console'`.
   - Robust SMTP delivery using `nodemailer` (already installed).
   - Direct Resend REST API integration via native `fetch` with Bearer token authentication.
   - Safe in-memory sink (`MockEmailProvider`) and `ConsoleEmailProvider` for zero-credential development, CI/CD, and test suite verification.
   - Dynamic graceful fallback: if live credentials are missing or an external provider encounters a network error, the dispatcher falls back to the in-memory sink without throwing uncaught exceptions or blocking webhook completion.
2. **Luxury Brand-Aligned HTML Email Templates in Mexican Spanish**:
   - Lumina design tokens: `--teal: #0d2b2a`, `--teal-deep: #081d1c`, `--gold: #d4af37`, `--cream: #fbf8f2`.
   - Typography styling: Cormorant Garamond serif headings and Jost / clean sans-serif body text.
   - Claudia Notification Template (`src/server/templates/claudia-notification.html`).
   - Customer Confirmation Template (`src/server/templates/customer-confirmation.html`).
   - Full HTML sanitization / escaping to protect against XSS injection from untrusted customer inputs.
3. **Multipart MIME Generation (HTML + Plaintext Fallback)**:
   - Synchronized plaintext generator producing pristine, structured plaintext copies for terminal clients, accessibility, and strict domain test assertion matching.
4. **Comprehensive Unit Test Suite (`tests/unit/email.service.test.ts`)**:
   - Testing all 4 provider modes, template rendering, XSS sanitization, 24h async SLA vs call appointment logic, and fallback resilience.

---

## 2. Current Codebase Assessment & Gap Analysis

### 2.1 Current `EmailService` State (`src/server/services/email.service.ts`)
The existing `EmailService` in Milestone 2 was a minimal in-memory stub that:
- Accumulated plaintext objects in `private static capturedEmails: CapturedEmail[]`.
- Formatted basic plaintext strings for Claudia and the customer.
- Had no HTML template compilation or email file assets.
- Did not integrate with `nodemailer` or Resend REST API.
- Did not support configurable transports (`smtp`, `resend`, `console`, `mock`).

### 2.2 Current Configuration (`src/server/config.ts`)
- Defines basic `emailProvider`, `claudiaNotificationEmail`, `smtpHost`, `smtpPort`, `smtpUser`, `smtpPass`.
- Lacks `resendApiKey`, `emailFrom`, and `smtpSecure` typed configuration options.

### 2.3 Compatibility Invariants
- **Opaque-Box E2E Tests (`tests/e2e/`)**: E2E test helpers (`assertion-helpers.js`, `tier3-cross-feature.test.js`) query `GET /api/test/emails` which reads `EmailService.getCapturedEmails()`.
- **Domain Assertions**:
  - `assertClaudiaEmailPayload`: verifies `email.to` includes Claudia, and `email.body` includes `customer_name`, `customer_birthdate`, `category`, `question`, optional `involved_names`, optional `core_focus`, and `slot_date`.
  - `assertCustomerEmailPayload`: verifies `email.to === customer_email`, and `email.body` includes `"24 horas"` for async tiers or call appointment details.
- **Idempotency**: Webhook deduplication must ensure repeated webhook events do NOT dispatch duplicate emails.

---

## 3. Pluggable Multi-Provider Transport Architecture

### 3.1 Domain Types & Interfaces
```typescript
export interface EmailPayload {
  to: string;
  from?: string;
  subject: string;
  text: string;
  html: string;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  provider: 'mock' | 'console' | 'smtp' | 'resend';
  error?: string;
}

export interface CapturedEmail {
  to: string;
  from: string;
  subject: string;
  body: string; // Plaintext representation for backwards compatibility & test assertions
  html?: string;
  date: string;
  provider?: string;
}

export interface IEmailProvider {
  name: 'mock' | 'console' | 'smtp' | 'resend';
  sendEmail(payload: EmailPayload): Promise<SendEmailResult>;
}
```

### 3.2 Provider Implementations

#### 1. `MockEmailProvider` (In-Memory Sink)
- Default for tests (`NODE_ENV === 'test'`) and offline development (`EMAIL_PROVIDER === 'mock'`).
- Saves every email payload to `EmailService.capturedEmails`.
- Returns `{ success: true, messageId: 'mock-' + uuid(), provider: 'mock' }`.
- Zero network I/O; 100% deterministic.

#### 2. `ConsoleEmailProvider` (Local CLI Output)
- Formats email with header borders, subject, recipient, and plaintext content using `console.log`.
- In non-production environments, also writes to `EmailService.capturedEmails` for inspection.
- Returns `{ success: true, messageId: 'console-' + Date.now(), provider: 'console' }`.

#### 3. `SmtpEmailProvider` (Nodemailer Integration)
- Uses `nodemailer.createTransport`:
  ```typescript
  import nodemailer from 'nodemailer';
  
  export class SmtpEmailProvider implements IEmailProvider {
    name = 'smtp' as const;
    private transporter: nodemailer.Transporter | null = null;
    
    constructor(private config: AppConfig) {
      if (this.config.smtpUser && this.config.smtpPass) {
        this.transporter = nodemailer.createTransport({
          host: this.config.smtpHost,
          port: this.config.smtpPort,
          secure: this.config.smtpSecure || this.config.smtpPort === 465,
          auth: {
            user: this.config.smtpUser,
            pass: this.config.smtpPass,
          },
        });
      }
    }

    async sendEmail(payload: EmailPayload): Promise<SendEmailResult> {
      if (!this.transporter) {
        console.warn('[EmailService] SMTP credentials missing. Falling back to mock capture.');
        return MockEmailProvider.record(payload, 'smtp-fallback');
      }
      try {
        const info = await this.transporter.sendMail({
          from: payload.from || this.config.emailFrom,
          to: payload.to,
          subject: payload.subject,
          text: payload.text,
          html: payload.html,
        });
        return { success: true, messageId: info.messageId, provider: 'smtp' };
      } catch (err: any) {
        console.error('[EmailService] SMTP send error:', err.message);
        MockEmailProvider.record(payload, 'smtp-error-fallback');
        return { success: false, error: err.message, provider: 'smtp' };
      }
    }
  }
  ```

#### 4. `ResendEmailProvider` (REST API Integration)
- Uses standard Node.js `fetch` to call `POST https://api.resend.com/emails`:
  ```typescript
  export class ResendEmailProvider implements IEmailProvider {
    name = 'resend' as const;
    
    constructor(private config: AppConfig) {}

    async sendEmail(payload: EmailPayload): Promise<SendEmailResult> {
      if (!this.config.resendApiKey) {
        console.warn('[EmailService] Resend API key missing. Falling back to mock capture.');
        return MockEmailProvider.record(payload, 'resend-fallback');
      }
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: payload.from || this.config.emailFrom,
            to: [payload.to],
            subject: payload.subject,
            text: payload.text,
            html: payload.html,
          }),
        });

        if (!res.ok) {
          const errBody = await res.text();
          console.error('[EmailService] Resend API error:', res.status, errBody);
          MockEmailProvider.record(payload, 'resend-api-error-fallback');
          return { success: false, error: errBody, provider: 'resend' };
        }

        const data = await res.json() as { id?: string };
        return { success: true, messageId: data.id, provider: 'resend' };
      } catch (err: any) {
        console.error('[EmailService] Resend network error:', err.message);
        MockEmailProvider.record(payload, 'resend-network-error-fallback');
        return { success: false, error: err.message, provider: 'resend' };
      }
    }
  }
  ```

### 3.3 Dynamic Provider Factory & Resilience Strategy
- In `EmailService`:
  ```typescript
  public static getProvider(): IEmailProvider {
    const providerKey = (config.emailProvider || 'mock').toLowerCase();
    switch (providerKey) {
      case 'smtp':
        return new SmtpEmailProvider(config);
      case 'resend':
        return new ResendEmailProvider(config);
      case 'console':
        return new ConsoleEmailProvider();
      case 'mock':
      default:
        return new MockEmailProvider();
    }
  }
  ```
- **Universal Capture Invariant**: To guarantee that testing tools, E2E assertions, and audit logs continue working seamlessly, whenever `sendOrderNotificationToClaudia` or `sendConfirmationToCustomer` is called, the email is recorded in `capturedEmails` in addition to delegating to the configured transport.

---

## 4. Mexican Spanish HTML Email Templates & Visual Design

### 4.1 Lumina Umay Brand Design Tokens
- **Primary Teal Background / Accents**: `#0d2b2a`
- **Deep Midnight Teal**: `#081d1c`
- **Mystic Gold / Borders / Badges**: `#d4af37`
- **Soft Cream Background**: `#fbf8f2`
- **Body Text Color**: `#2c3e50` / `#1a202c` on cream, `#fbf8f2` on dark
- **Font Stack**:
  - Headings: `'Cormorant Garamond', 'Times New Roman', Georgia, serif`
  - Body / Data: `'Jost', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`

### 4.2 Template 1: Claudia Notification (`src/server/templates/claudia-notification.html`)
- **File Location**: `src/server/templates/claudia-notification.html`
- **Layout & Structure**:
  1. **Header Banner**: Dark Teal (`#0d2b2a`) background with centered gold logo title `"LUMINA UMAY"` and subtitle `"Nueva Consulta Pagada"`.
  2. **Order Metadata Box**: Gold-bordered card showing Order ID, Mercado Pago Payment ID, Amount (`$XXX MXN`), and Mexican Central Time (`CDMX`) timestamp.
  3. **Section 1 — Datos del Consultante**:
     - Nombre completo: `{{customer_name}}`
     - Correo electrónico: `{{customer_email}}`
     - Teléfono: `{{customer_phone}}` (or `"No proporcionado"`)
     - Fecha de nacimiento: `{{customer_birthdate}}`
  4. **Section 2 — Detalles del Servicio**:
     - Nivel / Tier: `{{tier_name}}` (`$ {{amount_mxn}} MXN`)
     - Categoría: `{{category}}` (`Amor`, `Trabajo/Dinero`, `Familia`, `Otro`)
     - Pregunta / Situación: `{{question}}`
     - Personas involucradas: `{{involved_names}}` (rendered if present)
     - Qué es lo que más deseas saber: `{{core_focus}}` (rendered for 5 cartas)
  5. **Section 3 — Cita de Llamada en Vivo** (Conditional for `llamada` / `call_session`):
     - Gold highlight card: Date `{{slot_date}}`, Horario `{{slot_time_start}} - {{slot_time_end}} hrs (Hora CDMX)`.
  6. **Section 4 — Compromiso de Entrega Async** (Conditional for async tiers):
     - `"Recordatorio: La lectura debe ser entregada al consultante en un plazo máximo de 24 horas."`
  7. **Footer**: Gold accent rule with sign-off `"Lumina Umay • Portal de Lecturas y Sabiduría Ancestral"`.

### 4.3 Template 2: Customer Confirmation (`src/server/templates/customer-confirmation.html`)
- **File Location**: `src/server/templates/customer-confirmation.html`
- **Layout & Structure**:
  1. **Header Banner**: Deep Teal (`#0d2b2a`) with gold Lumina Umay insignia and greeting `"¡Gracias por tu confianza!"`.
  2. **Personalized Intro**: `"¡Hola {{customer_name}}! Hemos recibido tu pago con éxito y tu consulta ha sido registrada."`
  3. **Conditional Delivery / Session Section**:
     - **For Async Readings (1, 3, 5 cartas)**:
       - **Garantía de Entrega (24 Horas)**: Highlight box stating: `"Claudia revisará tu consulta con total dedicación. Recibirás tu lectura detallada en un plazo máximo de 24 horas directamente a este correo electrónico."`
     - **For Live Call Sessions (`llamada`)**:
       - **Cita Confirmada**: Date `{{slot_date}}`, Horario `{{slot_time_start}} - {{slot_time_end}} hrs (Hora de la Ciudad de México)`.
       - Advice: `"Te recomendamos estar en un espacio tranquilo y libre de distracciones 5 minutos antes de la hora programada."`
  4. **Order Summary Card**:
     - Número de Orden: `{{order_id}}`
     - Servicio: `{{tier_name}}`
     - Categoría: `{{category}}`
     - Total Pagado: `$ {{amount_mxn}} MXN`
     - Tu Pregunta: `{{question}}`
  5. **Footer**: Warm Mexican Spanish blessing `"Con luz, gratitud y bendiciones,\nClaudia — Lumina Umay"`.

### 4.4 XSS Sanitization & HTML Escaping
To prevent malicious script injection or HTML breakage when customer inputs contain `<script>` or HTML entities:
```typescript
export function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
```

---

## 5. Multipart MIME & Synchronized Plaintext Generation

Every email dispatched across SMTP or Resend consists of a multipart MIME message (`multipart/alternative`) containing:
1. `html`: Rich, responsive HTML rendered from the branded Mexican Spanish template.
2. `text`: Clean, beautifully structured plaintext body.

### 5.1 Claudia Plaintext Format
```
¡Hola Claudia!

Se ha confirmado un nuevo pago para una sesión en Lumina Umay.

--- DETALLES DEL CONSULTANTE ---
Nombre: {{customer_name}}
Correo Electrónico: {{customer_email}}
Teléfono: {{customer_phone}}
Fecha de Nacimiento: {{customer_birthdate}}

--- DETALLES DEL SERVICIO ---
Servicio: {{tier_name}} (${{amount_mxn}} MXN)
Categoría: {{category}}
Pregunta / Situación: {{question}}
Personas Involucradas: {{involved_names}}
Qué es lo que más deseas saber (Enfoque): {{core_focus}}

--- HORARIO DE LLAMADA RESERVADO ---
Fecha: {{slot_date}}
Horario: {{slot_time_start}} - {{slot_time_end}} hrs (CDMX)

Identificador de Orden: {{order_id}}
ID de Pago Mercado Pago: {{mp_payment_id}}
Fecha de Confirmación: {{date}}
```

### 5.2 Customer Plaintext Format
```
¡Hola {{customer_name}}!

Muchas gracias por confiar en Lumina Umay. Hemos recibido tu pago con éxito.

[For Async Readings]:
Tu orden para {{tier_name}} ha sido confirmada.
Responderemos en un plazo máximo de 24 horas a tu correo electrónico con tu lectura e interpretación detallada.

[For Live Call]:
Tu sesión por llamada ha sido agendada y confirmada exitosamente:
Fecha: {{slot_date}}
Horario: {{slot_time_start}} - {{slot_time_end}} hrs (Hora Ciudad de México).
Claudia se conectará contigo puntualmente a través del enlace que recibirás antes de la sesión.

--- Resumen de tu pedido ---
Orden: {{order_id}}
Servicio: {{tier_name}}
Categoría: {{category}}
Total pagado: ${{amount_mxn}} MXN
Pregunta: {{question}}

Con luz y gratitud,
Lumina Umay
```

---

## 6. Template Compiler & Service Engine Design

### 6.1 Template Engine (`src/server/services/template.service.ts` or embedded in `email.service.ts`)
- Compiles templates dynamically with cache/in-memory fallback if template files are missing or read asynchronously.
- Reads `claudia-notification.html` and `customer-confirmation.html` from `src/server/templates/` (and falls back to embedded safe HTML strings).
- Performs variable substitution (`{{key}}`) and simple conditional block evaluation (`{{#if is_call}} ... {{else}} ... {{/if}}`).

### 6.2 Updated Configuration (`src/server/config.ts`)
```typescript
export interface AppConfig {
  port: number;
  nodeEnv: string;
  corsOrigin: string;
  dbPath: string;
  slotLockTtlMinutes: number;
  mpAccessToken: string;
  mpWebhookSecret: string;
  emailProvider: 'smtp' | 'resend' | 'mock' | 'console';
  emailFrom: string;
  claudiaNotificationEmail: string;
  resendApiKey: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
}
```

---

## 7. Comprehensive Test Suite Design (`tests/unit/email.service.test.ts`)

A dedicated test suite in `tests/unit/email.service.test.ts` (executed via `vitest run tests/unit/email.service.test.ts`) covering:

### 1. Multi-Provider Transport Selection & Execution
- **Test 1.1**: `MockEmailProvider` captures emails in `EmailService.capturedEmails` and returns success.
- **Test 1.2**: `ConsoleEmailProvider` logs to console and captures in development mode.
- **Test 1.3**: `SmtpEmailProvider` creates transporter and handles nodemailer dispatch.
- **Test 1.4**: `ResendEmailProvider` formats REST API POST request with Bearer authorization.
- **Test 1.5**: Graceful fallback: unconfigured SMTP credentials fall back to mock sink without throwing.
- **Test 1.6**: Graceful fallback: unconfigured Resend API key falls back to mock sink without throwing.

### 2. Claudia Order Notification Email
- **Test 2.1**: 1-Carta order generates complete Claudia email with name, DOB, category, question, and $150 MXN.
- **Test 2.2**: 3-Cartas order with optional involved person includes `involved_names` in both HTML and plaintext.
- **Test 2.3**: 5-Cartas order includes `core_focus` ("Qué es lo que más deseas saber") and `involved_names`.
- **Test 2.4**: Call session order includes CDMX appointment date, time start, and time end.
- **Test 2.5**: HTML escaping: XSS payloads (`<script>alert('xss')</script>`) are safely escaped in HTML output.

### 3. Customer Confirmation Email
- **Test 3.1**: Async readings (1, 3, 5 cartas) strictly include the **24-hour turnaround SLA** (`24 horas`) in Mexican Spanish.
- **Test 3.2**: Live call session strictly includes confirmed appointment slot date, time, and session prep guidance.
- **Test 3.3**: Customer email includes complete order receipt summary (Order ID, tier name, category, total MXN).
- **Test 3.4**: Customer email is sent directly to `customer_email`.

### 4. Multipart MIME & Template Integrity
- **Test 4.1**: Dispatched emails contain both non-empty `html` and `body` (plaintext).
- **Test 4.2**: HTML contains Lumina brand color tokens (`#0d2b2a`, `#d4af37`, `#fbf8f2`).
- **Test 4.3**: Plaintext body matches domain helper assertions (`assertClaudiaEmailPayload`, `assertCustomerEmailPayload`).
- **Test 4.4**: `EmailService.clearCapturedEmails()` cleanly resets in-memory sink.

---

## 8. Concrete Implementation Blueprint for Builder Agent

| Step | Target File | Action | Details |
|---|---|---|---|
| 1 | `src/server/config.ts` | Update | Add `emailFrom`, `resendApiKey`, `smtpSecure` and type `emailProvider` as `'smtp' \| 'resend' \| 'mock' \| 'console'`. |
| 2 | `src/server/templates/claudia-notification.html` | Create | Create responsive HTML template in Mexican Spanish with Lumina brand colors, typography, order box, and conditional slot / async sections. |
| 3 | `src/server/templates/customer-confirmation.html` | Create | Create responsive HTML customer receipt template with 24h async SLA or call appointment info. |
| 4 | `src/server/services/email.service.ts` | Enhance | Implement provider classes (`MockEmailProvider`, `ConsoleEmailProvider`, `SmtpEmailProvider`, `ResendEmailProvider`), dynamic provider factory, template renderer, XSS escaper, and multipart MIME dispatch. |
| 5 | `tests/unit/email.service.test.ts` | Create | Author comprehensive unit test suite covering all providers, templates, MIME multipart generation, and Mexican Spanish domain assertions. |
| 6 | Build & Verification | Test | Run `npm test`, `node tests/e2e/run-all.js`, `npm run typecheck`, `npm run build`. |

---

## 9. Conclusion

Milestone 3 investigation is complete. The multi-provider architecture, Mexican Spanish HTML templates, plaintext synchronization, and test suite design are fully architected, ensuring total brand consistency, zero regressions on existing E2E tests, and fault-tolerant email dispatching.
