import nodemailer from 'nodemailer';
import {
  EmailService,
  MockEmailProvider,
  ConsoleEmailProvider,
  SmtpEmailProvider,
  ResendEmailProvider,
  escapeHtml,
} from '../../src/server/services/email.service.js';
import { config, AppConfig } from '../../src/server/config.js';
import { Order } from '../../src/server/types/checkout.types.js';

interface TestResult {
  category: string;
  name: string;
  status: 'PASS' | 'FAIL';
  durationMs: number;
  details: string;
}

const results: TestResult[] = [];

async function runTest(category: string, name: string, fn: () => Promise<void> | void) {
  const start = performance.now();
  try {
    EmailService.clearCapturedEmails();
    EmailService.resetProvider();
    await fn();
    const durationMs = parseFloat((performance.now() - start).toFixed(2));
    results.push({ category, name, status: 'PASS', durationMs, details: 'Verified successfully.' });
    console.log(`[PASS] [${category}] ${name} (${durationMs}ms)`);
  } catch (err: any) {
    const durationMs = parseFloat((performance.now() - start).toFixed(2));
    results.push({ category, name, status: 'FAIL', durationMs, details: err.message || String(err) });
    console.error(`[FAIL] [${category}] ${name} (${durationMs}ms):`, err.message);
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log('STARTING EMPIRICAL ADVERSARIAL STRESS TEST HARNESS — MILESTONE 3 (EMAIL DISPATCHER)');
  console.log('='.repeat(80));

  // =========================================================================
  // 1. ALL 4 EMAIL PROVIDERS & FALLBACK RESILIENCE
  // =========================================================================
  await runTest('Provider', '1.1 Mock Provider: in-memory sink capture and isolation', async () => {
    const provider = new MockEmailProvider();
    const res = await provider.sendEmail({
      to: 'test@luminaumay.com',
      subject: 'Mock Test',
      text: 'Body text',
      html: '<p>HTML</p>',
    });
    if (!res.success || res.provider !== 'mock') throw new Error(`Mock failed: ${JSON.stringify(res)}`);
    const captured = EmailService.getCapturedEmails();
    if (captured.length !== 1 || captured[0].to !== 'test@luminaumay.com') throw new Error('Email not captured in sink');
  });

  await runTest('Provider', '1.2 Console Provider: stdout log and capture sink', async () => {
    const provider = new ConsoleEmailProvider();
    const res = await provider.sendEmail({
      to: 'claudia@luminaumay.com',
      subject: 'Console Test',
      text: 'Body text for console',
      html: '<p>Console HTML</p>',
    });
    if (!res.success || res.provider !== 'console') throw new Error(`Console failed: ${JSON.stringify(res)}`);
    const captured = EmailService.getCapturedEmails();
    if (captured.length !== 1 || captured[0].provider !== 'console') throw new Error('Email not captured in console sink');
  });

  await runTest('Provider', '1.3 SMTP Provider: graceful fallback when unconfigured', async () => {
    const unconfiguredConfig: AppConfig = { ...config, smtpHost: '', smtpUser: '', smtpPass: '' };
    const provider = new SmtpEmailProvider(unconfiguredConfig);
    const res = await provider.sendEmail({
      to: 'client@example.com',
      subject: 'SMTP Fallback Test',
      text: 'Text',
      html: '<p>HTML</p>',
    });
    if (!res.success || !res.fallbackUsed || res.provider !== 'smtp') throw new Error(`SMTP fallback failed: ${JSON.stringify(res)}`);
    const captured = EmailService.getCapturedEmails();
    if (captured.length !== 1 || captured[0].provider !== 'smtp-fallback') throw new Error('Sink did not record smtp-fallback');
  });

  await runTest('Provider', '1.4 SMTP Provider: simulated network error / auth rejection fallback', async () => {
    const smtpConfig: AppConfig = { ...config, smtpHost: 'smtp.invalid-host-lumina.org', smtpUser: 'user', smtpPass: 'pass' };
    const provider = new SmtpEmailProvider(smtpConfig);
    // Force nodemailer transporter to reject
    (provider as any).transporter = {
      sendMail: async () => {
        throw new Error('EAI_AGAIN: DNS lookup failure for smtp.invalid-host-lumina.org');
      },
    };
    const res = await provider.sendEmail({
      to: 'client@example.com',
      subject: 'SMTP Error Test',
      text: 'Text',
      html: '<p>HTML</p>',
    });
    if (res.success || !res.fallbackUsed || !res.error?.includes('DNS lookup failure')) {
      throw new Error(`SMTP error fallback failed: ${JSON.stringify(res)}`);
    }
    const captured = EmailService.getCapturedEmails();
    if (captured.length !== 1 || captured[0].provider !== 'smtp-error-fallback') {
      throw new Error('Sink did not record smtp-error-fallback');
    }
  });

  await runTest('Provider', '1.5 Resend Provider: graceful fallback when API key is missing', async () => {
    const unconfiguredConfig: AppConfig = { ...config, resendApiKey: '' };
    const provider = new ResendEmailProvider(unconfiguredConfig);
    const res = await provider.sendEmail({
      to: 'client@example.com',
      subject: 'Resend Fallback Test',
      text: 'Text',
      html: '<p>HTML</p>',
    });
    if (!res.success || !res.fallbackUsed || res.provider !== 'resend') throw new Error(`Resend fallback failed: ${JSON.stringify(res)}`);
    const captured = EmailService.getCapturedEmails();
    if (captured.length !== 1 || captured[0].provider !== 'resend-fallback') throw new Error('Sink did not record resend-fallback');
  });

  await runTest('Provider', '1.6 Resend Provider: simulated API HTTP 403 / 500 error handling', async () => {
    const resendConfig: AppConfig = { ...config, resendApiKey: 're_valid_looking_key' };
    const provider = new ResendEmailProvider(resendConfig);
    const originalFetch = global.fetch;
    try {
      global.fetch = (async () => ({
        ok: false,
        status: 403,
        text: async () => 'Domain unverified on Resend',
      })) as any;

      const res = await provider.sendEmail({
        to: 'client@example.com',
        subject: 'Resend 403 Test',
        text: 'Text',
        html: '<p>HTML</p>',
      });
      if (res.success || !res.fallbackUsed || !res.error?.includes('Domain unverified')) {
        throw new Error(`Resend API error handling failed: ${JSON.stringify(res)}`);
      }
      const captured = EmailService.getCapturedEmails();
      if (captured.length !== 1 || captured[0].provider !== 'resend-api-error-fallback') {
        throw new Error('Sink did not record resend-api-error-fallback');
      }
    } finally {
      global.fetch = originalFetch;
    }
  });

  await runTest('Provider', '1.7 Resend Provider: simulated network rejection handling', async () => {
    const resendConfig: AppConfig = { ...config, resendApiKey: 're_valid_key' };
    const provider = new ResendEmailProvider(resendConfig);
    const originalFetch = global.fetch;
    try {
      global.fetch = (async () => {
        throw new TypeError('fetch failed: Connection refused');
      }) as any;

      const res = await provider.sendEmail({
        to: 'client@example.com',
        subject: 'Resend Net Error Test',
        text: 'Text',
        html: '<p>HTML</p>',
      });
      if (res.success || !res.fallbackUsed || !res.error?.includes('Connection refused')) {
        throw new Error(`Resend network error handling failed: ${JSON.stringify(res)}`);
      }
      const captured = EmailService.getCapturedEmails();
      if (captured.length !== 1 || captured[0].provider !== 'resend-network-error-fallback') {
        throw new Error('Sink did not record resend-network-error-fallback');
      }
    } finally {
      global.fetch = originalFetch;
    }
  });

  // =========================================================================
  // 2. TEMPLATE ENGINE & RENDERING ROBUSTNESS
  // =========================================================================
  await runTest('Templates', '2.1 Nested conditions and missing variable robustness', () => {
    const template = `{{#if a}}A_TRUE{{#if b}}_B_TRUE{{else}}_B_FALSE{{/if}}{{else}}A_FALSE{{/if}} [{{missing}}]`;
    const res1 = EmailService.renderTemplateString(template, { a: true, b: true });
    const res2 = EmailService.renderTemplateString(template, { a: true, b: false });
    const res3 = EmailService.renderTemplateString(template, { a: false });

    if (res1 !== 'A_TRUE_B_TRUE []') throw new Error(`Nested res1 failed: ${res1}`);
    if (res2 !== 'A_TRUE_B_FALSE []') throw new Error(`Nested res2 failed: ${res2}`);
    if (res3 !== 'A_FALSE []') throw new Error(`Nested res3 failed: ${res3}`);
  });

  await runTest('Templates', '2.2 Stress test with 100,000 characters payload', () => {
    const hugePayload = 'Tarot Sagrado Lumina Umay '.repeat(4000);
    const template = `<p>Detalle: {{huge}}</p>`;
    const rendered = EmailService.renderTemplateString(template, { huge: hugePayload });
    if (!rendered.includes(hugePayload) || rendered.length < 100000) {
      throw new Error(`Huge payload rendering failed, length: ${rendered.length}`);
    }
  });

  // =========================================================================
  // 3. XSS INJECTION & HTML ESCAPING VERIFICATION
  // =========================================================================
  await runTest('Security', '3.1 Rigorous HTML Escaping of all special entities', () => {
    const raw = `"><script>alert('XSS')</script>&"test"`;
    const escaped = escapeHtml(raw);
    const expected = '&quot;&gt;&lt;script&gt;alert(&#039;XSS&#039;)&lt;/script&gt;&amp;&quot;test&quot;';
    if (escaped !== expected) {
      throw new Error(`escapeHtml mismatch:\nGot:      ${escaped}\nExpected: ${expected}`);
    }
  });

  await runTest('Security', '3.2 XSS polyglots in Claudia and Customer emails', async () => {
    const maliciousOrder: Order = {
      id: 'ord_xss_<script>alert(1)</script>',
      tier_id: '5_cartas',
      category: 'Amor',
      amount_mxn: 500,
      customer_name: '<img src=x onerror=alert("name")>',
      customer_email: 'attacker@example.com',
      customer_birthdate: '1990-01-01',
      question: '<svg onload=alert("q")>',
      involved_names: '<iframe src="javascript:alert(1)"></iframe>',
      core_focus: '<b onmouseover=alert("focus")>Pwn</b>',
      status: 'approved',
      email_sent: 0,
      customer_email_sent: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await EmailService.sendOrderNotificationToClaudia(maliciousOrder);
    await EmailService.sendConfirmationToCustomer(maliciousOrder);

    const captured = EmailService.getCapturedEmails();
    for (const email of captured) {
      const html = email.html || '';
      // Ensure all dangerous raw unescaped tags are NOT present
      const rawPayloads = [
        '<script>',
        '<img src=x',
        '<svg onload',
        '<iframe',
        '<b onmouseover',
      ];
      for (const raw of rawPayloads) {
        if (html.includes(raw)) {
          throw new Error(`Unescaped raw HTML tag detected in email HTML: "${raw}"`);
        }
      }

      // Ensure escaped versions ARE present
      const escapedPayloads = [
        '&lt;script&gt;alert(1)&lt;/script&gt;',
        '&lt;img src=x onerror=alert(&quot;name&quot;)&gt;',
        '&lt;svg onload=alert(&quot;q&quot;)&gt;',
        '&lt;iframe src=&quot;javascript:alert(1)&quot;&gt;&lt;/iframe&gt;',
        '&lt;b onmouseover=alert(&quot;focus&quot;)&gt;Pwn&lt;/b&gt;',
      ];
      for (const esc of escapedPayloads) {
        if (!html.includes(esc)) {
          // Note: some payloads are only in Claudia email (involved_names, core_focus), so check conditionally
          if (email.to === config.claudiaNotificationEmail && !html.includes(esc)) {
            throw new Error(`Expected escaped entity missing in Claudia HTML: "${esc}"`);
          }
        }
      }
    }
  });

  // =========================================================================
  // 4. MEXICAN SPANISH COPY FIDELITY & SLA INTEGRITY
  // =========================================================================
  await runTest('CopyFidelity', '4.1 Async card readings copy: 24 horas & Claudia sign-off', async () => {
    const asyncOrder: Order = {
      id: 'ord_async_001',
      tier_id: '1_carta',
      category: 'Trabajo/Dinero',
      amount_mxn: 150,
      customer_name: 'Guillermo Ochoa',
      customer_email: 'guillermo@example.com',
      customer_birthdate: '1985-07-13',
      question: '¿Tendré éxito en mi nuevo proyecto deportivo?',
      status: 'approved',
      email_sent: 0,
      customer_email_sent: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await EmailService.sendConfirmationToCustomer(asyncOrder);
    await EmailService.sendOrderNotificationToClaudia(asyncOrder);

    const captured = EmailService.getCapturedEmails();
    const custEmail = captured[0];
    const claudiaEmail = captured[1];

    if (!custEmail.html?.includes('24 horas')) throw new Error('Customer email missing "24 horas" SLA');
    if (!custEmail.html?.includes('Con luz, gratitud y bendiciones,\n          Claudia — Lumina Umay') && !custEmail.html?.includes('Claudia — Lumina Umay')) {
      throw new Error('Customer email missing exact Mexican Spanish Claudia sign-off');
    }
    if (!claudiaEmail.html?.includes('24 horas')) throw new Error('Claudia email missing "24 horas" SLA reminder');
  });

  await runTest('CopyFidelity', '4.2 Live call session copy: CDMX timezone & preparation advice', async () => {
    const callOrder: Order = {
      id: 'ord_call_002',
      tier_id: 'llamada',
      category: 'Familia',
      amount_mxn: 450,
      customer_name: 'Lucia Mendez',
      customer_email: 'lucia@example.com',
      customer_birthdate: '1990-09-09',
      question: 'Consulta familiar profunda en llamada',
      status: 'approved',
      email_sent: 0,
      customer_email_sent: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const slot = { date: '2026-08-28', time_start: '15:00', time_end: '15:45' };
    await EmailService.sendConfirmationToCustomer(callOrder, slot);
    await EmailService.sendOrderNotificationToClaudia(callOrder, slot);

    const captured = EmailService.getCapturedEmails();
    const custEmail = captured[0];
    const claudiaEmail = captured[1];

    if (!custEmail.html?.includes('2026-08-28') || !custEmail.html?.includes('15:00 - 15:45 hrs (Hora de la Ciudad de México)')) {
      throw new Error('Customer call email missing CDMX time details');
    }
    if (!custEmail.html?.includes('espacio tranquilo y libre de distracciones 5 minutos antes')) {
      throw new Error('Customer call email missing preparation advice');
    }
    if (custEmail.html?.includes('Garantía de Entrega (24 Horas)')) {
      throw new Error('Customer call email incorrectly included async 24h SLA banner');
    }
    if (!claudiaEmail.html?.includes('15:00 - 15:45 hrs (CDMX)')) {
      throw new Error('Claudia call email missing CDMX slot details');
    }
  });

  // =========================================================================
  // SUMMARY REPORT
  // =========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('ADVERSARIAL STRESS TEST SUMMARY REPORT:');
  console.log('='.repeat(80));
  const total = results.length;
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`TOTAL TESTS: ${total} | PASSED: ${passed} | FAILED: ${failed}`);
  results.forEach(r => {
    console.log(`[${r.status}] [${r.category.padEnd(12)}] ${r.name.padEnd(65)} (${r.durationMs}ms)`);
  });
  console.log('='.repeat(80));

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Unhandled harness error:', err);
  process.exit(1);
});
