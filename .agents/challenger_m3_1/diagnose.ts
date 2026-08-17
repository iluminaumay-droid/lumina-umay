import { EmailService } from '../../src/server/services/email.service.js';
import { Order } from '../../src/server/types/checkout.types.js';

async function diagnose() {
  EmailService.clearCapturedEmails();
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
  for (let i = 0; i < captured.length; i++) {
    const email = captured[i];
    const html = email.html || '';
    console.log(`\n--- EMAIL #${i} (${email.subject}) ---`);
    console.log('Includes <script>:', html.includes('<script>'));
    console.log('Includes <img src=x:', html.includes('<img src=x'));
    console.log('Includes <svg onload:', html.includes('<svg onload'));
    console.log('Includes <iframe:', html.includes('<iframe'));
    console.log('Includes onmouseover=:', html.includes('onmouseover='));

    // Check which one matched
    const patterns = ['<script>', '<img src=x', '<svg onload', '<iframe', 'onmouseover='];
    for (const pat of patterns) {
      if (html.includes(pat)) {
        const idx = html.indexOf(pat);
        console.log(`FOUND PATTERN "${pat}" at index ${idx}:`);
        console.log(html.substring(Math.max(0, idx - 50), Math.min(html.length, idx + 100)));
      }
    }
  }
}

diagnose().catch(console.error);
