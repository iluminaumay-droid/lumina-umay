import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import nodemailer from 'nodemailer';
import {
  EmailService,
  MockEmailProvider,
  ConsoleEmailProvider,
  SmtpEmailProvider,
  ResendEmailProvider,
  escapeHtml,
  EmailPayload,
} from '../../src/server/services/email.service.js';
import { config, AppConfig } from '../../src/server/config.js';
import { Order } from '../../src/server/types/checkout.types.js';

describe('Milestone 3 Unit Test Suite: Order Email Dispatcher, Templates & Multi-Provider Architecture', () => {
  beforeEach(() => {
    EmailService.clearCapturedEmails();
    EmailService.resetProvider();
  });

  afterEach(() => {
    EmailService.clearCapturedEmails();
    EmailService.resetProvider();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. XSS SANITIZATION & HTML ESCAPING
  // =========================================================================
  describe('1. XSS Sanitization & HTML Escaping', () => {
    it('1.1: Correctly escapes dangerous HTML entities and malicious script tags', () => {
      expect(escapeHtml('<script>alert("XSS")</script>')).toBe(
        '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;'
      );
      expect(escapeHtml("John & Jane's <Story>")).toBe(
        'John &amp; Jane&#039;s &lt;Story&gt;'
      );
      expect(escapeHtml('"quoted" & <tagged>')).toBe(
        '&quot;quoted&quot; &amp; &lt;tagged&gt;'
      );
    });

    it('1.2: Safely handles null, undefined, numbers, and boolean values', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
      expect(escapeHtml('')).toBe('');
      expect(escapeHtml(150)).toBe('150');
      expect(escapeHtml(true)).toBe('true');
    });
  });

  // =========================================================================
  // 2. MULTI-PROVIDER ARCHITECTURE & FALLBACK BEHAVIOR
  // =========================================================================
  describe('2. Multi-Provider Architecture & Fallback Resilience', () => {
    const samplePayload: EmailPayload = {
      to: 'cliente@example.com',
      from: 'Lumina Umay <contacto@luminaumay.com>',
      subject: 'Prueba de Despacho',
      text: 'Contenido en texto plano para cliente.',
      html: '<p>Contenido en HTML para cliente.</p>',
    };

    it('2.1 MockEmailProvider: Captures emails in memory without network I/O', async () => {
      const provider = new MockEmailProvider();
      const result = await provider.sendEmail(samplePayload);

      expect(result.success).toBe(true);
      expect(result.provider).toBe('mock');
      expect(result.messageId).toContain('mock-');

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(1);
      expect(captured[0].to).toBe(samplePayload.to);
      expect(captured[0].subject).toBe(samplePayload.subject);
      expect(captured[0].body).toBe(samplePayload.text);
      expect(captured[0].html).toBe(samplePayload.html);
      expect(captured[0].provider).toBe('mock');
    });

    it('2.2 ConsoleEmailProvider: Formats console log and captures email record', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const provider = new ConsoleEmailProvider();
      const result = await provider.sendEmail(samplePayload);

      expect(result.success).toBe(true);
      expect(result.provider).toBe('console');
      expect(consoleSpy).toHaveBeenCalled();

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(1);
      expect(captured[0].to).toBe(samplePayload.to);
      expect(captured[0].provider).toBe('console');
    });

    it('2.3 SmtpEmailProvider: Falls back gracefully to mock capture when unconfigured', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const unconfiguredConfig: AppConfig = {
        ...config,
        smtpHost: '',
        smtpUser: '',
        smtpPass: '',
      };

      const provider = new SmtpEmailProvider(unconfiguredConfig);
      const result = await provider.sendEmail(samplePayload);

      expect(result.success).toBe(true);
      expect(result.provider).toBe('smtp');
      expect(result.fallbackUsed).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('SMTP credentials not configured'));

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(1);
      expect(captured[0].provider).toBe('smtp-fallback');
    });

    it('2.4 SmtpEmailProvider: Successfully sends email via Nodemailer transporter', async () => {
      const sendMailMock = vi.fn().mockResolvedValue({ messageId: 'smtp-msg-abc-123' });
      vi.spyOn(nodemailer, 'createTransport').mockReturnValue({
        sendMail: sendMailMock,
      } as any);

      const smtpConfig: AppConfig = {
        ...config,
        smtpHost: 'smtp.mailgun.org',
        smtpPort: 587,
        smtpSecure: false,
        smtpUser: 'lumina_user',
        smtpPass: 'lumina_secret_pass',
      };

      const provider = new SmtpEmailProvider(smtpConfig);
      const result = await provider.sendEmail(samplePayload);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('smtp-msg-abc-123');
      expect(result.provider).toBe('smtp');
      expect(sendMailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          to: samplePayload.to,
          subject: samplePayload.subject,
          text: samplePayload.text,
          html: samplePayload.html,
        })
      );

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(1);
      expect(captured[0].provider).toBe('smtp');
    });

    it('2.5 SmtpEmailProvider: Catches transport errors and records fallback without crashing', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const sendMailMock = vi.fn().mockRejectedValue(new Error('Connection timeout to SMTP server'));
      vi.spyOn(nodemailer, 'createTransport').mockReturnValue({
        sendMail: sendMailMock,
      } as any);

      const smtpConfig: AppConfig = {
        ...config,
        smtpHost: 'smtp.mailgun.org',
        smtpUser: 'lumina_user',
        smtpPass: 'lumina_secret_pass',
      };

      const provider = new SmtpEmailProvider(smtpConfig);
      const result = await provider.sendEmail(samplePayload);

      expect(result.success).toBe(false);
      expect(result.fallbackUsed).toBe(true);
      expect(result.error).toContain('Connection timeout');
      expect(errorSpy).toHaveBeenCalled();

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(1);
      expect(captured[0].provider).toBe('smtp-error-fallback');
    });

    it('2.6 ResendEmailProvider: Falls back gracefully to mock capture when API key is missing', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const unconfiguredConfig: AppConfig = {
        ...config,
        resendApiKey: '',
      };

      const provider = new ResendEmailProvider(unconfiguredConfig);
      const result = await provider.sendEmail(samplePayload);

      expect(result.success).toBe(true);
      expect(result.provider).toBe('resend');
      expect(result.fallbackUsed).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Resend API key not configured'));

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(1);
      expect(captured[0].provider).toBe('resend-fallback');
    });

    it('2.7 ResendEmailProvider: Successfully dispatches via Native Fetch REST API', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'resend_id_998877' }),
      });
      global.fetch = fetchMock as any;

      const resendConfig: AppConfig = {
        ...config,
        resendApiKey: 're_123456789_abcdef',
      };

      const provider = new ResendEmailProvider(resendConfig);
      const result = await provider.sendEmail(samplePayload);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('resend_id_998877');
      expect(result.provider).toBe('resend');

      expect(fetchMock).toHaveBeenCalledWith('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer re_123456789_abcdef',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: samplePayload.from,
          to: [samplePayload.to],
          subject: samplePayload.subject,
          text: samplePayload.text,
          html: samplePayload.html,
        }),
      });

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(1);
      expect(captured[0].provider).toBe('resend');
    });

    it('2.8 ResendEmailProvider: Handles API errors (4xx/5xx) and records fallback', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'Invalid domain sender verification',
      });
      global.fetch = fetchMock as any;

      const resendConfig: AppConfig = {
        ...config,
        resendApiKey: 're_invalid_key',
      };

      const provider = new ResendEmailProvider(resendConfig);
      const result = await provider.sendEmail(samplePayload);

      expect(result.success).toBe(false);
      expect(result.fallbackUsed).toBe(true);
      expect(result.error).toContain('Invalid domain sender');
      expect(errorSpy).toHaveBeenCalled();

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(1);
      expect(captured[0].provider).toBe('resend-api-error-fallback');
    });

    it('2.9 ResendEmailProvider: Catches fetch network rejection and records fallback', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const fetchMock = vi.fn().mockRejectedValue(new Error('Fetch network failure / DNS error'));
      global.fetch = fetchMock as any;

      const resendConfig: AppConfig = {
        ...config,
        resendApiKey: 're_test_key',
      };

      const provider = new ResendEmailProvider(resendConfig);
      const result = await provider.sendEmail(samplePayload);

      expect(result.success).toBe(false);
      expect(result.fallbackUsed).toBe(true);
      expect(result.error).toContain('DNS error');
      expect(errorSpy).toHaveBeenCalled();

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(1);
      expect(captured[0].provider).toBe('resend-network-error-fallback');
    });
  });

  // Helper to create fully typed Order objects
  function createSampleOrder(overrides: Partial<Order> = {}): Order {
    return {
      id: 'ord_' + Math.random().toString(36).substring(2, 9),
      tier_id: '1_carta',
      category: 'Amor',
      amount_mxn: 150,
      customer_name: 'Santiago Garza',
      customer_email: 'santiago@example.com',
      customer_birthdate: '1991-03-24',
      question: 'Pregunta de consulta de prueba',
      status: 'approved',
      email_sent: 0,
      customer_email_sent: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...overrides,
    };
  }

  // =========================================================================
  // 3. CLAUDIA ORDER NOTIFICATION TEMPLATE & LOGIC
  // =========================================================================
  describe('3. Claudia Order Notification Email', () => {
    it('3.1: Generates 1-Carta async notification email with complete context', async () => {
      const order = createSampleOrder({
        id: 'ord_1c_test_001',
        tier_id: '1_carta',
        category: 'Trabajo/Dinero',
        amount_mxn: 150,
        customer_name: 'Santiago Garza',
        customer_email: 'santiago@example.com',
        customer_birthdate: '1991-03-24',
        customer_phone: '+528711234567',
        question: '¿Conseguiré la vacante de director financiero?',
        status: 'approved',
        mp_payment_id: 'mp_pay_112233',
      });

      await EmailService.sendOrderNotificationToClaudia(order);

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(1);
      const claudiaEmail = captured[0];

      expect(claudiaEmail.to).toBe(config.claudiaNotificationEmail);
      expect(claudiaEmail.subject).toContain('Santiago Garza');
      expect(claudiaEmail.subject).toContain('Lectura de 1 Carta');

      // Check Plaintext
      expect(claudiaEmail.body).toContain('Santiago Garza');
      expect(claudiaEmail.body).toContain('santiago@example.com');
      expect(claudiaEmail.body).toContain('+528711234567');
      expect(claudiaEmail.body).toContain('1991-03-24');
      expect(claudiaEmail.body).toContain('Trabajo/Dinero');
      expect(claudiaEmail.body).toContain('¿Conseguiré la vacante de director financiero?');
      expect(claudiaEmail.body).toContain('$150 MXN');
      expect(claudiaEmail.body).toContain('ord_1c_test_001');
      expect(claudiaEmail.body).toContain('mp_pay_112233');

      // Check HTML template
      expect(claudiaEmail.html).toBeDefined();
      expect(claudiaEmail.html).toContain('Santiago Garza');
      expect(claudiaEmail.html).toContain('santiago@example.com');
      expect(claudiaEmail.html).toContain('+528711234567');
      expect(claudiaEmail.html).toContain('1991-03-24');
      expect(claudiaEmail.html).toContain('Trabajo/Dinero');
      expect(claudiaEmail.html).toContain('150');
      expect(claudiaEmail.html).toContain('24 horas'); // Async SLA banner
      expect(claudiaEmail.html).toContain('#0d2b2a'); // Luxury brand color
      expect(claudiaEmail.html).toContain('#d4af37'); // Gold brand color
    });

    it('3.2: Generates 3-Cartas notification email with optional involved persons', async () => {
      const order = createSampleOrder({
        id: 'ord_3c_test_002',
        tier_id: '3_cartas',
        category: 'Amor',
        amount_mxn: 350,
        customer_name: 'Isabella Rios',
        customer_email: 'isabella@example.com',
        customer_birthdate: '1995-08-12',
        question: '¿Qué futuro tiene mi relación de pareja?',
        involved_names: 'Rodrigo Morales',
        status: 'approved',
        mp_payment_id: 'mp_pay_334455',
      });

      await EmailService.sendOrderNotificationToClaudia(order);

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(1);
      const email = captured[0];

      expect(email.body).toContain('Rodrigo Morales');
      expect(email.html).toContain('Rodrigo Morales');
      expect(email.body).toContain('$350 MXN');
      expect(email.html).toContain('350');
    });

    it('3.3: Generates 5-Cartas notification email with core focus and involved persons', async () => {
      const order = createSampleOrder({
        id: 'ord_5c_test_003',
        tier_id: '5_cartas',
        category: 'Familia',
        amount_mxn: 500,
        customer_name: 'Valeria Mendoza',
        customer_email: 'valeria@example.com',
        customer_birthdate: '1989-12-05',
        question: 'Situación compleja de herencia y armonía familiar',
        involved_names: 'Hermanos Mendoza',
        core_focus: 'Encontrar acuerdo pacífico y entendimiento mutuo',
        status: 'approved',
        mp_payment_id: 'mp_pay_556677',
      });

      await EmailService.sendOrderNotificationToClaudia(order);

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(1);
      const email = captured[0];

      expect(email.body).toContain('Hermanos Mendoza');
      expect(email.body).toContain('Encontrar acuerdo pacífico y entendimiento mutuo');
      expect(email.html).toContain('Hermanos Mendoza');
      expect(email.html).toContain('Encontrar acuerdo pacífico y entendimiento mutuo');
      expect(email.body).toContain('$500 MXN');
    });

    it('3.4: Generates Call Session notification email with CDMX slot reservation details', async () => {
      const order = createSampleOrder({
        id: 'ord_call_test_004',
        tier_id: 'llamada',
        category: 'Otro',
        amount_mxn: 450,
        customer_name: 'Mateo Cardenas',
        customer_email: 'mateo@example.com',
        customer_birthdate: '1992-06-18',
        question: 'Orientación general de vida y propósito personal',
        slot_id: 'slot_call_99',
        status: 'approved',
        mp_payment_id: 'mp_pay_call_009',
      });

      const slotDetails = {
        date: '2026-08-20',
        time_start: '16:00',
        time_end: '16:45',
      };

      await EmailService.sendOrderNotificationToClaudia(order, slotDetails);

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(1);
      const email = captured[0];

      expect(email.body).toContain('2026-08-20');
      expect(email.body).toContain('16:00 - 16:45 hrs (CDMX)');
      expect(email.html).toContain('2026-08-20');
      expect(email.html).toContain('16:00 - 16:45');
      expect(email.html).toContain('CDMX');
      expect(email.html).not.toContain('plazo máximo de 24 horas'); // Not an async reading
    });

    it('3.5: Prevents XSS in Claudia notification HTML template when question contains script tags', async () => {
      const order = createSampleOrder({
        id: 'ord_xss_test',
        tier_id: '1_carta',
        category: 'Amor',
        amount_mxn: 150,
        customer_name: 'Hacker <script>alert("name")</script>',
        customer_email: 'hacker@example.com',
        customer_birthdate: '1990-01-01',
        question: 'Pregunta con <img src="x" onerror="alert(1)"> y <script>bad()</script>',
        status: 'approved',
      });

      await EmailService.sendOrderNotificationToClaudia(order);

      const captured = EmailService.getCapturedEmails();
      const email = captured[0];

      expect(email.html).not.toContain('<script>alert("name")</script>');
      expect(email.html).not.toContain('<script>bad()</script>');
      expect(email.html).toContain('&lt;script&gt;alert(&quot;name&quot;)&lt;/script&gt;');
      expect(email.html).toContain('&lt;script&gt;bad()&lt;/script&gt;');
    });
  });

  // =========================================================================
  // 4. CUSTOMER CONFIRMATION TEMPLATE & LOGIC
  // =========================================================================
  describe('4. Customer Confirmation & Receipt Email', () => {
    it('4.1: Async reading (1, 3, 5 cartas) customer confirmation guarantees 24-hour turnaround SLA', async () => {
      const order = createSampleOrder({
        id: 'ord_cust_async_001',
        tier_id: '3_cartas',
        category: 'Trabajo/Dinero',
        amount_mxn: 350,
        customer_name: 'Fernanda Castillo',
        customer_email: 'fernanda@example.com',
        customer_birthdate: '1993-04-15',
        question: '¿Tendré crecimiento laboral en mi empleo actual?',
        status: 'approved',
        mp_payment_id: 'mp_cust_pay_350',
      });

      await EmailService.sendConfirmationToCustomer(order);

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(1);
      const email = captured[0];

      expect(email.to).toBe('fernanda@example.com');
      expect(email.subject).toContain('Confirmación de tu lectura — Lumina Umay');

      // Mexican Spanish SLA verification in plaintext & HTML
      expect(email.body.toLowerCase()).toContain('24 horas');
      expect(email.html).toContain('24 horas');
      expect(email.html).toContain('Fernanda Castillo');
      expect(email.html).toContain('350');
      expect(email.html).toContain('ord_cust_async_001');
      expect(email.html).toContain('Con luz, gratitud y bendiciones');
      expect(email.html).toContain('Claudia — Lumina Umay');
    });

    it('4.2: Live Call session customer confirmation provides confirmed CDMX appointment time and preparation advice', async () => {
      const order = createSampleOrder({
        id: 'ord_cust_call_002',
        tier_id: 'llamada',
        category: 'Amor',
        amount_mxn: 450,
        customer_name: 'Carlos Vela',
        customer_email: 'carlos@example.com',
        customer_birthdate: '1989-03-01',
        question: 'Consulta en llamada sobre decisiones de vida',
        slot_id: 'slot_call_777',
        status: 'approved',
        mp_payment_id: 'mp_cust_pay_call',
      });

      const slotDetails = {
        date: '2026-08-25',
        time_start: '18:00',
        time_end: '18:45',
      };

      await EmailService.sendConfirmationToCustomer(order, slotDetails);

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(1);
      const email = captured[0];

      expect(email.to).toBe('carlos@example.com');
      expect(email.body).toContain('2026-08-25');
      expect(email.body).toContain('18:00 - 18:45 hrs (Hora Ciudad de México)');
      expect(email.html).toContain('2026-08-25');
      expect(email.html).toContain('18:00 - 18:45 hrs (Hora de la Ciudad de México)');
      expect(email.html).toContain('espacio tranquilo');
      expect(email.html).not.toContain('Garantía de Entrega (24 Horas)');
    });

    it('4.3: Prevents XSS in Customer confirmation HTML template when input contains malicious payload', async () => {
      const order = createSampleOrder({
        id: 'ord_xss_cust',
        tier_id: '1_carta',
        category: 'Familia',
        amount_mxn: 150,
        customer_name: '<b onmouseover="alert(\'xss\')">Attacker</b>',
        customer_email: 'attacker@example.com',
        customer_birthdate: '1990-01-01',
        question: '¿Qué pasará? <script src="http://evil.com/payload.js"></script>',
        status: 'approved',
      });

      await EmailService.sendConfirmationToCustomer(order);

      const captured = EmailService.getCapturedEmails();
      const email = captured[0];

      expect(email.html).not.toContain('<b onmouseover=');
      expect(email.html).not.toContain('<script src=');
      expect(email.html).toContain('&lt;b onmouseover=&quot;alert(&#039;xss&#039;)&quot;&gt;Attacker&lt;/b&gt;');
      expect(email.html).toContain('&lt;script src=&quot;http://evil.com/payload.js&quot;&gt;&lt;/script&gt;');
    });
  });

  // =========================================================================
  // 5. MULTIPART MIME & IN-MEMORY SINK RECOVERY
  // =========================================================================
  describe('5. Multipart MIME & In-Memory Sink Management', () => {
    it('5.1: All dispatched emails populate both valid HTML and clean plain text bodies', async () => {
      const order = createSampleOrder({
        id: 'ord_mime_check',
        tier_id: '1_carta',
        category: 'Otro',
        amount_mxn: 150,
        customer_name: 'MIME Tester',
        customer_email: 'mimetester@example.com',
        customer_birthdate: '1990-05-15',
        question: 'Prueba de contenido multipart',
        status: 'approved',
      });

      await EmailService.sendOrderNotificationToClaudia(order);
      await EmailService.sendConfirmationToCustomer(order);

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(2);

      for (const email of captured) {
        expect(email.body).toBeTruthy();
        expect(email.body.length).toBeGreaterThan(50);
        expect(email.html).toBeTruthy();
        expect(email.html!.startsWith('<!DOCTYPE html>') || email.html!.startsWith('<!DOCTYPE html')).toBe(true);
        expect(email.date).toBeTruthy();
      }
    });

    it('5.2: clearCapturedEmails cleanly flushes recorded emails', async () => {
      const order = createSampleOrder({
        id: 'ord_flush_test',
        tier_id: '1_carta',
        category: 'Amor',
        amount_mxn: 150,
        customer_name: 'Flush Tester',
        customer_email: 'flushtester@example.com',
        customer_birthdate: '1990-01-01',
        question: 'Pregunta para probar vaciado de sink',
        status: 'approved',
      });

      await EmailService.sendOrderNotificationToClaudia(order);
      expect(EmailService.getCapturedEmails().length).toBe(1);

      EmailService.clearCapturedEmails();
      expect(EmailService.getCapturedEmails().length).toBe(0);
    });
  });
});

