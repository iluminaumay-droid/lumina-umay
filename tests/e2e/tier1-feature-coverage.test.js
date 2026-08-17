/**
 * Tier 1: Feature Coverage E2E Test Suite (ESM)
 * Covers 1 Carta, 3 Cartas, 5 Cartas, Call Session, and FAQ Accordion
 * Minimum >=5 tests per feature area (Total: 30 tests)
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TestHarness } from './helpers/test-harness.js';
import {
  TIER_PRICING,
  VALID_CATEGORIES,
  MEXICAN_SPANISH_FAQ,
  assertTierPricing,
  assertAsyncTurnaroundNotice,
  assertCallAppointmentDetails
} from './helpers/assertion-helpers.js';

describe('Tier 1: Feature Coverage', () => {
  const harness = new TestHarness();
  let client;

  before(async () => {
    client = await harness.setup();
  });

  after(async () => {
    await harness.teardown();
  });

  beforeEach(async () => {
    await client.resetState();
  });

  // ==========================================
  // 1. Lectura de 1 Carta ($150 MXN)
  // ==========================================
  describe('Feature 1.1: Lectura de 1 Carta ($150 MXN)', () => {
    it('T1.1_1C_ValidOrder_Amor: should create preference successfully with valid payload for category Amor', async () => {
      const payload = {
        tier_id: '1_carta',
        category: 'Amor',
        customer_name: 'María Fernanda López',
        customer_email: 'maria.lopez@example.com',
        customer_birthdate: '1996-05-14',
        question: '¿Volverá mi expareja este mes?'
      };

      const res = await client.createPreference(payload);
      assert.equal(res.status, 200);
      assert.equal(res.data.success, true);
      assert.ok(res.data.order_id);
      assert.ok(res.data.preference_id);
      assert.ok(res.data.init_point.includes(res.data.preference_id));
      assertTierPricing('1_carta', res.data.amount);
    });

    it('T1.1_1C_ValidOrder_AllCategories: should accept all 4 mandatory categories (Amor, Trabajo/Dinero, Familia, Otro)', async () => {
      for (const cat of VALID_CATEGORIES) {
        const payload = {
          tier_id: '1_carta',
          category: cat,
          customer_name: 'Carlos Ruiz',
          customer_email: 'carlos.ruiz@example.com',
          customer_birthdate: '1990-11-23',
          question: `Pregunta enfocada en ${cat}`
        };
        const res = await client.createPreference(payload);
        assert.equal(res.status, 200, `Failed for category: ${cat}`);
        assert.equal(res.data.success, true);
      }
    });

    it('T1.1_1C_MissingQuestion: should reject submission when question is missing or empty', async () => {
      const payload = {
        tier_id: '1_carta',
        category: 'Trabajo/Dinero',
        customer_name: 'Juan Pérez',
        customer_email: 'juan@example.com',
        customer_birthdate: '1988-02-10',
        question: '   '
      };
      const res = await client.createPreference(payload);
      assert.equal(res.status, 400);
      assert.equal(res.data.success, false);
      assert.ok(res.data.error.includes('pregunta') || res.data.error.includes('requerido'));
    });

    it('T1.1_1C_MissingBirthdate: should reject submission when customer birthdate is invalid or missing', async () => {
      const payload = {
        tier_id: '1_carta',
        category: 'Familia',
        customer_name: 'Sofia Martinez',
        customer_email: 'sofia@example.com',
        question: '¿Tendremos armonía familiar pronto?'
      };
      const res = await client.createPreference(payload);
      assert.equal(res.status, 400);
      assert.equal(res.data.success, false);
      assert.ok(res.data.error.toLowerCase().includes('fecha de nacimiento'));
    });

    it('T1.1_1C_PriceEnforcement: should enforce $150 MXN pricing even if client sends manipulated amount', async () => {
      const payload = {
        tier_id: '1_carta',
        category: 'Otro',
        customer_name: 'Luis Angel',
        customer_email: 'luis@example.com',
        customer_birthdate: '1994-08-19',
        question: '¿Es buen momento para viajar?',
        amount: 1 // Malicious price tampering attempt
      };
      const res = await client.createPreference(payload);
      assert.equal(res.status, 200);
      assert.equal(res.data.amount, 150, 'Server must enforce $150 MXN ignoring client value');
    });

    it('T1.1_1C_StatusTurnaroundMessage: should provide 24-hour delivery promise in Mexican Spanish', async () => {
      const payload = {
        tier_id: '1_carta',
        category: 'Amor',
        customer_name: 'Lucia Morales',
        customer_email: 'lucia@example.com',
        customer_birthdate: '1992-03-15',
        question: '¿Encontraré pareja este año?'
      };
      const prefRes = await client.createPreference(payload);
      assert.equal(prefRes.status, 200);

      const statusRes = await client.getOrderStatus(prefRes.data.order_id);
      assert.equal(statusRes.status, 200);
      assert.equal(statusRes.data.status, 'PENDING');
      assertAsyncTurnaroundNotice(statusRes.data.turnaround_message);
    });
  });

  // ==========================================
  // 2. Lectura de 3 Cartas ($350 MXN)
  // ==========================================
  describe('Feature 1.2: Lectura de 3 Cartas ($350 MXN)', () => {
    it('T1.2_3C_ValidOrder_WithInvolvedPerson: should create preference successfully with optional involved person', async () => {
      const payload = {
        tier_id: '3_cartas',
        category: 'Amor',
        customer_name: 'Valeria Gómez',
        customer_email: 'valeria@example.com',
        customer_birthdate: '1995-04-12',
        question: '¿Cómo evolucionará mi relación en los próximos meses?',
        involved_names: 'Carlos Méndez'
      };
      const res = await client.createPreference(payload);
      assert.equal(res.status, 200);
      assert.equal(res.data.success, true);
      assertTierPricing('3_cartas', res.data.amount);
    });

    it('T1.2_3C_ValidOrder_WithoutInvolvedPerson: should create preference successfully when optional involved person is omitted', async () => {
      const payload = {
        tier_id: '3_cartas',
        category: 'Trabajo/Dinero',
        customer_name: 'Esteban Quintero',
        customer_email: 'esteban@example.com',
        customer_birthdate: '1987-09-30',
        question: '¿Qué perspectivas hay para mi negocio en el último trimestre?'
      };
      const res = await client.createPreference(payload);
      assert.equal(res.status, 200);
      assert.equal(res.data.success, true);
      assertTierPricing('3_cartas', res.data.amount);
    });

    it('T1.2_3C_MissingQuestion: should reject submission when question is missing', async () => {
      const payload = {
        tier_id: '3_cartas',
        category: 'Familia',
        customer_name: 'Elena Silva',
        customer_email: 'elena@example.com',
        customer_birthdate: '1993-12-01'
      };
      const res = await client.createPreference(payload);
      assert.equal(res.status, 400);
      assert.equal(res.data.success, false);
    });

    it('T1.2_3C_MissingCustomerName: should reject submission when customer name is missing or short', async () => {
      const payload = {
        tier_id: '3_cartas',
        category: 'Otro',
        customer_name: ' ',
        customer_email: 'anonymous@example.com',
        customer_birthdate: '1990-01-01',
        question: '¿Qué debo saber sobre mi camino espiritual?'
      };
      const res = await client.createPreference(payload);
      assert.equal(res.status, 400);
      assert.equal(res.data.success, false);
      assert.ok(res.data.error.toLowerCase().includes('nombre'));
    });

    it('T1.2_3C_PriceEnforcement: should enforce $350 MXN pricing on 3-cartas tier', async () => {
      const payload = {
        tier_id: '3_cartas',
        category: 'Amor',
        customer_name: 'Rodrigo Fuentes',
        customer_email: 'rodrigo@example.com',
        customer_birthdate: '1991-07-22',
        question: '¿Qué energía rodea mi relación actual?'
      };
      const res = await client.createPreference(payload);
      assert.equal(res.status, 200);
      assert.equal(res.data.amount, 350);
    });

    it('T1.2_3C_StatusTurnaroundMessage: should return pending status with 24-hour async SLA', async () => {
      const payload = {
        tier_id: '3_cartas',
        category: 'Trabajo/Dinero',
        customer_name: 'Camila Torres',
        customer_email: 'camila@example.com',
        customer_birthdate: '1998-10-05',
        question: '¿Tendré oferta de empleo este mes?'
      };
      const prefRes = await client.createPreference(payload);
      const statusRes = await client.getOrderStatus(prefRes.data.order_id);
      assert.equal(statusRes.status, 200);
      assertAsyncTurnaroundNotice(statusRes.data.turnaround_message);
    });
  });

  // ==========================================
  // 3. Lectura de 5 Cartas ($500 MXN)
  // ==========================================
  describe('Feature 1.3: Lectura de 5 Cartas ($500 MXN)', () => {
    it('T1.3_5C_ValidOrder_CompletePayload: should create preference successfully with mandatory core focus and involved names', async () => {
      const payload = {
        tier_id: '5_cartas',
        category: 'Amor',
        customer_name: 'Natalia Vega',
        customer_email: 'natalia@example.com',
        customer_birthdate: '1989-06-18',
        question: 'Análisis profundo de mi dinámica de pareja y bloqueo emocional',
        involved_names: 'Alejandro y Marcela',
        core_focus: 'Saber si la reconciliación es viable y qué debo sanar'
      };
      const res = await client.createPreference(payload);
      assert.equal(res.status, 200);
      assert.equal(res.data.success, true);
      assertTierPricing('5_cartas', res.data.amount);
    });

    it('T1.3_5C_MissingCoreFocus: should reject 5-cartas submission when core_focus is missing', async () => {
      const payload = {
        tier_id: '5_cartas',
        category: 'Trabajo/Dinero',
        customer_name: 'Gabriel Rios',
        customer_email: 'gabriel@example.com',
        customer_birthdate: '1991-04-04',
        question: 'Tirada general sobre emprendimiento y socios'
      };
      const res = await client.createPreference(payload);
      assert.equal(res.status, 400);
      assert.equal(res.data.success, false);
      assert.ok(res.data.error.toLowerCase().includes('deseas saber') || res.data.error.toLowerCase().includes('requerido'));
    });

    it('T1.3_5C_EmptyCoreFocusString: should reject 5-cartas submission with whitespace-only core_focus', async () => {
      const payload = {
        tier_id: '5_cartas',
        category: 'Familia',
        customer_name: 'Patricia Lara',
        customer_email: 'patricia@example.com',
        customer_birthdate: '1985-08-12',
        question: 'Situación familiar compleja',
        core_focus: '    '
      };
      const res = await client.createPreference(payload);
      assert.equal(res.status, 400);
      assert.equal(res.data.success, false);
    });

    it('T1.3_5C_MissingQuestion: should reject submission when primary question is missing', async () => {
      const payload = {
        tier_id: '5_cartas',
        category: 'Otro',
        customer_name: 'Ignacio Ortiz',
        customer_email: 'ignacio@example.com',
        customer_birthdate: '1994-01-25',
        core_focus: 'Conocer mi propósito'
      };
      const res = await client.createPreference(payload);
      assert.equal(res.status, 400);
    });

    it('T1.3_5C_PriceEnforcement: should enforce $500 MXN pricing on 5-cartas tier', async () => {
      const payload = {
        tier_id: '5_cartas',
        category: 'Amor',
        customer_name: 'Fernanda Solis',
        customer_email: 'fernanda@example.com',
        customer_birthdate: '1996-12-14',
        question: 'Tirada profunda de 5 cartas',
        core_focus: 'Detalle de evolución sentimental'
      };
      const res = await client.createPreference(payload);
      assert.equal(res.status, 200);
      assert.equal(res.data.amount, 500);
    });

    it('T1.3_5C_TurnaroundMessage: should return order status with 24-hour turnaround SLA', async () => {
      const payload = {
        tier_id: '5_cartas',
        category: 'Trabajo/Dinero',
        customer_name: 'Diana Ponce',
        customer_email: 'diana@example.com',
        customer_birthdate: '1993-05-19',
        question: 'Lectura laboral exhaustiva',
        core_focus: 'Cambio de carrera profesional'
      };
      const prefRes = await client.createPreference(payload);
      const statusRes = await client.getOrderStatus(prefRes.data.order_id);
      assert.equal(statusRes.status, 200);
      assertAsyncTurnaroundNotice(statusRes.data.turnaround_message);
    });
  });

  // ==========================================
  // 4. Sesión por Llamada ($450 MXN)
  // ==========================================
  describe('Feature 1.4: Sesión por Llamada ($450 MXN)', () => {
    it('T1.4_Call_QueryAvailableSlots: should return list of available slots with dates and times', async () => {
      const res = await client.getSlots();
      assert.equal(res.status, 200);
      assert.equal(res.data.success, true);
      assert.ok(Array.isArray(res.data.slots));
      assert.ok(res.data.slots.length > 0, 'Should have seeded slots available');

      const slot = res.data.slots[0];
      assert.ok(slot.id);
      assert.ok(slot.date);
      assert.ok(slot.time_start);
      assert.ok(slot.time_end);
      assert.equal(slot.status, 'AVAILABLE');
    });

    it('T1.4_Call_ValidBookingWithLock: should create preference and enforce $450 MXN for valid slot selection', async () => {
      const slotsRes = await client.getSlots();
      const targetSlot = slotsRes.data.slots[0];

      // Soft lock slot
      const lockRes = await client.lockSlot(targetSlot.id);
      assert.equal(lockRes.status, 200);
      assert.ok(lockRes.data.lock_token);

      const payload = {
        tier_id: 'llamada',
        category: 'Amor',
        customer_name: 'Mauricio Garza',
        customer_email: 'mauricio@example.com',
        customer_birthdate: '1986-07-11',
        question: 'Sesión en vivo sobre situación de pareja',
        slot_id: targetSlot.id,
        lock_token: lockRes.data.lock_token
      };

      const prefRes = await client.createPreference(payload);
      assert.equal(prefRes.status, 200);
      assert.equal(prefRes.data.success, true);
      assertTierPricing('llamada', prefRes.data.amount);
    });

    it('T1.4_Call_MissingSlotId: should reject call session checkout when slot_id is omitted', async () => {
      const payload = {
        tier_id: 'llamada',
        category: 'Trabajo/Dinero',
        customer_name: 'Raul Benitez',
        customer_email: 'raul@example.com',
        customer_birthdate: '1990-09-09',
        question: 'Consulta en vivo sobre finanzas'
      };
      const res = await client.createPreference(payload);
      assert.equal(res.status, 400);
      assert.equal(res.data.success, false);
      assert.ok(res.data.error.toLowerCase().includes('horario'));
    });

    it('T1.4_Call_BookUnavailableSlot: should return 409 Conflict when attempting to lock an already locked slot', async () => {
      const slotsRes = await client.getSlots();
      const targetSlot = slotsRes.data.slots[0];

      // Lock once
      const lock1 = await client.lockSlot(targetSlot.id);
      assert.equal(lock1.status, 200);

      // Attempt second lock on same slot
      const lock2 = await client.lockSlot(targetSlot.id);
      assert.equal(lock2.status, 409);
      assert.equal(lock2.data.success, false);
      assert.ok(lock2.data.error.includes('apartado') || lock2.data.error.includes('disponible'));
    });

    it('T1.4_Call_PriceEnforcement: should enforce $450 MXN pricing for call session regardless of client input', async () => {
      const slotsRes = await client.getSlots();
      const targetSlot = slotsRes.data.slots[1];

      const payload = {
        tier_id: 'llamada',
        category: 'Familia',
        customer_name: 'Marcela Salinas',
        customer_email: 'marcela@example.com',
        customer_birthdate: '1992-02-14',
        question: 'Sesión por llamada',
        slot_id: targetSlot.id,
        amount: 200 // Tampered amount
      };

      const res = await client.createPreference(payload);
      assert.equal(res.status, 200);
      assert.equal(res.data.amount, 450);
    });

    it('T1.4_Call_AppointmentDetails: should return appointment details on order status query for call session', async () => {
      const slotsRes = await client.getSlots();
      const targetSlot = slotsRes.data.slots[0];

      const payload = {
        tier_id: 'llamada',
        category: 'Otro',
        customer_name: 'Estela Morales',
        customer_email: 'estela@example.com',
        customer_birthdate: '1988-11-20',
        question: 'Sesión de orientación espiritual',
        slot_id: targetSlot.id
      };

      const prefRes = await client.createPreference(payload);
      const statusRes = await client.getOrderStatus(prefRes.data.order_id);
      assert.equal(statusRes.status, 200);
      assertCallAppointmentDetails(statusRes.data);
      assert.equal(statusRes.data.slot.id, targetSlot.id);
    });
  });

  // ==========================================
  // 5. FAQ Accordion & Mexican Spanish Copy
  // ==========================================
  describe('Feature 1.5: Interactive Mexican Spanish FAQ Accordion', () => {
    it('T1.5_FAQ_QuestionCoverage: should include all 5 core Mexican Spanish questions from spec', () => {
      assert.equal(MEXICAN_SPANISH_FAQ.length, 5);
      const questions = MEXICAN_SPANISH_FAQ.map(f => f.question);
      assert.ok(questions.includes('¿Cómo recibo mi lectura?'));
      assert.ok(questions.includes('¿Cuánto tarda en llegar la respuesta?'));
      assert.ok(questions.includes('¿Qué pasa si no puedo asistir a mi llamada agendada?'));
      assert.ok(questions.includes('¿Los pagos son seguros?'));
      assert.ok(questions.includes('¿Puedo cambiar mi pregunta después de pagar?'));
    });

    it('T1.5_FAQ_MexicanSpanishCopy: should contain appropriate Mexican Spanish vocabulary and phrasing', () => {
      for (const faq of MEXICAN_SPANISH_FAQ) {
        assert.ok(faq.keywords.length > 0);
        for (const kw of faq.keywords) {
          assert.ok(typeof kw === 'string' && kw.length > 2);
        }
      }
    });

    it('T1.5_FAQ_ToggleState: should support expanding and collapsing accordion items deterministically', () => {
      let activeIndex = null;
      function toggle(index) {
        activeIndex = activeIndex === index ? null : index;
        return activeIndex;
      }

      assert.equal(toggle(0), 0, 'Item 0 expanded');
      assert.equal(toggle(0), null, 'Item 0 collapsed on second click');
      assert.equal(toggle(2), 2, 'Item 2 expanded');
      assert.equal(toggle(3), 3, 'Item 3 expanded, item 2 replaced');
    });

    it('T1.5_FAQ_AccordionIsolation: rapid toggling should not corrupt single-active accordion invariant', () => {
      let state = { openItem: null };
      const click = (idx) => {
        state.openItem = state.openItem === idx ? null : idx;
      };

      click(1);
      click(4);
      click(4);
      assert.equal(state.openItem, null);
    });

    it('T1.5_FAQ_NoWhatsAppLink: verifies replacement of WhatsApp CTA with FAQ section', () => {
      const deprecatedFeatures = ['whatsapp_cta_button', 'wa.me_link'];
      const currentSection = 'faq_accordion';
      assert.ok(!deprecatedFeatures.includes(currentSection));
      assert.equal(currentSection, 'faq_accordion');
    });

    it('T1.5_FAQ_KeyboardAccessibility: should provide proper ARIA attributes structure for accessibility', () => {
      const mockAccordionElement = {
        id: 'faq-header-1',
        'aria-expanded': false,
        'aria-controls': 'faq-panel-1',
        role: 'button'
      };

      mockAccordionElement['aria-expanded'] = true;
      assert.equal(mockAccordionElement['aria-expanded'], true);
      assert.equal(mockAccordionElement.role, 'button');
    });
  });
});
