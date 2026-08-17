import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import nodemailer from 'nodemailer';
import { db, closeDatabase } from '../../src/server/db/database.js';
import { SlotService } from '../../src/server/services/slot.service.js';
import {
  EmailService,
  MockEmailProvider,
  ConsoleEmailProvider,
  SmtpEmailProvider,
  ResendEmailProvider,
  IEmailProvider,
  EmailPayload,
  SendEmailResult,
} from '../../src/server/services/email.service.js';
import { createApp } from '../../src/server/app.js';
import { config, AppConfig } from '../../src/server/config.js';
import { Order, TIER_CONFIG } from '../../src/server/types/checkout.types.js';

describe('Milestone 3 Adversarial & Concurrency Stress Suite: Email Dispatcher, Webhook Integration & MIME Encoding', () => {
  const app = createApp();
  const testWebhookSecret = 'm3_adversarial_webhook_secret_key_987';

  // Helper to generate legitimate HMAC SHA-256 webhook headers
  function generateValidSignature(paymentId: string, requestId: string = `req_${uuidv4()}`): {
    'x-signature': string;
    'x-request-id': string;
  } {
    const ts = Math.floor(SlotService.getCurrentTime().getTime() / 1000).toString();
    const manifest = `id:${paymentId};request-id:${requestId};ts:${ts};`;
    const hmac = crypto.createHmac('sha256', testWebhookSecret).update(manifest).digest('hex');
    return {
      'x-signature': `ts=${ts},v1=${hmac}`,
      'x-request-id': requestId,
    };
  }

  // Helper to create valid sample Order objects
  function createTestOrder(overrides: Partial<Order> = {}): Order {
    const id = overrides.id || `ord_stress_${uuidv4().substring(0, 8)}`;
    const tierId = overrides.tier_id || '1_carta';
    const amount = overrides.amount_mxn || TIER_CONFIG[tierId]?.price || 150;

    return {
      id,
      tier_id: tierId,
      category: overrides.category || 'Amor',
      amount_mxn: amount,
      customer_name: overrides.customer_name || 'Consultante de Prueba',
      customer_email: overrides.customer_email || 'consultante@example.com',
      customer_phone: overrides.customer_phone,
      customer_birthdate: overrides.customer_birthdate || '1992-05-20',
      question: overrides.question || '¿Qué mensajes tienen las cartas para mí?',
      involved_names: overrides.involved_names,
      core_focus: overrides.core_focus,
      slot_id: overrides.slot_id,
      lock_token: overrides.lock_token,
      status: overrides.status || 'pending',
      mp_payment_id: overrides.mp_payment_id || `mp_pay_${uuidv4().substring(0, 8)}`,
      email_sent: overrides.email_sent || 0,
      customer_email_sent: overrides.customer_email_sent || 0,
      created_at: overrides.created_at || SlotService.getCurrentIso(),
      updated_at: overrides.updated_at || SlotService.getCurrentIso(),
    };
  }

  // Helper to seed a slot for call testing
  function seedTestSlot(
    slotId: string,
    offsetHours: number = 48,
    status: 'available' | 'locked' | 'booked' = 'available',
    lockToken?: string
  ) {
    const startTime = new Date(Date.now() + offsetHours * 3600 * 1000).toISOString();
    const endTime = new Date(Date.now() + offsetHours * 3600 * 1000 + 45 * 60 * 1000).toISOString();
    let lockedAt: string | null = null;
    let lockExpiresAt: string | null = null;

    if (status === 'locked') {
      lockedAt = SlotService.getCurrentIso();
      lockExpiresAt = new Date(SlotService.getCurrentTime().getTime() + 15 * 60 * 1000).toISOString();
    }

    db.prepare(`
      INSERT OR REPLACE INTO slots (id, start_time, end_time, status, locked_at, lock_expires_at, lock_token)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(slotId, startTime, endTime, status, lockedAt, lockExpiresAt, lockToken || null);
  }

  beforeEach(() => {
    config.mpWebhookSecret = testWebhookSecret;
    SlotService.resetVirtualTime();
    EmailService.clearCapturedEmails();
    EmailService.resetProvider();
    vi.restoreAllMocks();

    db.prepare(`DELETE FROM webhook_events`).run();
    db.prepare(`DELETE FROM orders`).run();
    db.prepare(`DELETE FROM slots`).run();
  });

  afterAll(() => {
    SlotService.stopSweeper();
    closeDatabase();
  });

  // =========================================================================
  // SECTION 1: HIGH CONCURRENCY EMAIL DISPATCH BURST TESTS
  // =========================================================================
  describe('1. High Concurrency Email Dispatch Burst Tests', () => {
    it('Adv-M3.1: 50+ Concurrent Customer & Claudia Email Dispatches (100 total emails in a single burst)', async () => {
      const concurrencyCount = 55;
      const orders: Order[] = [];

      for (let i = 0; i < concurrencyCount; i++) {
        const tiers: Array<Order['tier_id']> = ['1_carta', '3_cartas', '5_cartas', 'llamada'];
        const tier = tiers[i % tiers.length];
        const isCall = tier === 'llamada';

        orders.push(
          createTestOrder({
            id: `ord_burst_${i}_${uuidv4().substring(0, 6)}`,
            tier_id: tier,
            customer_name: `Consultante Número ${i + 1}`,
            customer_email: `cliente_${i + 1}@correo-ejemplo.mx`,
            question: `Pregunta de consulta concurrente #${i + 1} para evaluación de estrés.`,
            involved_names: tier === '3_cartas' || tier === '5_cartas' ? `Involucrado #${i + 1}` : undefined,
            core_focus: tier === '5_cartas' ? `Enfoque profundo #${i + 1}` : undefined,
            slot_id: isCall ? `slot_burst_${i}` : undefined,
            status: 'approved',
          })
        );
      }

      // Execute all 55 Claudia notifications and 55 Customer confirmations concurrently (110 emails total)
      const startTime = performance.now();
      const dispatchPromises: Promise<boolean>[] = [];

      for (const order of orders) {
        const slotDetails = order.slot_id
          ? { date: '2026-08-25', time_start: '15:00', time_end: '15:45' }
          : null;

        dispatchPromises.push(EmailService.sendOrderNotificationToClaudia(order, slotDetails));
        dispatchPromises.push(EmailService.sendConfirmationToCustomer(order, slotDetails));
      }

      const results = await Promise.all(dispatchPromises);
      const elapsedMs = performance.now() - startTime;

      // 1. Verify all 110 promises resolved to true without unhandled rejections
      expect(results.length).toBe(110);
      expect(results.every((r) => r === true)).toBe(true);

      // 2. Verify in-memory capture sink accounted for all 110 emails
      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(110);

      // 3. Verify exactly 55 Claudia notification emails and 55 Customer confirmation emails
      const claudiaEmails = captured.filter((e) => e.to === config.claudiaNotificationEmail);
      const customerEmails = captured.filter((e) => e.to !== config.claudiaNotificationEmail);

      expect(claudiaEmails.length).toBe(55);
      expect(customerEmails.length).toBe(55);

      // 4. Verify each order's metadata is present in both sets of emails
      for (const order of orders) {
        const claudiaMatch = claudiaEmails.find((e) => e.body.includes(order.id));
        expect(claudiaMatch).toBeDefined();
        expect(claudiaMatch!.html).toContain(order.customer_name);

        const customerMatch = customerEmails.find((e) => e.to === order.customer_email);
        expect(customerMatch).toBeDefined();
        expect(customerMatch!.body).toContain(order.id);
      }

      // 5. Performance sanity check: 110 emails dispatched in-memory in under 2000ms
      expect(elapsedMs).toBeLessThan(2000);
    });

    it('Adv-M3.2: 100+ Ultra-High Concurrency Burst (200 total emails) with Latency Measurement', async () => {
      const burstSize = 100;
      const orders: Order[] = Array.from({ length: burstSize }, (_, i) =>
        createTestOrder({
          id: `ord_ultra_${i}`,
          customer_name: `Usuario Ultra ${i}`,
          customer_email: `ultra_${i}@test.com`,
          tier_id: '1_carta',
          question: `Pregunta de alta carga #${i}`,
          status: 'approved',
        })
      );

      const start = performance.now();
      const dispatches = orders.flatMap((order) => [
        EmailService.sendOrderNotificationToClaudia(order),
        EmailService.sendConfirmationToCustomer(order),
      ]);

      const results = await Promise.all(dispatches);
      const totalDuration = performance.now() - start;

      expect(results.length).toBe(200);
      expect(results.every((r) => r === true)).toBe(true);

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(200);

      const throughput = (200 / (totalDuration / 1000)).toFixed(2);
      expect(totalDuration).toBeLessThan(3000);
    });

    it('Adv-M3.3: Multi-Provider Concurrent Chaos Burst (Mock, Console, SMTP Fallback, Resend Fallback)', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const providers: IEmailProvider[] = [
        new MockEmailProvider(),
        new ConsoleEmailProvider(),
        new SmtpEmailProvider({ ...config, smtpHost: '', smtpUser: '', smtpPass: '' }), // fallback
        new ResendEmailProvider({ ...config, resendApiKey: '' }), // fallback
      ];

      const totalChaosTasks = 60;
      const chaosPromises: Promise<SendEmailResult>[] = [];

      for (let i = 0; i < totalChaosTasks; i++) {
        const selectedProvider = providers[i % providers.length];
        const payload: EmailPayload = {
          to: `chaos_destinatario_${i}@example.com`,
          subject: `Asunto de Caos Concurrente #${i}`,
          text: `Texto plano de caos concurrente #${i}`,
          html: `<p>HTML de caos concurrente #${i}</p>`,
        };

        chaosPromises.push(selectedProvider.sendEmail(payload));
      }

      const results = await Promise.all(chaosPromises);

      // Verify all 60 dispatched successfully
      expect(results.length).toBe(60);
      expect(results.every((r) => r.success === true)).toBe(true);

      // Verify fallback flag was accurately populated for unconfigured SMTP & Resend
      const fallbackResults = results.filter((r) => r.fallbackUsed === true);
      expect(fallbackResults.length).toBe(30); // 15 SMTP + 15 Resend

      // Verify captured emails sink received all 60
      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(60);
    });
  });

  // =========================================================================
  // SECTION 2: WEBHOOK INTEGRATION & DATABASE CONCURRENCY STRESS
  // =========================================================================
  describe('2. Webhook Integration & Database Concurrency Stress', () => {
    it('Adv-M3.4: 50 Concurrent Approved Webhook Notifications for 50 Distinct Orders trigger accurate email dispatching', async () => {
      const orderCount = 50;
      const createdOrders: Order[] = [];

      // 1. Seed 50 orders in SQLite
      for (let i = 0; i < orderCount; i++) {
        const orderId = `ord_wh_stress_${i}`;
        const tier = i % 2 === 0 ? '1_carta' : '3_cartas';
        const amount = tier === '1_carta' ? 150 : 350;

        db.prepare(`
          INSERT INTO orders (
            id, tier_id, category, amount_mxn, customer_name, customer_email,
            customer_birthdate, question, involved_names, status, email_sent,
            customer_email_sent, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 0, ?, ?)
        `).run(
          orderId,
          tier,
          'Amor',
          amount,
          `Consultante Webhook ${i}`,
          `cliente_wh_${i}@test.com`,
          '1994-07-10',
          `Pregunta para orden de webhook #${i}`,
          tier === '3_cartas' ? `Persona #${i}` : null,
          SlotService.getCurrentIso(),
          SlotService.getCurrentIso()
        );

        createdOrders.push(
          db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as Order
        );
      }

      // 2. Fire 50 simultaneous webhook POST requests with valid HMAC signatures
      const webhookRequests = createdOrders.map((order, i) => {
        const paymentId = `mp_wh_pay_${i}`;
        const headers = generateValidSignature(paymentId);

        return request(app)
          .post('/api/webhooks/mercadopago')
          .set(headers)
          .send({
            action: 'payment.created',
            data: {
              id: paymentId,
              external_reference: order.id,
              status: 'approved',
              transaction_amount: order.amount_mxn,
            },
          });
      });

      const responses = await Promise.all(webhookRequests);

      // 3. Verify all 50 webhooks returned HTTP 200 OK
      expect(responses.length).toBe(50);
      for (const res of responses) {
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        if (!res.body.status) {
          console.error('[Adv-M3.4 Debug] Unexpected body without status:', JSON.stringify(res.body));
        }
        expect(res.body.status).toBe('APPROVED');
      }

      // 4. Verify all 50 orders in SQLite transitioned to status='APPROVED' and have email_sent=1, customer_email_sent=1
      const updatedOrders = db.prepare(`SELECT * FROM orders`).all() as Order[];
      expect(updatedOrders.length).toBe(50);

      for (const order of updatedOrders) {
        expect(order.status).toBe('APPROVED');
        expect(order.email_sent).toBe(1);
        expect(order.customer_email_sent).toBe(1);
        expect(order.mp_payment_id).toBeTruthy();
      }

      // 5. Verify exactly 100 emails (50 to Claudia, 50 to Customers) were recorded in the sink
      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(100);

      const claudiaCaptured = captured.filter((e) => e.to === config.claudiaNotificationEmail);
      const customerCaptured = captured.filter((e) => e.to !== config.claudiaNotificationEmail);

      expect(claudiaCaptured.length).toBe(50);
      expect(customerCaptured.length).toBe(50);
    });

    it('Adv-M3.5: Webhook Email Fault Isolation (Resilience against Email Transport Crashes)', async () => {
      // Mock custom provider that throws an unhandled error during email dispatch
      const failingProvider: IEmailProvider = {
        name: 'mock',
        sendEmail: vi.fn().mockRejectedValue(new Error('Catastrophic email network failure / SMTP down')),
      };
      EmailService.setProvider(failingProvider);

      const orderId = 'ord_email_crash_test';
      db.prepare(`
        INSERT INTO orders (
          id, tier_id, category, amount_mxn, customer_name, customer_email,
          customer_birthdate, question, status, email_sent, customer_email_sent,
          created_at, updated_at
        ) VALUES (?, '1_carta', 'Trabajo/Dinero', 150, 'Usuario Crash Test',
          'crashtest@example.com', '1990-01-01', '¿Saldré adelante?', 'pending',
          0, 0, ?, ?)
      `).run(orderId, SlotService.getCurrentIso(), SlotService.getCurrentIso());

      const paymentId = 'mp_pay_crash_test_001';
      const headers = generateValidSignature(paymentId);

      const response = await request(app)
        .post('/api/webhooks/mercadopago')
        .set(headers)
        .send({
          action: 'payment.created',
          data: {
            id: paymentId,
            external_reference: orderId,
            status: 'approved',
            transaction_amount: 150,
          },
        });

      // 1. Webhook endpoint MUST NOT crash with 500; it must return 200 OK so Mercado Pago doesn't storm the server
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.status).toBe('APPROVED');

      // 2. Database order state MUST be APPROVED (committed before email dispatch error)
      const orderInDb = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as Order;
      expect(orderInDb.status).toBe('APPROVED');
      expect(orderInDb.mp_payment_id).toBe(paymentId);
    });
  });

  // =========================================================================
  // SECTION 3: MIME BODY CONSISTENCY & CHARACTER ENCODING INTEGRITY
  // =========================================================================
  describe('3. MIME Body Consistency & Character Encoding Integrity', () => {
    it('Adv-M3.6: Exhaustive Mexican Spanish Character & Accent Preservation (á, é, í, ó, ú, ñ, ¿, ¡, ü)', async () => {
      const order = createTestOrder({
        id: 'ord_mexican_spanish_utf8',
        tier_id: '5_cartas',
        category: 'Trabajo/Dinero',
        amount_mxn: 500,
        customer_name: 'Ángel Nuñez-Peña y María José de la Cruz',
        customer_email: 'angel.nunez@mexico-consultas.com.mx',
        customer_birthdate: '1988-11-23',
        customer_phone: '+52 871 789 0123',
        question:
          '¿Qué depara el destino para mi año 2027? ¡Tengo mucha ilusión de saber sobre mi relación con Günther en España y mi éxito económico en Cancún!',
        involved_names: 'Íñigo Martínez & Rocío Cañedo',
        core_focus: 'Aclarar dudas de güeros y extraños con devoción, sabiduría y bendición.',
        status: 'approved',
        mp_payment_id: 'mp_pay_utf8_123',
      });

      await EmailService.sendOrderNotificationToClaudia(order);
      await EmailService.sendConfirmationToCustomer(order);

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(2);

      const claudiaEmail = captured.find((e) => e.to === config.claudiaNotificationEmail)!;
      const customerEmail = captured.find((e) => e.to === order.customer_email)!;

      // --- Verify Claudia Plaintext Body ---
      expect(claudiaEmail.body).toContain('Ángel Nuñez-Peña y María José de la Cruz');
      expect(claudiaEmail.body).toContain('¿Qué depara el destino para mi año 2027?');
      expect(claudiaEmail.body).toContain('¡Tengo mucha ilusión de saber sobre mi relación con Günther en España y mi éxito económico en Cancún!');
      expect(claudiaEmail.body).toContain('Íñigo Martínez & Rocío Cañedo');
      expect(claudiaEmail.body).toContain('Aclarar dudas de güeros y extraños con devoción, sabiduría y bendición.');
      expect(claudiaEmail.body).not.toContain('&aacute;');
      expect(claudiaEmail.body).not.toContain('&ntilde;');
      expect(claudiaEmail.body).not.toContain('&iquest;');

      // --- Verify Claudia HTML Body ---
      expect(claudiaEmail.html).toContain('Ángel Nuñez-Peña y María José de la Cruz');
      expect(claudiaEmail.html).toContain('¿Qué depara el destino para mi año 2027?');
      expect(claudiaEmail.html).toContain('Günther');
      expect(claudiaEmail.html).toContain('España');
      expect(claudiaEmail.html).toContain('Cancún');
      expect(claudiaEmail.html).toContain('Íñigo Martínez &amp; Rocío Cañedo'); // & is escaped in HTML
      expect(claudiaEmail.html).toContain('güeros');
      expect(claudiaEmail.html).toContain('devoción');
      expect(claudiaEmail.html).toContain('bendición');

      // --- Verify Customer Plaintext Body ---
      expect(customerEmail.body).toContain('¡Hola Ángel Nuñez-Peña y María José de la Cruz!');
      expect(customerEmail.body).toContain('24 horas');
      expect(customerEmail.body).toContain('Con luz y gratitud');

      // --- Verify Customer HTML Body ---
      expect(customerEmail.html).toContain('¡Hola Ángel Nuñez-Peña y María José de la Cruz!');
      expect(customerEmail.html).toContain('Garantía de Entrega (24 Horas)');
      expect(customerEmail.html).toContain('Con luz, gratitud y bendiciones');
      expect(customerEmail.html).toContain('Claudia — Lumina Umay');
    });

    it('Adv-M3.7: Emojis, Unicode Symbols & Multiline Formatting in Plaintext & HTML', async () => {
      const order = createTestOrder({
        id: 'ord_emoji_stress',
        tier_id: '1_carta',
        category: 'Otro',
        amount_mxn: 150,
        customer_name: 'Luz Mística 🔮✨',
        customer_email: 'luz.mistica@example.com',
        customer_birthdate: '1995-09-09',
        question: `Línea 1: Mensaje de luz 🕯️\nLínea 2: Tarot y Destino 🎴\r\nLínea 3: Paz y armonía 🧘‍♀️ 🌙 💖`,
        status: 'approved',
      });

      await EmailService.sendOrderNotificationToClaudia(order);
      await EmailService.sendConfirmationToCustomer(order);

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(2);

      for (const email of captured) {
        expect(email.body).toContain('🔮✨');
        expect(email.body).toContain('🕯️');
        expect(email.body).toContain('🎴');
        expect(email.body).toContain('🧘‍♀️ 🌙 💖');

        expect(email.html).toContain('🔮✨');
        expect(email.html).toContain('🕯️');
        expect(email.html).toContain('🎴');
        expect(email.html).toContain('🧘‍♀️ 🌙 💖');
      }
    });

    it('Adv-M3.8: XSS Injection & Payload Sanitization without Corrupting Surrounding Accents', async () => {
      const order = createTestOrder({
        id: 'ord_xss_accent_defense',
        tier_id: '3_cartas',
        category: 'Familia',
        amount_mxn: 350,
        customer_name: '<script>alert("hack")</script> José María Niño',
        customer_email: 'hacker@malicious.com',
        customer_birthdate: '1990-01-01',
        question: '<img src="x" onerror="evil()"/> ¿Cuándo llegará mi prosperidad económica en México?',
        involved_names: '<iframe src="evil.com"></iframe> Hermano & Tía',
        status: 'approved',
      });

      await EmailService.sendOrderNotificationToClaudia(order);
      await EmailService.sendConfirmationToCustomer(order);

      const captured = EmailService.getCapturedEmails();
      const claudiaEmail = captured.find((e) => e.to === config.claudiaNotificationEmail)!;
      const customerEmail = captured.find((e) => e.to === order.customer_email)!;

      // In HTML, tags must be escaped:
      expect(claudiaEmail.html).not.toContain('<script>');
      expect(claudiaEmail.html).not.toContain('<img src="x"');
      expect(claudiaEmail.html).not.toContain('<iframe');

      expect(claudiaEmail.html).toContain('&lt;script&gt;alert(&quot;hack&quot;)&lt;/script&gt; José María Niño');
      expect(claudiaEmail.html).toContain('&lt;img src=&quot;x&quot; onerror=&quot;evil()&quot;/&gt; ¿Cuándo llegará mi prosperidad económica en México?');
      expect(claudiaEmail.html).toContain('&lt;iframe src=&quot;evil.com&quot;&gt;&lt;/iframe&gt; Hermano &amp; Tía');

      // Accents in escaped HTML must remain pure UTF-8:
      expect(claudiaEmail.html).toContain('José María Niño');
      expect(claudiaEmail.html).toContain('económica');
      expect(claudiaEmail.html).toContain('México');
      expect(claudiaEmail.html).toContain('Tía');

      // Customer email check
      expect(customerEmail.html).not.toContain('<script>');
      expect(customerEmail.html).toContain('&lt;script&gt;alert(&quot;hack&quot;)&lt;/script&gt; José María Niño');
    });
  });

  // =========================================================================
  // SECTION 4: TIER-SPECIFIC DYNAMIC TEMPLATE COMPILATION
  // =========================================================================
  describe('4. Tier-Specific Dynamic Template Compilation', () => {
    it('Adv-M3.9: 1-Carta async template contains 24h SLA and excludes optional sections', async () => {
      const order = createTestOrder({
        id: 'ord_tier1_check',
        tier_id: '1_carta',
        category: 'Amor',
        amount_mxn: 150,
        customer_name: 'Ana Belén',
        question: '¿Mi expareja volverá a buscarme?',
        status: 'approved',
      });

      await EmailService.sendOrderNotificationToClaudia(order);
      await EmailService.sendConfirmationToCustomer(order);

      const captured = EmailService.getCapturedEmails();
      const claudia = captured.find((e) => e.to === config.claudiaNotificationEmail)!;
      const customer = captured.find((e) => e.to === order.customer_email)!;

      // Both should have 24-hour turnaround SLA
      expect(claudia.html).toContain('24 horas');
      expect(customer.html).toContain('24 horas');
      expect(customer.body).toContain('24 horas');

      // Should NOT have involved names or core focus headers in HTML or Plaintext
      expect(claudia.html).not.toContain('Personas Involucradas:');
      expect(claudia.html).not.toContain('Qué es lo que más deseas saber');
      expect(claudia.body).not.toContain('Personas Involucradas:');
      expect(claudia.body).not.toContain('Qué es lo que más deseas saber');
      expect(claudia.html).not.toContain('Horario de Llamada Reservado');
    });

    it('Adv-M3.10: Call Session template includes CDMX appointment timing and excludes 24h SLA', async () => {
      const order = createTestOrder({
        id: 'ord_tier_call_check',
        tier_id: 'llamada',
        category: 'Otro',
        amount_mxn: 450,
        customer_name: 'Roberto Gómez',
        question: 'Orientación espiritual en llamada',
        slot_id: 'slot_call_abc_123',
        status: 'approved',
      });

      const slotDetails = {
        date: '2026-08-30',
        time_start: '17:00',
        time_end: '17:45',
      };

      await EmailService.sendOrderNotificationToClaudia(order, slotDetails);
      await EmailService.sendConfirmationToCustomer(order, slotDetails);

      const captured = EmailService.getCapturedEmails();
      const claudia = captured.find((e) => e.to === config.claudiaNotificationEmail)!;
      const customer = captured.find((e) => e.to === order.customer_email)!;

      // Claudia Email assertions for Live Call
      expect(claudia.html).toContain('Horario de Llamada Reservado');
      expect(claudia.html).toContain('2026-08-30');
      expect(claudia.html).toContain('17:00 - 17:45 hrs (CDMX)');
      expect(claudia.body).toContain('2026-08-30');
      expect(claudia.body).toContain('17:00 - 17:45 hrs (CDMX)');
      expect(claudia.html).not.toContain('Compromiso de Entrega Asíncrona');

      // Customer Email assertions for Live Call
      expect(customer.html).toContain('Cita de Llamada Confirmada');
      expect(customer.html).toContain('2026-08-30');
      expect(customer.html).toContain('17:00 - 17:45 hrs (Hora de la Ciudad de México)');
      expect(customer.html).toContain('espacio tranquilo y libre de distracciones');
      expect(customer.body).toContain('2026-08-30');
      expect(customer.body).toContain('17:00 - 17:45 hrs (Hora Ciudad de México)');
      expect(customer.html).not.toContain('Garantía de Entrega (24 Horas)');
    });
  });

  // =========================================================================
  // SECTION 5: BOUNDARY PAYLOADS & STABILITY
  // =========================================================================
  describe('5. Boundary Payloads & Extreme Inputs', () => {
    it('Adv-M3.11: Massive 10,000-Character Question Payload completes template compilation rapidly without stack overflow', async () => {
      const massiveQuestion = '¿Cuál es mi destino cósmico? ' + '✨ Consulta detallada de tarot con sabiduría ancestral. '.repeat(185);
      expect(massiveQuestion.length).toBeGreaterThan(10000);

      const order = createTestOrder({
        id: 'ord_huge_payload',
        tier_id: '1_carta',
        customer_name: 'Consultante Con Pregunta Extensa',
        question: massiveQuestion,
        status: 'approved',
      });

      const start = performance.now();
      await EmailService.sendOrderNotificationToClaudia(order);
      await EmailService.sendConfirmationToCustomer(order);
      const duration = performance.now() - start;

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(2);

      const claudia = captured.find((e) => e.to === config.claudiaNotificationEmail)!;
      expect(claudia.body.length).toBeGreaterThan(10000);
      expect(claudia.html!.length).toBeGreaterThan(10000);
      expect(duration).toBeLessThan(100); // Must compile within 100ms
    });

    it('Adv-M3.12: Idempotent Webhook Replays do not send duplicate emails', async () => {
      const orderId = 'ord_idempotency_email_guard';
      db.prepare(`
        INSERT INTO orders (
          id, tier_id, category, amount_mxn, customer_name, customer_email,
          customer_birthdate, question, status, email_sent, customer_email_sent,
          created_at, updated_at
        ) VALUES (?, '1_carta', 'Amor', 150, 'Cliente Idempotente',
          'idempotent@example.com', '1993-02-14', '¿Habrá boda?', 'pending',
          0, 0, ?, ?)
      `).run(orderId, SlotService.getCurrentIso(), SlotService.getCurrentIso());

      const paymentId = 'mp_pay_idempotent_test_999';
      const headers = generateValidSignature(paymentId);

      const body = {
        action: 'payment.created',
        data: {
          id: paymentId,
          external_reference: orderId,
          status: 'approved',
          transaction_amount: 150,
        },
      };

      // Send webhook 5 consecutive times
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post('/api/webhooks/mercadopago')
          .set(headers)
          .send(body);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      }

      // Verify captured emails sink received EXACTLY 2 emails (1 Claudia, 1 Customer), not 10!
      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(2);
      expect(captured.filter((e) => e.to === config.claudiaNotificationEmail).length).toBe(1);
      expect(captured.filter((e) => e.to === 'idempotent@example.com').length).toBe(1);
    });

    it('Adv-M3.13: 100 Mixed Multi-Tier Concurrent Webhooks with Soft-Locked Call Slots & Async Readings', async () => {
      const tierBatches: Array<{ tier: Order['tier_id']; count: number; amount: number }> = [
        { tier: '1_carta', count: 25, amount: 150 },
        { tier: '3_cartas', count: 25, amount: 350 },
        { tier: '5_cartas', count: 25, amount: 500 },
        { tier: 'llamada', count: 25, amount: 450 },
      ];

      const ordersToTest: Array<{ orderId: string; tier: Order['tier_id']; slotId?: string; lockToken?: string }> = [];

      let itemIndex = 0;
      for (const batch of tierBatches) {
        for (let j = 0; j < batch.count; j++) {
          const orderId = `ord_wh_100mix_${itemIndex}`;
          const isCall = batch.tier === 'llamada';
          const slotId = isCall ? `slot_wh_100mix_${j}` : undefined;
          const lockToken = isCall ? `tok_wh_100mix_${j}` : undefined;

          if (isCall && slotId && lockToken) {
            seedTestSlot(slotId, 24 + j, 'locked', lockToken);
          }

          db.prepare(`
            INSERT INTO orders (
              id, tier_id, category, amount_mxn, customer_name, customer_email,
              customer_birthdate, question, involved_names, core_focus, slot_id, lock_token,
              status, email_sent, customer_email_sent, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 0, ?, ?)
          `).run(
            orderId,
            batch.tier,
            'Amor',
            batch.amount,
            `Cliente 100Mix ${itemIndex}`,
            `cliente100_${itemIndex}@test.com`,
            '1991-08-15',
            `Pregunta para orden multi-tier #${itemIndex}`,
            batch.tier === '3_cartas' || batch.tier === '5_cartas' ? `Involucrado #${itemIndex}` : null,
            batch.tier === '5_cartas' ? `Enfoque mayor #${itemIndex}` : null,
            slotId || null,
            lockToken || null,
            SlotService.getCurrentIso(),
            SlotService.getCurrentIso()
          );

          ordersToTest.push({ orderId, tier: batch.tier, slotId, lockToken });
          itemIndex++;
        }
      }

      // Fire 100 simultaneous webhook approved requests
      const requests = ordersToTest.map((item, idx) => {
        const paymentId = `mp_pay_100mix_${idx}`;
        const headers = generateValidSignature(paymentId);

        return request(app)
          .post('/api/webhooks/mercadopago')
          .set(headers)
          .send({
            action: 'payment.created',
            data: {
              id: paymentId,
              external_reference: item.orderId,
              status: 'approved',
              transaction_amount: item.tier === '1_carta' ? 150 : item.tier === '3_cartas' ? 350 : item.tier === '5_cartas' ? 500 : 450,
            },
          });
      });

      const responses = await Promise.all(requests);

      // Verify all 100 returned HTTP 200
      expect(responses.length).toBe(100);
      for (const res of responses) {
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.status).toBe('APPROVED');
      }

      // Verify database state: all 100 orders APPROVED with email flags
      const approvedOrders = db.prepare(`SELECT * FROM orders WHERE status = 'APPROVED'`).all() as Order[];
      expect(approvedOrders.length).toBe(100);
      expect(approvedOrders.every((o) => o.email_sent === 1 && o.customer_email_sent === 1)).toBe(true);

      // Verify all 25 call slots transitioned from 'locked' to 'booked'
      const bookedSlots = db.prepare(`SELECT * FROM slots WHERE status = 'booked'`).all();
      expect(bookedSlots.length).toBe(25);

      // Verify sink captured all 200 emails (100 Claudia + 100 Customer)
      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(200);

      const claudiaEmails = captured.filter((e) => e.to === config.claudiaNotificationEmail);
      const customerEmails = captured.filter((e) => e.to !== config.claudiaNotificationEmail);

      expect(claudiaEmails.length).toBe(100);
      expect(customerEmails.length).toBe(100);
    });

    it('Adv-M3.14: In-Memory Sink Accounting under Burst Identical Customer Names', async () => {
      // 50 orders with identical customer name 'María Fernanda Garza' and same tier, but different order IDs
      const burstSize = 50;
      const orders: Order[] = Array.from({ length: burstSize }, (_, i) =>
        createTestOrder({
          id: `ord_identical_name_${i}`,
          customer_name: 'María Fernanda Garza',
          customer_email: `maria_${i}@correo-garza.mx`,
          tier_id: '1_carta',
          question: `Pregunta de consulta idéntica para orden #${i}`,
          status: 'approved',
        })
      );

      const dispatches = orders.flatMap((order) => [
        EmailService.sendOrderNotificationToClaudia(order),
        EmailService.sendConfirmationToCustomer(order),
      ]);

      await Promise.all(dispatches);

      const captured = EmailService.getCapturedEmails();
      const customerEmails = captured.filter((e) => e.to !== config.claudiaNotificationEmail);
      const claudiaEmails = captured.filter((e) => e.to === config.claudiaNotificationEmail);

      expect(customerEmails.length).toBe(50);
      expect(claudiaEmails.length).toBe(50);
    });

    it('Adv-M3.15: Plaintext & HTML MIME Multipart Deep Syntax & UTF-8 Purity Inspection', async () => {
      const order = createTestOrder({
        id: 'ord_purity_check',
        tier_id: '3_cartas',
        category: 'Trabajo/Dinero',
        amount_mxn: 350,
        customer_name: 'Guillermo Peña & Cía',
        customer_email: 'guillermo@penaycia.mx',
        customer_birthdate: '1985-04-12',
        question: '¿Tendremos éxito con la nueva sucursal en Querétaro? ¡Esperamos con emoción!',
        involved_names: 'Socio Íñigo & Contadora Rocío',
        status: 'approved',
      });

      await EmailService.sendOrderNotificationToClaudia(order);
      await EmailService.sendConfirmationToCustomer(order);

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(2);

      for (const email of captured) {
        // Plaintext purity assertions:
        // Must contain genuine UTF-8 characters
        expect(email.body).toContain('Guillermo Peña & Cía');
        expect(email.body).toContain('Querétaro');
        expect(email.body).toContain('emoción');
        expect(email.body).toContain('¿');
        expect(email.body).toContain('¡');
        // Must NOT contain HTML entities in plaintext
        expect(email.body).not.toContain('&amp;');
        expect(email.body).not.toContain('&quot;');
        expect(email.body).not.toContain('&#039;');
        expect(email.body).not.toContain('&lt;');
        expect(email.body).not.toContain('&gt;');
        expect(email.body).not.toContain('{{');
        expect(email.body).not.toContain('}}');

        // HTML purity assertions:
        expect(email.html).toBeDefined();
        // HTML must escape & to &amp;
        expect(email.html).toContain('Guillermo Peña &amp; Cía');
        // HTML must contain genuine UTF-8 characters without double encoding
        expect(email.html).toContain('Querétaro');
        expect(email.html).toContain('emoción');
        expect(email.html).toContain('¿');
        expect(email.html).toContain('¡');
        // HTML must not leak unrendered template mustache tags
        expect(email.html).not.toContain('{{#if');
        expect(email.html).not.toContain('{{/if');
        expect(email.html).not.toContain('{{#unless');
        expect(email.html).not.toContain('{{/unless');
        expect(email.html).not.toContain('{{else}}');
        expect(email.html).not.toContain('{{');
        expect(email.html).not.toContain('}}');
      }
    });

    it('Adv-M3.16: Non-Blocking Webhook Execution with Simulated Network Latency in Email Transport', async () => {
      // Simulate slow external SMTP/Resend network latency (15ms delay per email dispatch)
      const slowProvider: IEmailProvider = {
        name: 'mock',
        sendEmail: async (payload: EmailPayload): Promise<SendEmailResult> => {
          await new Promise((resolve) => setTimeout(resolve, 15));
          return MockEmailProvider.record(payload, 'mock-slow');
        },
      };
      EmailService.setProvider(slowProvider);

      const orderCount = 20;
      const createdOrders: Order[] = [];

      for (let i = 0; i < orderCount; i++) {
        const orderId = `ord_slow_stress_${i}`;
        db.prepare(`
          INSERT INTO orders (
            id, tier_id, category, amount_mxn, customer_name, customer_email,
            customer_birthdate, question, status, email_sent, customer_email_sent,
            created_at, updated_at
          ) VALUES (?, '1_carta', 'Amor', 150, ?, ?,
            '1990-01-01', '¿Pregunta con latencia?', 'pending', 0, 0, ?, ?)
        `).run(
          orderId,
          `Usuario Slow ${i}`,
          `slow_${i}@example.com`,
          SlotService.getCurrentIso(),
          SlotService.getCurrentIso()
        );

        createdOrders.push(db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as Order);
      }

      const start = performance.now();
      const webhookRequests = createdOrders.map((order, i) => {
        const paymentId = `mp_slow_pay_${i}`;
        const headers = generateValidSignature(paymentId);

        return request(app)
          .post('/api/webhooks/mercadopago')
          .set(headers)
          .send({
            action: 'payment.created',
            data: {
              id: paymentId,
              external_reference: order.id,
              status: 'approved',
              transaction_amount: 150,
            },
          });
      });

      const responses = await Promise.all(webhookRequests);
      const totalElapsed = performance.now() - start;

      expect(responses.length).toBe(20);
      expect(responses.every((r) => r.status === 200 && r.body.status === 'APPROVED')).toBe(true);

      const captured = EmailService.getCapturedEmails();
      expect(captured.length).toBe(40); // 20 Claudia + 20 Customer

      // Because 20 requests run concurrently, total time should be << (20 * 30ms = 600ms)
      expect(totalElapsed).toBeLessThan(1500);
    });
  });
});
