/**
 * In-Process Reference Spec Server for Lumina Umay E2E Tests (ESM)
 * Implements strict specifications from PROJECT.md & spec v2.
 */

import http from 'node:http';
import crypto from 'node:crypto';

export class MockServer {
  constructor(port = 0) {
    this.port = port;
    this.server = null;
    this.actualPort = null;
    this.timeOffsetMs = 0;

    this.slots = [];
    this.orders = new Map();
    this.processedWebhooks = new Set();
    this.capturedEmails = [];
    this.webhookSecret = 'test_webhook_secret_key_123';

    this.resetState();
  }

  getCurrentTime() {
    return new Date(Date.now() + this.timeOffsetMs);
  }

  advanceTime(seconds) {
    this.timeOffsetMs += seconds * 1000;
    this.sweepExpiredLocks();
  }

  resetState() {
    this.timeOffsetMs = 0;
    this.orders.clear();
    this.processedWebhooks.clear();
    this.capturedEmails = [];

    // Seed realistic slots
    this.slots = [
      {
        id: 'slot_2026-08-20_1600',
        date: '2026-08-20',
        time_start: '16:00',
        time_end: '17:00',
        status: 'AVAILABLE',
        hold_token: null,
        locked_at: null,
        lock_expires_at: null,
        order_id: null
      },
      {
        id: 'slot_2026-08-20_1700',
        date: '2026-08-20',
        time_start: '17:00',
        time_end: '18:00',
        status: 'AVAILABLE',
        hold_token: null,
        locked_at: null,
        lock_expires_at: null,
        order_id: null
      },
      {
        id: 'slot_2026-08-21_1100',
        date: '2026-08-21',
        time_start: '11:00',
        time_end: '12:00',
        status: 'AVAILABLE',
        hold_token: null,
        locked_at: null,
        lock_expires_at: null,
        order_id: null
      },
      {
        id: 'slot_2026-08-21_1200',
        date: '2026-08-21',
        time_start: '12:00',
        time_end: '13:00',
        status: 'AVAILABLE',
        hold_token: null,
        locked_at: null,
        lock_expires_at: null,
        order_id: null
      }
    ];
  }

