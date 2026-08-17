/**
 * Unit & Integration Test Suite for Client Static Serving & Frontend Assets (Milestone 4)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/app.js';
import type { Express } from 'express';

describe('Milestone 4: Client Static Serving & Frontend Integration', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  it('serves index.html at root (GET /) with HTTP 200 and text/html content type', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('Lumina Umay');
    expect(res.text).toContain('Lecturas de Tarot');
  });

  it('serves styles.css with HTTP 200 and brand color tokens', async () => {
    const res = await request(app).get('/styles.css');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/css');
    expect(res.text).toContain('--teal: #0d2b2a;');
    expect(res.text).toContain('--teal-deep: #081d1c;');
    expect(res.text).toContain('--gold: #d4af37;');
    expect(res.text).toContain('--cream: #fbf8f2;');
    expect(res.text).toContain('Cormorant Garamond');
    expect(res.text).toContain('Jost');
  });

  it('serves app.js with HTTP 200 and client application logic', async () => {
    const res = await request(app).get('/app.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/javascript');
    expect(res.text).toContain('TIER_METADATA');
    expect(res.text).toContain('/api/checkout/create-preference');
    expect(res.text).toContain('/api/slots');
    expect(res.text).toContain('/api/orders/');
  });

  it('provides SPA fallback routing for client navigation (e.g. GET /checkout/success)', async () => {
    const res = await request(app).get('/checkout/success?order_id=ord_test_123');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('Lumina Umay');
    expect(res.text).toContain('id="confirmation-modal"');
  });

  it('contains all 4 product tiers in index.html with exact pricing', async () => {
    const res = await request(app).get('/');
    expect(res.text).toContain('1_carta');
    expect(res.text).toContain('$150');
    expect(res.text).toContain('3_cartas');
    expect(res.text).toContain('$350');
    expect(res.text).toContain('5_cartas');
    expect(res.text).toContain('$500');
    expect(res.text).toContain('llamada');
    expect(res.text).toContain('$450');
  });

  it('contains all 7 Mexican Spanish FAQ questions replacing WhatsApp CTA', async () => {
    const res = await request(app).get('/');
    expect(res.text).toContain('¿Cómo recibo mi lectura?');
    expect(res.text).toContain('¿Cuánto tarda en llegar la respuesta?');
    expect(res.text).toContain('¿Qué pasa si no puedo asistir a mi llamada agendada?');
    expect(res.text).toContain('¿Los pagos son seguros?');
    expect(res.text).toContain('¿Puedo cambiar mi pregunta después de pagar?');
    expect(res.text).toContain('¿Qué diferencia hay entre las lecturas de 1, 3 y 5 cartas?');
    expect(res.text).toContain('¿Cómo me preparo para mi sesión por llamada?');

    // WhatsApp CTA button must NOT be present
    expect(res.text).not.toContain('wa.me');
    expect(res.text).not.toContain('api.whatsapp.com');
  });

  it('contains the dynamic form fields for all reading tiers', async () => {
    const res = await request(app).get('/');
    expect(res.text).toContain('id="customer_name"');
    expect(res.text).toContain('id="customer_email"');
    expect(res.text).toContain('id="customer_phone"');
    expect(res.text).toContain('id="customer_birthdate"');
    expect(res.text).toContain('id="category"');
    expect(res.text).toContain('id="involved_names"');
    expect(res.text).toContain('id="core_focus"');
    expect(res.text).toContain('id="question"');
    expect(res.text).toContain('id="slot-picker-section"');
    expect(res.text).toContain('id="slot-lock-banner"');
    expect(res.text).toContain('id="submit-btn"');
  });

  it('contains Claudia blessing in the footer', async () => {
    const res = await request(app).get('/');
    expect(res.text).toContain('Con luz, gratitud y bendiciones — Claudia');
    expect(res.text).toContain('© 2026 Lumina Umay');
  });
});
