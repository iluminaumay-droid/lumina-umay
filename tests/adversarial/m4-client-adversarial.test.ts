import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { app } from '../../src/server/app.js';
import { db, closeDatabase } from '../../src/server/db/database.js';
import { SlotService } from '../../src/server/services/slot.service.js';
import { EmailService } from '../../src/server/services/email.service.js';
import { TIER_CONFIG } from '../../src/server/types/checkout.types.js';
import { isValidBirthdate } from '../../src/server/validators/checkout.validator.js';

describe('Milestone 4: Adversarial Client Logic & Form Validation Suite', () => {
  const clientPath = path.join(process.cwd(), 'src', 'client');
  const indexHtmlPath = path.join(clientPath, 'index.html');
  const appJsPath = path.join(clientPath, 'app.js');
  const stylesCssPath = path.join(clientPath, 'styles.css');

  beforeEach(() => {
    SlotService.resetVirtualTime();
    EmailService.clearCapturedEmails();
    db.prepare(`DELETE FROM webhook_events`).run();
    db.prepare(`DELETE FROM orders`).run();
    db.prepare(`DELETE FROM slots`).run();
  });

  afterAll(() => {
    SlotService.stopSweeper();
    closeDatabase();
  });

  // =========================================================================
  // 1. FORM VALIDATION EDGE CASES & MALICIOUS INPUT BOUNDARIES
  // =========================================================================
  describe('1. Form Validation Edge Cases & Boundary Conditions', () => {
    it('M4-ADV-1.1: Rejects empty strings and whitespace-only in mandatory fields', async () => {
      // Empty / whitespace customer_name
      const res1 = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: '1_carta',
          category: 'Amor',
          customer_name: '   ',
          customer_email: 'test@example.com',
          customer_birthdate: '1990-05-15',
          question: '¿Conseguiré empleo?',
        });
      expect(res1.status).toBe(400);
      expect(res1.body.success).toBe(false);
      expect(res1.body.error).toMatch(/nombre/i);

      // Empty / whitespace question
      const res2 = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: '1_carta',
          category: 'Amor',
          customer_name: 'María Garza',
          customer_email: 'test@example.com',
          customer_birthdate: '1990-05-15',
          question: ' \t\n  ',
        });
      expect(res2.status).toBe(400);
      expect(res2.body.success).toBe(false);
      expect(res2.body.error).toMatch(/pregunta/i);

      // Empty / whitespace category
      const res3 = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: '1_carta',
          category: '   ',
          customer_name: 'María Garza',
          customer_email: 'test@example.com',
          customer_birthdate: '1990-05-15',
          question: '¿Conseguiré empleo?',
        });
      expect(res3.status).toBe(400);
      expect(res3.body.success).toBe(false);
    });

    it('M4-ADV-1.2: Adversarial Email Format Permutations (Rejection of invalid emails)', async () => {
      const invalidEmails = [
        'plainaddress',
        '#@%^%#$@#$@#.com',
        '@example.com',
        'Joe Smith <email@example.com>',
        'email.example.com',
        'email@example@example.com',
        'email@example',
        'email@-example.com',
        'email@example..com',
        'user<script>@evil.com',
        'user@domain with spaces.com',
        'user..name@example.com',
      ];

      for (const badEmail of invalidEmails) {
        const res = await request(app)
          .post('/api/checkout/create-preference')
          .send({
            tier_id: '1_carta',
            category: 'Amor',
            customer_name: 'Elena Ramos',
            customer_email: badEmail,
            customer_birthdate: '1992-04-10',
            question: '¿Tendré suerte en el amor?',
          });
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      }
    });

    it('M4-ADV-1.3: Birthdate Calendar Boundary Stress (Future, Non-Existent, Leap Years & Antiquity)', () => {
      // Future dates
      expect(isValidBirthdate('2099-01-01')).toBe(false);
      expect(isValidBirthdate('2026-12-31')).toBe(false);

      // Tomorrow's date
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
      const tomorrowStr = tomorrow.toISOString().slice(0, 10);
      expect(isValidBirthdate(tomorrowStr)).toBe(false);

      // Non-existent calendar dates
      expect(isValidBirthdate('2023-02-29')).toBe(false); // 2023 is not a leap year
      expect(isValidBirthdate('2023-02-30')).toBe(false);
      expect(isValidBirthdate('2023-02-31')).toBe(false);
      expect(isValidBirthdate('2023-04-31')).toBe(false); // April has 30 days
      expect(isValidBirthdate('2023-06-31')).toBe(false); // June has 30 days
      expect(isValidBirthdate('2023-09-31')).toBe(false); // Sept has 30 days
      expect(isValidBirthdate('2023-11-31')).toBe(false); // Nov has 30 days
      expect(isValidBirthdate('2023-13-01')).toBe(false); // Month 13

      // Malformed date formats
      expect(isValidBirthdate('15/01/1990')).toBe(false);
      expect(isValidBirthdate('01-15-1990')).toBe(false);
      expect(isValidBirthdate('1990/01/15')).toBe(false);
      expect(isValidBirthdate('not-a-date')).toBe(false);
      expect(isValidBirthdate('')).toBe(false);

      // Antiquity dates before 1900
      expect(isValidBirthdate('1899-12-31')).toBe(false);
      expect(isValidBirthdate('1750-06-15')).toBe(false);

      // Valid boundary past dates
      expect(isValidBirthdate('1900-01-01')).toBe(true);
      expect(isValidBirthdate('1985-07-24')).toBe(true);
      expect(isValidBirthdate('2000-02-29')).toBe(true); // 2000 is a leap year
      expect(isValidBirthdate('2004-02-29')).toBe(true); // 2004 is a leap year
    });

    it('M4-ADV-1.4: Tier-Specific Dynamic Validation Enforcement (5 Cartas Core Focus Requirement)', async () => {
      // 5 Cartas without core_focus should fail with HTTP 400
      const resMissing = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: '5_cartas',
          category: 'Trabajo/Dinero',
          customer_name: 'Rodrigo Morales',
          customer_email: 'rodrigo@example.com',
          customer_birthdate: '1988-11-20',
          question: 'Situación financiera y nuevo negocio',
        });
      expect(resMissing.status).toBe(400);
      expect(resMissing.body.success).toBe(false);
      expect(resMissing.body.error).toMatch(/deseas saber/i);

      // 5 Cartas with whitespace-only core_focus should fail
      const resWhitespace = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: '5_cartas',
          category: 'Trabajo/Dinero',
          customer_name: 'Rodrigo Morales',
          customer_email: 'rodrigo@example.com',
          customer_birthdate: '1988-11-20',
          question: 'Situación financiera y nuevo negocio',
          core_focus: '     \n\t  ',
        });
      expect(resWhitespace.status).toBe(400);
      expect(resWhitespace.body.success).toBe(false);

      // 5 Cartas with valid core_focus should succeed
      const resValid = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: '5_cartas',
          category: 'Trabajo/Dinero',
          customer_name: 'Rodrigo Morales',
          customer_email: 'rodrigo@example.com',
          customer_birthdate: '1988-11-20',
          question: 'Situación financiera y nuevo negocio',
          core_focus: 'Quiero saber si debo aceptar la oferta de socio',
          involved_names: 'Carlos Méndez',
        });
      expect(resValid.status).toBe(200);
      expect(resValid.body.success).toBe(true);
      expect(resValid.body.order_id).toBeDefined();

      // 1 Carta does not require core_focus
      const res1C = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: '1_carta',
          category: 'Amor',
          customer_name: 'Rodrigo Morales',
          customer_email: 'rodrigo@example.com',
          customer_birthdate: '1988-11-20',
          question: '¿Ella me llamará hoy?',
        });
      expect(res1C.status).toBe(200);
      expect(res1C.body.success).toBe(true);
    });

    it('M4-ADV-1.5: Call Session requires valid slot_id and soft-lock protection', async () => {
      // Call session without slot_id should fail
      const resNoSlot = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: 'llamada',
          category: 'Familia',
          customer_name: 'Lucía Fernández',
          customer_email: 'lucia@example.com',
          customer_birthdate: '1995-03-12',
          question: 'Orientación para conflicto familiar',
        });
      expect(resNoSlot.status).toBe(400);
      expect(resNoSlot.body.success).toBe(false);
      expect(resNoSlot.body.error).toMatch(/horario/i);

      // Call session with non-existent slot should return 404
      const resNonExistent = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: 'llamada',
          category: 'Familia',
          customer_name: 'Lucía Fernández',
          customer_email: 'lucia@example.com',
          customer_birthdate: '1995-03-12',
          question: 'Orientación para conflicto familiar',
          slot_id: 'non-existent-slot-uuid-999',
        });
      expect(resNonExistent.status).toBe(404);
      expect(resNonExistent.body.success).toBe(false);
    });
  });

  // =========================================================================
  // 2. XSS SANITIZATION & DOM INJECTION SECURITY
  // =========================================================================
  describe('2. XSS Sanitization in Status Polling Modal & Client UI', () => {
    it('M4-ADV-2.1: Stores and returns XSS payloads without server-side corruption', async () => {
      const maliciousPayload = {
        tier_id: '1_carta',
        category: 'Otro' as const,
        customer_name: '<script>alert("XSS_NAME")</script>',
        customer_email: 'xss-tester@example.com',
        customer_birthdate: '1990-01-01',
        question: '<img src=x onerror=alert("XSS_QUESTION")><svg onload=alert(document.cookie)>',
      };

      const res = await request(app)
        .post('/api/checkout/create-preference')
        .send(maliciousPayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const orderId = res.body.order_id;

      // Status polling endpoint check
      const statusRes = await request(app).get(`/api/orders/${orderId}/status`);
      expect(statusRes.status).toBe(200);
      expect(statusRes.body.success).toBe(true);
      expect(statusRes.body.order_id).toBe(orderId);
      expect(statusRes.body.status).toBe('PENDING');

      // Direct DB verification
      const orderInDb = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as any;
      expect(orderInDb.customer_name).toBe('<script>alert("XSS_NAME")</script>');
      expect(orderInDb.question).toContain('<img src=x onerror=alert("XSS_QUESTION")>');
    });

    it('M4-ADV-2.2: Static Client JavaScript safely uses textContent over innerHTML for modal fields', () => {
      const appJs = fs.readFileSync(appJsPath, 'utf8');

      // Check modal rendering functions
      expect(appJs).toMatch(/textContent\s*=\s*[`'"].*order_id/i);
      expect(appJs).not.toMatch(/innerHTML\s*=\s*.*orderData\.customer_name/);
      expect(appJs).not.toMatch(/innerHTML\s*=\s*.*orderData\.question/);
      expect(appJs).not.toMatch(/innerHTML\s*=\s*.*orderData\.order_id/);
      expect(appJs).not.toMatch(/innerHTML\s*=\s*.*orderData\.category/);

      // Verify no dynamic eval or document.write in app.js
      expect(appJs).not.toMatch(/\beval\s*\(/);
      expect(appJs).not.toMatch(/document\.write\s*\(/);
      expect(appJs).not.toMatch(/setTimeout\s*\(\s*["']/); // no string eval setTimeout
    });

    it('M4-ADV-2.3: Static HTML does not contain unsafe inline event handlers or scripts', () => {
      const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

      // Verify no inline JavaScript execution attributes (e.g. onclick=, onerror=, onload=)
      expect(indexHtml).not.toMatch(/\sonload\s*=/i);
      expect(indexHtml).not.toMatch(/\sonerror\s*=/i);
      expect(indexHtml).not.toMatch(/\sonclick\s*=/i);
      expect(indexHtml).not.toMatch(/\sonmouseover\s*=/i);
      expect(indexHtml).not.toMatch(/javascript:/i);
    });
  });

  // =========================================================================
  // 3. CATEGORY MAPPING CONSISTENCY (CLIENT UI, CLIENT JS, SERVER ZOD & DB)
  // =========================================================================
  describe('3. Category Mapping Consistency Across Full Stack', () => {
    const EXPECTED_CATEGORIES = ['Amor', 'Trabajo/Dinero', 'Familia', 'Otro'];

    it('M4-ADV-3.1: HTML dropdown options strictly match the 4 official categories', () => {
      const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

      for (const cat of EXPECTED_CATEGORIES) {
        expect(indexHtml).toContain(`value="${cat}"`);
      }

      // Ensure no obsolete or unofficial categories
      expect(indexHtml).not.toContain('value="Salud"');
      expect(indexHtml).not.toContain('value="Dinero"');
      expect(indexHtml).not.toContain('value="General"');
    });

    it('M4-ADV-3.2: Client app.js validation array strictly permits the 4 official categories', () => {
      const appJs = fs.readFileSync(appJsPath, 'utf8');

      for (const cat of EXPECTED_CATEGORIES) {
        expect(appJs).toContain(`'${cat}'`);
      }
    });

    it('M4-ADV-3.3: Server Zod schema accepts all 4 valid categories', async () => {
      for (const cat of EXPECTED_CATEGORIES) {
        const res = await request(app)
          .post('/api/checkout/create-preference')
          .send({
            tier_id: '1_carta',
            category: cat,
            customer_name: 'Valeria Santos',
            customer_email: 'valeria@example.com',
            customer_birthdate: '1994-08-18',
            question: `Consulta sobre categoría ${cat}`,
          });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      }
    });

    it('M4-ADV-3.4: Server rejects invalid, tampered, or case-mismatched categories', async () => {
      const badCategories = [
        'amor', // lowercase
        'AMOR', // uppercase
        'Salud',
        'Dinero',
        'Espiritualidad',
        'Otro ',
        ' Amor',
        "Amor' OR '1'='1",
        '<script>alert(1)</script>',
      ];

      for (const badCat of badCategories) {
        const res = await request(app)
          .post('/api/checkout/create-preference')
          .send({
            tier_id: '1_carta',
            category: badCat,
            customer_name: 'Valeria Santos',
            customer_email: 'valeria@example.com',
            customer_birthdate: '1994-08-18',
            question: 'Consulta con categoría inválida',
          });
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
      }
    });
  });

  // =========================================================================
  // 4. PRICING CONSISTENCY & ANTI-TAMPERING ENFORCEMENT
  // =========================================================================
  describe('4. Pricing Consistency & Anti-Tampering Enforcement', () => {
    const TIERS = [
      { id: '1_carta', price: 150, name: '1 Carta' },
      { id: '3_cartas', price: 350, name: '3 Cartas' },
      { id: '5_cartas', price: 500, name: '5 Cartas' },
      { id: 'llamada', price: 450, name: 'Llamada' },
    ];

    it('M4-ADV-4.1: Static HTML displays exact prices for all 4 tiers', () => {
      const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

      expect(indexHtml).toContain('$150');
      expect(indexHtml).toContain('$350');
      expect(indexHtml).toContain('$500');
      expect(indexHtml).toContain('$450');
    });

    it('M4-ADV-4.2: Client JavaScript TIER_METADATA matches pricing specs', () => {
      const appJs = fs.readFileSync(appJsPath, 'utf8');

      expect(appJs).toMatch(/'1_carta'[\s\S]*?price:\s*150/);
      expect(appJs).toMatch(/'3_cartas'[\s\S]*?price:\s*350/);
      expect(appJs).toMatch(/'5_cartas'[\s\S]*?price:\s*500/);
      expect(appJs).toMatch(/'llamada'[\s\S]*?price:\s*450/);
    });

    it('M4-ADV-4.3: Server TIER_CONFIG matches pricing specs', () => {
      expect(TIER_CONFIG['1_carta'].price).toBe(150);
      expect(TIER_CONFIG['3_cartas'].price).toBe(350);
      expect(TIER_CONFIG['5_cartas'].price).toBe(500);
      expect(TIER_CONFIG['llamada'].price).toBe(450);
    });

    it('M4-ADV-4.4: Server strictly ignores and overrides client-sent amount manipulation', async () => {
      // Adversary attempts to pay $1 MXN for 5 Cartas ($500)
      const resTampered = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: '5_cartas',
          category: 'Amor',
          customer_name: 'Hacker User',
          customer_email: 'hacker@example.com',
          customer_birthdate: '1990-01-01',
          question: '¿Puedo pagar menos dinero?',
          core_focus: 'Seguridad y precios',
          amount: 1.0, // Tampered amount
        });

      expect(resTampered.status).toBe(200);
      expect(resTampered.body.success).toBe(true);
      expect(resTampered.body.amount).toBe(500); // Server enforces 500

      const orderInDb = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(resTampered.body.order_id) as any;
      expect(orderInDb.amount_mxn).toBe(500);
    });

    it('M4-ADV-4.5: Negative, Zero, and NaN price payload attempts are overridden by server price', async () => {
      for (const badPrice of [-150, 0, 0.001, 999999]) {
        const res = await request(app)
          .post('/api/checkout/create-preference')
          .send({
            tier_id: '1_carta',
            category: 'Amor',
            customer_name: 'Test Pricing',
            customer_email: 'pricing@example.com',
            customer_birthdate: '1990-01-01',
            question: 'Verificando precio estricto',
            amount: badPrice,
          });

        expect(res.status).toBe(200);
        expect(res.body.amount).toBe(150);

        const order = db.prepare(`SELECT amount_mxn FROM orders WHERE id = ?`).get(res.body.order_id) as any;
        expect(order.amount_mxn).toBe(150);
      }
    });
  });

  // =========================================================================
  // 5. CLIENT UI/UX, DESIGN TOKENS, SPANISH FAQ & MODAL ARCHITECTURE
  // =========================================================================
  describe('5. Client UI/UX, Tokens, FAQ Accordion & Confirmation Views', () => {
    it('M4-ADV-5.1: Verifies CSS design tokens in styles.css', () => {
      const styles = fs.readFileSync(stylesCssPath, 'utf8');

      expect(styles).toContain('--teal:');
      expect(styles).toContain('--teal-deep:');
      expect(styles).toContain('--gold:');
      expect(styles).toContain('--cream:');
      expect(styles).toContain('Cormorant Garamond');
      expect(styles).toContain('Jost');
      expect(styles).toMatch(/(\.app|\.app-container)/);
    });

    it('M4-ADV-5.2: Verifies Spanish FAQ Accordion contains all 5 spec questions and no WhatsApp CTA', () => {
      const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

      // Spec required questions
      expect(indexHtml).toContain('¿Cómo recibo mi lectura?');
      expect(indexHtml).toContain('¿Cuánto tarda en llegar la respuesta?');
      expect(indexHtml).toContain('¿Qué pasa si no puedo asistir a mi llamada agendada?');
      expect(indexHtml).toContain('¿Los pagos son seguros?');
      expect(indexHtml).toContain('¿Puedo cambiar mi pregunta después de pagar?');

      // WhatsApp CTA elimination
      expect(indexHtml).not.toMatch(/api\.whatsapp\.com/i);
      expect(indexHtml).not.toMatch(/wa\.me/i);
      expect(indexHtml).not.toMatch(/https:\/\/wa\.link/i);
    });

    it('M4-ADV-5.3: Verifies Post-Payment Confirmation Modal elements in index.html', () => {
      const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

      expect(indexHtml).toContain('id="confirmation-modal"');
      expect(indexHtml).toContain('id="confirmation-polling"');
      expect(indexHtml).toContain('id="confirmation-success-async"');
      expect(indexHtml).toContain('id="confirmation-success-call"');
      expect(indexHtml).toContain('id="confirmation-overbooked"');
      expect(indexHtml).toContain('Garantía de Entrega en 24 Horas');
    });
  });
});
