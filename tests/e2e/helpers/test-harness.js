/**
 * Test Harness for Lumina Umay E2E Tests (ESM)
 */

import { MockServer } from './mock-server.js';
import { TestClient } from './test-client.js';

export class TestHarness {
  constructor() {
    this.server = null;
    this.client = null;
    this.baseUrl = null;
  }

  async setup() {
    if (process.env.TEST_BASE_URL) {
      this.baseUrl = process.env.TEST_BASE_URL;
    } else {
      this.server = new MockServer();
      await this.server.start();
      this.baseUrl = this.server.getBaseUrl();
    }
    this.client = new TestClient(this.baseUrl);
    return this.client;
  }

  async teardown() {
    if (this.server) {
      await this.server.stop();
      this.server = null;
    }
  }

  getClient() {
    return this.client;
  }
}
