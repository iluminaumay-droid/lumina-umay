/**
 * REST Test Client for Lumina Umay E2E Tests (ESM)
 */

export class TestClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async getSlots() {
    const res = await fetch(`${this.baseUrl}/api/slots`);
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
  }

  async lockSlot(slotId) {
    const res = await fetch(`${this.baseUrl}/api/slots/${slotId}/lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
  }

  async releaseSlot(slotId, lockToken) {
    const res = await fetch(`${this.baseUrl}/api/slots/${slotId}/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lock_token: lockToken })
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
  }

  async createPreference(payload) {
    const res = await fetch(`${this.baseUrl}/api/checkout/create-preference`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
  }

  async getOrderStatus(orderId) {
    const res = await fetch(`${this.baseUrl}/api/orders/${orderId}/status`);
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
  }

  async sendWebhook(payload, customHeaders = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...customHeaders
    };
    const res = await fetch(`${this.baseUrl}/api/webhooks/mercadopago`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
  }

  async resetState() {
    const res = await fetch(`${this.baseUrl}/api/test/reset`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
  }

  async advanceTime(seconds) {
    const res = await fetch(`${this.baseUrl}/api/test/advance-time`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seconds })
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
  }

  async getCapturedEmails() {
    const res = await fetch(`${this.baseUrl}/api/test/emails`);
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, emails: data.emails || [] };
  }
}
