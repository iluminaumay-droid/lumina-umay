/**
 * Assertion Helpers & Domain Validators for Lumina Umay E2E Tests (ESM)
 */

import assert from 'node:assert/strict';

export const TIER_PRICING = {
  '1_carta': 150,
  '3_cartas': 350,
  '5_cartas': 500,
  'llamada': 450
};

export const VALID_CATEGORIES = ['Amor', 'Trabajo/Dinero', 'Familia', 'Otro'];

export const MEXICAN_SPANISH_FAQ = [
  {
    question: '¿Cómo recibo mi lectura?',
    keywords: ['correo electrónico', 'lectura', 'interpretación']
  },
  {
    question: '¿Cuánto tarda en llegar la respuesta?',
    keywords: ['24 horas', 'plazo', 'confirmación']
  },
  {
    question: '¿Qué pasa si no puedo asistir a mi llamada agendada?',
    keywords: ['reprogramar', '4 horas', 'anticipación']
  },
  {
    question: '¿Los pagos son seguros?',
    keywords: ['Mercado Pago', 'segura', 'cifrada']
  },
  {
    question: '¿Puedo cambiar mi pregunta después de pagar?',
    keywords: ['2 horas', 'Claudia', 'preparación']
  }
];

/**
 * Asserts that price matches server-enforced price for tier
 */
export function assertTierPricing(tierId, actualAmount) {
  const expected = TIER_PRICING[tierId];
  assert.ok(expected !== undefined, `Unknown tier ID: ${tierId}`);
  assert.equal(actualAmount, expected, `Expected tier ${tierId} to cost $${expected} MXN, but got $${actualAmount}`);
}

/**
 * Asserts valid Mexican Spanish turnaround text for async readings
 */
export function assertAsyncTurnaroundNotice(message) {
  assert.ok(message, 'Turnaround message should not be empty');
  assert.ok(
    message.toLowerCase().includes('24 horas'),
    `Expected turnaround notice to mention '24 horas', got: "${message}"`
  );
}

/**
 * Asserts valid call appointment message
 */
export function assertCallAppointmentDetails(statusData) {
  assert.ok(statusData, 'Status data required');
  assert.ok(statusData.slot, 'Slot information required for call session');
  assert.ok(statusData.slot.date, 'Slot date required');
  assert.ok(statusData.slot.time_start, 'Slot start time required');
}

/**
 * Asserts Claudia email contains all required consultation fields
 */
export function assertClaudiaEmailPayload(email, expectedData) {
  assert.ok(email, 'Claudia email must be present');
  assert.ok(email.to.toLowerCase().includes('claudia') || email.to.includes('@'), 'Must be addressed to Claudia');
  assert.ok(email.subject.includes(expectedData.customer_name) || email.body.includes(expectedData.customer_name), 'Must contain customer name');
  assert.ok(email.body.includes(expectedData.customer_birthdate), 'Must contain customer birthdate');
  assert.ok(email.body.includes(expectedData.category), 'Must contain reading category');
  assert.ok(email.body.includes(expectedData.question), 'Must contain consultation question');

  if (expectedData.involved_names) {
    assert.ok(email.body.includes(expectedData.involved_names), 'Must contain involved person names');
  }

  if (expectedData.core_focus) {
    assert.ok(email.body.includes(expectedData.core_focus), 'Must contain 5-cards core focus');
  }

  if (expectedData.tier_id === 'llamada' && expectedData.slot_date) {
    assert.ok(email.body.includes(expectedData.slot_date), 'Must contain call date');
  }
}

/**
 * Asserts Customer confirmation email payload
 */
export function assertCustomerEmailPayload(email, expectedData) {
  assert.ok(email, 'Customer email must be present');
  assert.equal(email.to, expectedData.customer_email, 'Email must be sent to customer address');
  if (expectedData.tier_id === 'llamada') {
    assert.ok(email.body.includes(expectedData.slot_date) || email.body.includes('llamada') || email.body.includes('agendada'), 'Must contain call details');
  } else {
    assert.ok(email.body.toLowerCase().includes('24 horas'), 'Must contain 24-hour turnaround notice');
  }
}
