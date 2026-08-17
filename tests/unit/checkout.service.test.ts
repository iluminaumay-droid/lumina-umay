import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { db, closeDatabase } from '../../src/server/db/database.js';
import { SlotService } from '../../src/server/services/slot.service.js';
import { createApp } from '../../src/server/app.js';
import { isValidBirthdate } from '../../src/server/validators/checkout.validator.js';
import { MercadoPagoService } from '../../src/server/services/mercadopago.service.js';

describe('Checkout Service & Preference Creation Unit Tests', () => {
  const app = createApp();
  const testSlotId = 'checkout-test-slot-1';

  beforeEach(() => {
    SlotService.resetVirtualTime();
    db.prepare(`DELETE FROM webhook_events`).run();
    db.prepare(`DELETE FROM orders`).run();
    db.prepare(`DELETE FROM slots`).run();

    const futureStart = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const futureEnd = new Date(Date.now() + 48 * 60 * 60 * 1000 + 45 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO slots (id, start_time, end_time, status)
      VALUES (?, ?, ?, 'available')
    `).run(testSlotId, futureStart, futureEnd);
  });

  afterAll(() => {
    SlotService.stopSweeper();
    closeDatabase();
  });

  describe('1. Birthdate Gregorian Calendar Validation', () => {
    it('accepts valid historical calendar dates', () => {
      expect(isValidBirthdate('1990-05-15')).toBe(true);
      expect(isValidBirthdate('1984-12-31')).toBe(true);
      expect(isValidBirthdate('2000-02-29')).toBe(true); // Leap year 2000
    });

    it('rejects invalid leap year dates like 2023-02-29 and non-existent calendar dates like 2023-02-30', () => {
      expect(isValidBirthdate('2023-02-29')).toBe(false); // 2023 is not leap year
      expect(isValidBirthdate('2023-02-30')).toBe(false);
      expect(isValidBirthdate('2023-04-31')).toBe(false); // April has 30 days
      expect(isValidBirthdate('2023-06-31')).toBe(false); // June has 30 days
    });

    it('rejects future dates and unreasonable historical dates (<1900)', () => {
      expect(isValidBirthdate('2050-01-01')).toBe(false);
      expect(isValidBirthdate('1899-12-31')).toBe(false);
    });

    it('rejects malformed date formats', () => {
      expect(isValidBirthdate('31-12-1990')).toBe(false);
      expect(isValidBirthdate('1990/05/10')).toBe(false);
      expect(isValidBirthdate('not-a-date')).toBe(false);
    });
  });

  describe('2. Server-Enforced Pricing Matrix', () => {
    it('strictly enforces $150 MXN for 1_carta regardless of client input', async () => {
      const res = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: '1_carta',
          category: 'Amor',
          customer_name: 'Ana Sofia',
          customer_email: 'ana@example.com',
          customer_birthdate: '1995-04-20',
          question: '¿Tendré suerte en el amor?',
          amount: 1, // Tamper attempt
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.amount).toBe(150);

      const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(res.body.order_id) as any;
      expect(order.amount_mxn).toBe(150);
    });

    it('strictly enforces $350 MXN for 3_cartas', async () => {
      const res = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: '3_cartas',
          category: 'Trabajo/Dinero',
          customer_name: 'Roberto Gomez',
          customer_email: 'roberto@example.com',
          customer_birthdate: '1988-10-12',
          question: '¿Mejorará mi situación laboral?',
          involved_names: 'Jefe actual',
          amount: 9999, // Tamper attempt
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.amount).toBe(350);
    });

    it('strictly enforces $500 MXN for 5_cartas', async () => {
      const res = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: '5_cartas',
          category: 'Familia',
          customer_name: 'Claudia Ortiz',
          customer_email: 'claudia.o@example.com',
          customer_birthdate: '1982-03-25',
          question: 'Situación familiar compleja',
          core_focus: 'Saber cómo sanar el conflicto',
          amount: 50, // Tamper attempt
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.amount).toBe(500);
    });

    it('strictly enforces $450 MXN for llamada / call_session', async () => {
      const res = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: 'llamada',
          category: 'Otro',
          customer_name: 'Daniel Vargas',
          customer_email: 'daniel@example.com',
          customer_birthdate: '1991-07-19',
          question: 'Consulta espiritual en vivo',
          slot_id: testSlotId,
          amount: 10,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.amount).toBe(450);
    });
  });

  describe('3. Dynamic Form Field Validation per Tier', () => {
    it('requires core_focus for 5_cartas and rejects when missing or empty', async () => {
      const failRes = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: '5_cartas',
          category: 'Amor',
          customer_name: 'Lucia Mendez',
          customer_email: 'lucia@example.com',
          customer_birthdate: '1990-01-01',
          question: 'Tirada de 5 cartas',
        });

      expect(failRes.status).toBe(400);
      expect(failRes.body.success).toBe(false);
      expect(failRes.body.error).toContain('deseas saber');

      const passRes = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: '5_cartas',
          category: 'Amor',
          customer_name: 'Lucia Mendez',
          customer_email: 'lucia@example.com',
          customer_birthdate: '1990-01-01',
          question: 'Tirada de 5 cartas',
          core_focus: 'Evolución sentimental del año',
        });

      expect(passRes.status).toBe(200);
      expect(passRes.body.success).toBe(true);
    });

    it('requires slot_id for call session tier and rejects when missing', async () => {
      const res = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: 'llamada',
          category: 'Trabajo/Dinero',
          customer_name: 'Mario Casas',
          customer_email: 'mario@example.com',
          customer_birthdate: '1989-08-08',
          question: 'Sesión por llamada',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('horario');
    });

    it('rejects invalid category with Mexican Spanish error message', async () => {
      const res = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: '1_carta',
          category: 'Invalida',
          customer_name: 'Test Cat',
          customer_email: 'cat@example.com',
          customer_birthdate: '1990-01-01',
          question: 'Pregunta',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('categoría');
    });
  });

  describe('4. Slot Hold Verification & Concurrency on Call Session Checkout', () => {
    it('locks available slot upon create-preference if no lock_token provided', async () => {
      const res = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: 'llamada',
          category: 'Amor',
          customer_name: 'Enrique Iglesias',
          customer_email: 'enrique@example.com',
          customer_birthdate: '1985-05-08',
          question: 'Consulta amorosa',
          slot_id: testSlotId,
        });

      expect(res.status).toBe(200);
      const slot = SlotService.getSlotById(testSlotId);
      expect(slot?.status).toBe('locked');
    });

    it('rejects checkout when slot is locked by a competing user (409 Conflict)', async () => {
      // User 1 locks slot
      const lockRes = SlotService.acquireSoftLock(testSlotId, 15);
      expect(lockRes.lock_token).toBeDefined();

      // User 2 attempts preference creation on same slot with different/no token
      const res = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: 'llamada',
          category: 'Amor',
          customer_name: 'User 2',
          customer_email: 'user2@example.com',
          customer_birthdate: '1992-02-02',
          question: 'Consulta 2',
          slot_id: testSlotId,
          lock_token: 'different-token',
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('apartado');
    });
  });

  describe('5. Read-Only Order Status Endpoint & Anti-Spoofing', () => {
    it('returns PENDING and does not mutate database across repeated queries', async () => {
      const prefRes = await request(app)
        .post('/api/checkout/create-preference')
        .send({
          tier_id: '3_cartas',
          category: 'Amor',
          customer_name: 'Sofia Reyes',
          customer_email: 'sofia.reyes@example.com',
          customer_birthdate: '1994-06-14',
          question: 'Lectura general de amor',
        });

      const orderId = prefRes.body.order_id;

      for (let i = 0; i < 10; i++) {
        const statusRes = await request(app).get(`/api/orders/${orderId}/status`);
        expect(statusRes.status).toBe(200);
        expect(statusRes.body.status).toBe('PENDING');
        expect(statusRes.body.turnaround_message).toContain('24 horas');
      }

      const orderInDb = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as any;
      expect(orderInDb.status).toBe('pending');
    });

    it('returns 404 for non-existent order', async () => {
      const res = await request(app).get('/api/orders/ord_non_existent_12345/status');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('no encontrado');
    });
  });
});