  sweepExpiredLocks() {
    const now = this.getCurrentTime();
    for (const slot of this.slots) {
      if (slot.status === 'SOFT_LOCKED' && slot.lock_expires_at) {
        if (new Date(slot.lock_expires_at) <= now) {
          slot.status = 'AVAILABLE';
          slot.hold_token = null;
          slot.locked_at = null;
          slot.lock_expires_at = null;
        }
      }
    }
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server.listen(this.port, '127.0.0.1', () => {
        this.actualPort = this.server.address().port;
        resolve(this.actualPort);
      });
      this.server.on('error', reject);
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  getBaseUrl() {
    return `http://127.0.0.1:${this.actualPort}`;
  }

  async parseBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
      });
      req.on('end', () => {
        if (!body) return resolve({});
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve({ raw: body });
        }
      });
      req.on('error', reject);
    });
  }

  sendJson(res, statusCode, data) {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(data));
  }

  async handleRequest(req, res) {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const method = req.method;

    // Sweeping expired locks on every request
    this.sweepExpiredLocks();

    // CORS preflight
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-signature'
      });
      return res.end();
    }

    try {
      // Test Inspection & Reset Endpoints
      if (pathname === '/api/test/reset' && method === 'POST') {
        this.resetState();
        return this.sendJson(res, 200, { success: true, message: 'State reset' });
      }

      if (pathname === '/api/test/advance-time' && method === 'POST') {
        const body = await this.parseBody(req);
        this.advanceTime(body.seconds || 0);
        return this.sendJson(res, 200, { success: true, currentTime: this.getCurrentTime().toISOString() });
      }

      if (pathname === '/api/test/emails' && method === 'GET') {
        return this.sendJson(res, 200, { success: true, emails: this.capturedEmails });
      }

      // 1. GET /api/slots
      if (pathname === '/api/slots' && method === 'GET') {
        const availableSlots = this.slots
          .filter(s => s.status === 'AVAILABLE')
          .map(s => ({
            id: s.id,
            date: s.date,
            time_start: s.time_start,
            time_end: s.time_end,
            status: s.status
          }));
        return this.sendJson(res, 200, { success: true, slots: availableSlots });
      }

      // 2. POST /api/slots/:id/lock
      const lockMatch = pathname.match(/^\/api\/slots\/([^/]+)\/lock$/);
      if (lockMatch && method === 'POST') {
        const slotId = lockMatch[1];
        const slot = this.slots.find(s => s.id === slotId);

        if (!slot) {
          return this.sendJson(res, 404, { success: false, error: 'Horario no encontrado' });
        }

        if (slot.status !== 'AVAILABLE') {
          return this.sendJson(res, 409, {
            success: false,
            error: 'El horario seleccionado ya fue apartado por otra persona. Por favor elige otro horario.'
          });
        }

        const token = crypto.randomUUID();
        const now = this.getCurrentTime();
        const expiresAt = new Date(now.getTime() + 15 * 60 * 1000); // 15 mins TTL

        slot.status = 'SOFT_LOCKED';
        slot.hold_token = token;
        slot.locked_at = now.toISOString();
        slot.lock_expires_at = expiresAt.toISOString();

        return this.sendJson(res, 200, {
          success: true,
          lock_token: token,
          expires_at: slot.lock_expires_at
        });
      }

      // 3. POST /api/slots/:id/release
      const releaseMatch = pathname.match(/^\/api\/slots\/([^/]+)\/release$/);
      if (releaseMatch && method === 'POST') {
        const slotId = releaseMatch[1];
        const body = await this.parseBody(req);
        const slot = this.slots.find(s => s.id === slotId);

        if (!slot) {
          return this.sendJson(res, 404, { success: false, error: 'Horario no encontrado' });
        }

        if (slot.status === 'SOFT_LOCKED' && (!body.lock_token || slot.hold_token === body.lock_token)) {
          slot.status = 'AVAILABLE';
          slot.hold_token = null;
          slot.locked_at = null;
          slot.lock_expires_at = null;
        }

        return this.sendJson(res, 200, { success: true, message: 'Horario liberado exitosamente' });
      }

      // 4. POST /api/checkout/create-preference
      if (pathname === '/api/checkout/create-preference' && method === 'POST') {
        const body = await this.parseBody(req);
        const {
          tier_id,
          category,
          customer_name,
          customer_email,
          customer_birthdate,
          question,
          involved_names,
          core_focus,
          slot_id,
          lock_token
        } = body;

        // Validation
        const validTiers = ['1_carta', '3_cartas', '5_cartas', 'llamada'];
        if (!validTiers.includes(tier_id)) {
          return this.sendJson(res, 400, { success: false, error: 'Tipo de lectura no válido' });
        }

        const validCategories = ['Amor', 'Trabajo/Dinero', 'Familia', 'Otro'];
        if (!category || !validCategories.includes(category)) {
          return this.sendJson(res, 400, { success: false, error: 'Por favor selecciona una categoría válida' });
        }

        if (!customer_name || typeof customer_name !== 'string' || customer_name.trim().length < 2) {
          return this.sendJson(res, 400, { success: false, error: 'Nombre del consultante requerido' });
        }

        if (!customer_email || !customer_email.includes('@')) {
          return this.sendJson(res, 400, { success: false, error: 'Correo electrónico válido requerido' });
        }

        // Validate birthdate (YYYY-MM-DD, strict calendar validity, past date, reasonable age)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!customer_birthdate || !dateRegex.test(customer_birthdate)) {
          return this.sendJson(res, 400, { success: false, error: 'Por favor ingresa una fecha de nacimiento válida.' });
        }
        const [year, month, day] = customer_birthdate.split('-').map(Number);
        const birthDateObj = new Date(Date.UTC(year, month - 1, day));
        const now = this.getCurrentTime();
        if (
          isNaN(birthDateObj.getTime()) ||
          birthDateObj.getUTCFullYear() !== year ||
          birthDateObj.getUTCMonth() !== month - 1 ||
          birthDateObj.getUTCDate() !== day ||
          birthDateObj >= now ||
          year < 1900
        ) {
          return this.sendJson(res, 400, { success: false, error: 'Por favor ingresa una fecha de nacimiento válida.' });
        }

        if (!question || typeof question !== 'string' || question.trim().length === 0) {
          return this.sendJson(res, 400, { success: false, error: 'Por favor ingresa tu pregunta o consulta' });
        }

        // Tier-specific validation
        if (tier_id === '5_cartas') {
          if (!core_focus || typeof core_focus !== 'string' || core_focus.trim().length === 0) {
            return this.sendJson(res, 400, { success: false, error: 'Por favor especifica qué es lo que más deseas saber' });
          }
        }

        let selectedSlot = null;
        if (tier_id === 'llamada') {
          if (!slot_id) {
            return this.sendJson(res, 400, { success: false, error: 'Por favor selecciona un horario para tu llamada' });
          }
          selectedSlot = this.slots.find(s => s.id === slot_id);
          if (!selectedSlot) {
            return this.sendJson(res, 404, { success: false, error: 'Horario no encontrado' });
          }
          if (selectedSlot.status === 'BOOKED') {
            return this.sendJson(res, 409, { success: false, error: 'El horario seleccionado ya no está disponible' });
          }
          if (selectedSlot.status === 'AVAILABLE') {
            // Auto lock
            selectedSlot.status = 'SOFT_LOCKED';
            selectedSlot.hold_token = lock_token || crypto.randomUUID();
            selectedSlot.locked_at = now.toISOString();
            selectedSlot.lock_expires_at = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
          }
        }

        // Pricing enforcement
        const priceMap = {
          '1_carta': 150,
          '3_cartas': 350,
          '5_cartas': 500,
          'llamada': 450
        };
        const serverEnforcedAmount = priceMap[tier_id];

        const orderId = `ord_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
        const preferenceId = `pref_${crypto.randomUUID()}`;

        const order = {
          id: orderId,
          tier_id,
          tier_name: tier_id === '1_carta' ? 'Lectura de 1 Carta' :
                     tier_id === '3_cartas' ? 'Lectura de 3 Cartas' :
                     tier_id === '5_cartas' ? 'Lectura de 5 Cartas' : 'Sesión por Llamada',
          category,
          amount: serverEnforcedAmount,
          currency: 'MXN',
          customer_name: customer_name.trim(),
          customer_email: customer_email.trim(),
          customer_birthdate,
          question: question.trim(),
          involved_names: involved_names ? involved_names.trim() : null,
          core_focus: core_focus ? core_focus.trim() : null,
          slot_id: selectedSlot ? selectedSlot.id : null,
          slot_date: selectedSlot ? selectedSlot.date : null,
          slot_time: selectedSlot ? `${selectedSlot.time_start} - ${selectedSlot.time_end}` : null,
          payment_status: 'PENDING',
          mp_preference_id: preferenceId,
          mp_payment_id: null,
          created_at: now.toISOString(),
          updated_at: now.toISOString()
        };

        if (selectedSlot) {
          selectedSlot.order_id = orderId;
        }

        this.orders.set(orderId, order);

        return this.sendJson(res, 200, {
          success: true,
          order_id: orderId,
          preference_id: preferenceId,
          init_point: `https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=${preferenceId}`,
          sandbox_init_point: `https://sandbox.mercadopago.com.mx/checkout/v1/redirect?pref_id=${preferenceId}`,
          amount: serverEnforcedAmount
        });
      }

      // 5. GET /api/orders/:order_id/status
      const statusMatch = pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
      if (statusMatch && method === 'GET') {
        const orderId = statusMatch[1];
        const order = this.orders.get(orderId);

        if (!order) {
          return this.sendJson(res, 404, { success: false, error: 'Pedido no encontrado' });
        }

        const turnaroundMessage = order.tier_id === 'llamada'
          ? `Sesión agendada para el ${order.slot_date} de ${order.slot_time} hrs.`
          : 'Responderemos en un plazo máximo de 24 horas a tu correo electrónico con tu lectura.';

        let slotInfo = null;
        if (order.slot_id) {
          const s = this.slots.find(x => x.id === order.slot_id);
          if (s) {
            slotInfo = {
              id: s.id,
              date: s.date,
              time_start: s.time_start,
              time_end: s.time_end,
              status: s.status
            };
          }
        }

        return this.sendJson(res, 200, {
          success: true,
          order_id: order.id,
          status: order.payment_status,
          tier_id: order.tier_id,
          tier_name: order.tier_name,
          turnaround_message: turnaroundMessage,
          slot: slotInfo,
          amount: order.amount
        });
      }

      // 6. POST /api/webhooks/mercadopago
      if (pathname === '/api/webhooks/mercadopago' && method === 'POST') {
        const signatureHeader = req.headers['x-signature'];

        // Webhook signature authentication test
        if (signatureHeader && signatureHeader.startsWith('invalid_signature')) {
          return this.sendJson(res, 401, { success: false, error: 'Firma de webhook no válida' });
        }

        const body = await this.parseBody(req);
        const paymentId = (body.data && body.data.id) || body.id || parsedUrl.searchParams.get('id') || `mp_pay_${Date.now()}`;
        const orderId = (body.data && body.data.external_reference) || body.external_reference || body.order_id;
        const paymentStatus = (body.data && body.data.status) || body.status || 'approved';

        // Webhook Idempotency check
        if (this.processedWebhooks.has(paymentId)) {
          return this.sendJson(res, 200, { success: true, message: 'Webhook ya procesado (idempotente)' });
        }
        this.processedWebhooks.add(paymentId);

        const order = this.orders.get(orderId);
        if (!order) {
          // If order not found in mock store, acknowledge webhook without crashing
          return this.sendJson(res, 200, { success: true, message: 'Notificación recibida sin orden vinculada' });
        }

        order.mp_payment_id = String(paymentId);
        order.updated_at = this.getCurrentTime().toISOString();

        if (paymentStatus === 'approved') {
          order.payment_status = 'APPROVED';

          // Call session slot permanence
          if (order.slot_id) {
            const slot = this.slots.find(s => s.id === order.slot_id);
            if (slot) {
              if (slot.status === 'BOOKED' && slot.order_id !== order.id) {
                // Overbooking collision detected
                order.payment_status = 'OVERBOOKED_NEEDS_RESCHEDULING';
              } else {
                slot.status = 'BOOKED';
                slot.order_id = order.id;
                slot.hold_token = null;
                slot.lock_expires_at = null;
              }
            }
          }

          // Dispatch Claudia notification email
          const claudiaEmail = {
            to: 'claudia@luminaway.com',
            subject: `✨ Nueva Lectura Pagada: ${order.tier_name} - ${order.customer_name}`,
            body: `
              ID del Pedido: ${order.id}
              ID de Pago Mercado Pago: ${paymentId}
              Servicio: ${order.tier_name}
              Monto: $${order.amount} MXN
              Categoría: ${order.category}
              Nombre: ${order.customer_name}
              Email: ${order.customer_email}
              Fecha de Nacimiento: ${order.customer_birthdate}
              Pregunta: ${order.question}
              Persona(s) Involucrada(s): ${order.involved_names || 'No especificado'}
              Qué desea saber: ${order.core_focus || 'N/A'}
              Horario de Llamada: ${order.slot_date ? `${order.slot_date} a las ${order.slot_time}` : 'N/A'}
            `.trim()
          };
          this.capturedEmails.push(claudiaEmail);

          // Dispatch Customer confirmation email
          const customerEmail = {
            to: order.customer_email,
            subject: `🔮 Confirmación de tu consulta en Lumina Umay - ${order.id}`,
            body: order.tier_id === 'llamada'
              ? `Hola ${order.customer_name}, tu sesión de llamada ha quedado confirmada para el ${order.slot_date} en horario ${order.slot_time}.`
              : `Hola ${order.customer_name}, hemos confirmado tu pago para tu ${order.tier_name}. Claudia enviará tu lectura en un plazo máximo de 24 horas a este correo.`
          };
          this.capturedEmails.push(customerEmail);

        } else if (paymentStatus === 'rejected' || paymentStatus === 'cancelled') {
          order.payment_status = paymentStatus === 'rejected' ? 'REJECTED' : 'CANCELLED';

          // Release soft-locked slot back to AVAILABLE
          if (order.slot_id) {
            const slot = this.slots.find(s => s.id === order.slot_id);
            if (slot && slot.status === 'SOFT_LOCKED') {
              slot.status = 'AVAILABLE';
              slot.hold_token = null;
              slot.locked_at = null;
              slot.lock_expires_at = null;
              slot.order_id = null;
            }
          }
        }

        return this.sendJson(res, 200, { success: true, order_id: order.id, status: order.payment_status });
      }

      // 404 for unknown endpoints
      return this.sendJson(res, 404, { success: false, error: 'Endpoint no encontrado' });

    } catch (err) {
      return this.sendJson(res, 500, { success: false, error: err.message });
    }
  }
}
