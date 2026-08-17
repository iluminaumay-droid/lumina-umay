import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import { v4 as uuidv4 } from 'uuid';
import { Order, TIER_CONFIG } from '../types/checkout.types.js';
import { config, AppConfig } from '../config.js';
import { SlotService } from './slot.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface EmailPayload {
  to: string;
  from?: string;
  subject: string;
  text: string;
  html: string;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  provider: 'mock' | 'console' | 'smtp' | 'resend';
  error?: string;
  fallbackUsed?: boolean;
}

export interface CapturedEmail {
  to: string;
  from: string;
  subject: string;
  body: string; // Plaintext representation for backwards compatibility & test assertions
  html?: string;
  date: string;
  provider?: string;
}

export interface IEmailProvider {
  readonly name: 'mock' | 'console' | 'smtp' | 'resend';
  sendEmail(payload: EmailPayload): Promise<SendEmailResult>;
}

/**
 * Escapes HTML characters to prevent XSS injection in email templates.
 */
export function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * In-memory Mock Email Provider
 */
export class MockEmailProvider implements IEmailProvider {
  readonly name = 'mock' as const;

  async sendEmail(payload: EmailPayload): Promise<SendEmailResult> {
    return MockEmailProvider.record(payload, 'mock');
  }

  static record(payload: EmailPayload, providerName: string = 'mock'): SendEmailResult {
    const messageId = `${providerName}-${uuidv4()}`;
    const emailRecord: CapturedEmail = {
      to: payload.to,
      from: payload.from || config.emailFrom,
      subject: payload.subject,
      body: payload.text,
      html: payload.html,
      date: SlotService.getCurrentIso(),
      provider: providerName,
    };
    EmailService.addCapturedEmail(emailRecord);
    return {
      success: true,
      messageId,
      provider: 'mock',
    };
  }
}

/**
 * Console Email Provider for local development/debugging
 */
export class ConsoleEmailProvider implements IEmailProvider {
  readonly name = 'console' as const;

  async sendEmail(payload: EmailPayload): Promise<SendEmailResult> {
    console.log('\n' + '='.repeat(60));
    console.log(`[EMAIL DISPATCHED via Console]`);
    console.log(`To:      ${payload.to}`);
    console.log(`From:    ${payload.from || config.emailFrom}`);
    console.log(`Subject: ${payload.subject}`);
    console.log(`Date:    ${SlotService.getCurrentIso()}`);
    console.log('-'.repeat(60));
    console.log(payload.text);
    console.log('='.repeat(60) + '\n');

    const messageId = `console-${Date.now()}`;
    const emailRecord: CapturedEmail = {
      to: payload.to,
      from: payload.from || config.emailFrom,
      subject: payload.subject,
      body: payload.text,
      html: payload.html,
      date: SlotService.getCurrentIso(),
      provider: 'console',
    };
    EmailService.addCapturedEmail(emailRecord);

    return {
      success: true,
      messageId,
      provider: 'console',
    };
  }
}

/**
 * SMTP Email Provider using Nodemailer with graceful fallback
 */
export class SmtpEmailProvider implements IEmailProvider {
  readonly name = 'smtp' as const;
  private transporter: nodemailer.Transporter | null = null;

  constructor(private appConfig: AppConfig = config) {
    if (this.appConfig.smtpHost && this.appConfig.smtpUser && this.appConfig.smtpPass) {
      this.transporter = nodemailer.createTransport({
        host: this.appConfig.smtpHost,
        port: this.appConfig.smtpPort,
        secure: this.appConfig.smtpSecure,
        auth: {
          user: this.appConfig.smtpUser,
          pass: this.appConfig.smtpPass,
        },
      });
    }
  }

  async sendEmail(payload: EmailPayload): Promise<SendEmailResult> {
    if (!this.transporter) {
      console.warn('[EmailService:Smtp] SMTP credentials not configured. Falling back to Mock capture.');
      MockEmailProvider.record(payload, 'smtp-fallback');
      return {
        success: true,
        messageId: `smtp-fallback-${Date.now()}`,
        provider: 'smtp',
        fallbackUsed: true,
      };
    }

    try {
      const info = await this.transporter.sendMail({
        from: payload.from || this.appConfig.emailFrom,
        to: payload.to,
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
      });

      const emailRecord: CapturedEmail = {
        to: payload.to,
        from: payload.from || this.appConfig.emailFrom,
        subject: payload.subject,
        body: payload.text,
        html: payload.html,
        date: SlotService.getCurrentIso(),
        provider: 'smtp',
      };
      EmailService.addCapturedEmail(emailRecord);

      return {
        success: true,
        messageId: info.messageId,
        provider: 'smtp',
      };
    } catch (err: any) {
      console.error('[EmailService:Smtp] Failed to send email via SMTP:', err.message);
      MockEmailProvider.record(payload, 'smtp-error-fallback');
      return {
        success: false,
        error: err.message,
        provider: 'smtp',
        fallbackUsed: true,
      };
    }
  }
}

/**
 * Resend Email Provider using Native Fetch REST API with graceful fallback
 */
export class ResendEmailProvider implements IEmailProvider {
  readonly name = 'resend' as const;

  constructor(private appConfig: AppConfig = config) {}

  async sendEmail(payload: EmailPayload): Promise<SendEmailResult> {
    if (!this.appConfig.resendApiKey) {
      console.warn('[EmailService:Resend] Resend API key not configured. Falling back to Mock capture.');
      MockEmailProvider.record(payload, 'resend-fallback');
      return {
        success: true,
        messageId: `resend-fallback-${Date.now()}`,
        provider: 'resend',
        fallbackUsed: true,
      };
    }

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.appConfig.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: payload.from || this.appConfig.emailFrom,
          to: [payload.to],
          subject: payload.subject,
          text: payload.text,
          html: payload.html,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error('[EmailService:Resend] Resend API error:', res.status, errorText);
        MockEmailProvider.record(payload, 'resend-api-error-fallback');
        return {
          success: false,
          error: errorText,
          provider: 'resend',
          fallbackUsed: true,
        };
      }

      const data = (await res.json()) as { id?: string };
      const emailRecord: CapturedEmail = {
        to: payload.to,
        from: payload.from || this.appConfig.emailFrom,
        subject: payload.subject,
        body: payload.text,
        html: payload.html,
        date: SlotService.getCurrentIso(),
        provider: 'resend',
      };
      EmailService.addCapturedEmail(emailRecord);

      return {
        success: true,
        messageId: data.id || `resend-${Date.now()}`,
        provider: 'resend',
      };
    } catch (err: any) {
      console.error('[EmailService:Resend] Network error communicating with Resend:', err.message);
      MockEmailProvider.record(payload, 'resend-network-error-fallback');
      return {
        success: false,
        error: err.message,
        provider: 'resend',
        fallbackUsed: true,
      };
    }
  }
}

/**
 * Main Email Service
 */
export class EmailService {
  private static capturedEmails: CapturedEmail[] = [];
  private static customProvider: IEmailProvider | null = null;
  private static templateCache: Map<string, string> = new Map();

  /**
   * Internal helper to append captured email
   */
  static addCapturedEmail(email: CapturedEmail): void {
    this.capturedEmails.push(email);
  }

  static getCapturedEmails(): CapturedEmail[] {
    return [...this.capturedEmails];
  }

  static clearCapturedEmails(): void {
    this.capturedEmails = [];
  }

  /**
   * Override provider for testing
   */
  static setProvider(provider: IEmailProvider | null): void {
    this.customProvider = provider;
  }

  static resetProvider(): void {
    this.customProvider = null;
  }

  /**
   * Resolves the active email provider
   */
  static getProvider(): IEmailProvider {
    if (this.customProvider) {
      return this.customProvider;
    }

    const providerName = (config.emailProvider || 'mock').toLowerCase();
    switch (providerName) {
      case 'smtp':
        return new SmtpEmailProvider(config);
      case 'resend':
        return new ResendEmailProvider(config);
      case 'console':
        return new ConsoleEmailProvider();
      case 'mock':
      default:
        return new MockEmailProvider();
    }
  }

  /**
   * Reads and renders HTML template with escaped variable substitution and conditions.
   */
  static renderTemplate(templateName: 'claudia-notification' | 'customer-confirmation', data: Record<string, any>): string {
    let rawTemplate = this.templateCache.get(templateName);

    if (!rawTemplate) {
      const searchPaths = [
        path.join(process.cwd(), 'src', 'server', 'templates', `${templateName}.html`),
        path.join(process.cwd(), 'dist', 'src', 'server', 'templates', `${templateName}.html`),
        path.join(__dirname, '..', 'templates', `${templateName}.html`),
      ];

      for (const p of searchPaths) {
        if (fs.existsSync(p)) {
          try {
            rawTemplate = fs.readFileSync(p, 'utf-8');
            this.templateCache.set(templateName, rawTemplate);
            break;
          } catch {
            // continue
          }
        }
      }
    }

    if (!rawTemplate) {
      // Robust embedded fallback if template files are missing
      rawTemplate = this.getEmbeddedFallbackTemplate(templateName);
    }

    return this.renderTemplateString(rawTemplate, data);
  }

  /**
   * Evaluates template string with stack-based conditional blocks and HTML-escaped substitutions.
   */
  static renderTemplateString(template: string, data: Record<string, any>): string {
    type Condition = { show: boolean; inElse: boolean; parentShow: boolean };
    const conditionStack: Condition[] = [];

    let result = '';
    let cursor = 0;

    const tagRegex = /\{\{(#if\s+[\w]+|#unless\s+[\w]+|else|\/if|\/unless|[\w]+)\}\}/g;
    let match: RegExpExecArray | null;

    while ((match = tagRegex.exec(template)) !== null) {
      const textBefore = template.substring(cursor, match.index);
      const tag = match[1].trim();
      cursor = tagRegex.lastIndex;

      const isCurrentActive = conditionStack.length === 0 || conditionStack[conditionStack.length - 1].show;

      if (isCurrentActive) {
        result += textBefore;
      }

      if (tag.startsWith('#if ')) {
        const varName = tag.substring(4).trim();
        const val = !!data[varName];
        const parentActive = isCurrentActive;
        conditionStack.push({
          show: parentActive && val,
          inElse: false,
          parentShow: parentActive,
        });
      } else if (tag.startsWith('#unless ')) {
        const varName = tag.substring(8).trim();
        const val = !data[varName];
        const parentActive = isCurrentActive;
        conditionStack.push({
          show: parentActive && val,
          inElse: false,
          parentShow: parentActive,
        });
      } else if (tag === 'else') {
        if (conditionStack.length > 0) {
          const top = conditionStack[conditionStack.length - 1];
          top.inElse = true;
          top.show = top.parentShow && !top.show;
        }
      } else if (tag === '/if' || tag === '/unless') {
        conditionStack.pop();
      } else {
        // Variable substitution {{varName}}
        if (isCurrentActive) {
          const val = data[tag];
          result += escapeHtml(val !== undefined ? val : '');
        }
      }
    }

    const isFinalActive = conditionStack.length === 0 || conditionStack[conditionStack.length - 1].show;
    if (isFinalActive) {
      result += template.substring(cursor);
    }

    return result;
  }

  private static getEmbeddedFallbackTemplate(templateName: string): string {
    if (templateName === 'claudia-notification') {
      return `<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; background-color: #fbf8f2; color: #1f2937; padding: 20px;">
  <div style="max-width: 600px; margin: auto; background: white; border: 1px solid #d4af37; padding: 20px; border-radius: 8px;">
    <h1 style="color: #0d2b2a; border-bottom: 2px solid #d4af37; padding-bottom: 10px;">LUMINA UMAY — Nueva Consulta Pagada</h1>
    <p><strong>Orden:</strong> {{order_id}}</p>
    <p><strong>Pago MP:</strong> {{mp_payment_id}}</p>
    <p><strong>Fecha:</strong> {{date}}</p>
    <h3>Datos del Consultante</h3>
    <p><strong>Nombre:</strong> {{customer_name}}</p>
    <p><strong>Correo:</strong> {{customer_email}}</p>
    {{#if has_phone}}<p><strong>Teléfono:</strong> {{customer_phone}}</p>{{/if}}
    <p><strong>Fecha de Nacimiento:</strong> {{customer_birthdate}}</p>
    <h3>Detalles del Servicio</h3>
    <p><strong>Servicio:</strong> {{tier_name}} (\${{amount_mxn}} MXN)</p>
    <p><strong>Categoría:</strong> {{category}}</p>
    <p><strong>Pregunta:</strong> {{question}}</p>
    {{#if has_involved_names}}<p><strong>Personas Involucradas:</strong> {{involved_names}}</p>{{/if}}
    {{#if has_core_focus}}<p><strong>Enfoque:</strong> {{core_focus}}</p>{{/if}}
    {{#if is_call}}
    <h3>Horario de Llamada Reservado</h3>
    <p><strong>Fecha:</strong> {{slot_date}}</p>
    <p><strong>Horario:</strong> {{slot_time_start}} - {{slot_time_end}} hrs (CDMX)</p>
    {{else}}
    <p style="background: #f0f7f6; padding: 10px; border-left: 4px solid #0d2b2a;"><strong>SLA:</strong> Entrega requerida en un plazo máximo de 24 horas.</p>
    {{/if}}
  </div>
</body>
</html>`;
    }

    return `<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; background-color: #fbf8f2; color: #1f2937; padding: 20px;">
  <div style="max-width: 600px; margin: auto; background: white; border: 1px solid #d4af37; padding: 20px; border-radius: 8px;">
    <h1 style="color: #0d2b2a; border-bottom: 2px solid #d4af37; padding-bottom: 10px;">LUMINA UMAY — Confirmación de Consulta</h1>
    <h2>¡Hola {{customer_name}}!</h2>
    <p>Hemos recibido tu pago con éxito.</p>
    {{#if is_call}}
    <p><strong>Tu sesión por llamada ha sido agendada:</strong> Fecha: {{slot_date}}, Horario: {{slot_time_start}} - {{slot_time_end}} hrs (Hora de la Ciudad de México).</p>
    {{else}}
    <p>Responderemos en un plazo máximo de <strong>24 horas</strong> a tu correo electrónico con tu lectura e interpretación detallada.</p>
    {{/if}}
    <h3>Resumen de tu Pedido</h3>
    <p><strong>Orden:</strong> {{order_id}}</p>
    <p><strong>Servicio:</strong> {{tier_name}}</p>
    <p><strong>Categoría:</strong> {{category}}</p>
    <p><strong>Total pagado:</strong> \${{amount_mxn}} MXN</p>
    <p><strong>Tu Pregunta:</strong> "{{question}}"</p>
    <p style="margin-top: 20px;">Con luz y gratitud,<br>Claudia — Lumina Umay</p>
  </div>
</body>
</html>`;
  }

  /**
   * Generates clean plaintext body for Claudia email
   */
  static generateClaudiaPlaintext(
    order: Order,
    slotDetails?: { date: string; time_start: string; time_end: string } | null
  ): string {
    const tierInfo = TIER_CONFIG[order.tier_id] || { name: order.tier_id, price: order.amount_mxn };

    let body = `¡Hola Claudia!\n\nSe ha confirmado un nuevo pago para una sesión en Lumina Umay.\n\n`;
    body += `--- DETALLES DEL CONSULTANTE ---\n`;
    body += `Nombre: ${order.customer_name}\n`;
    body += `Correo Electrónico: ${order.customer_email}\n`;
    if (order.customer_phone) {
      body += `Teléfono: ${order.customer_phone}\n`;
    }
    body += `Fecha de Nacimiento: ${order.customer_birthdate}\n\n`;

    body += `--- DETALLES DEL SERVICIO ---\n`;
    body += `Servicio: ${tierInfo.name} ($${order.amount_mxn} MXN)\n`;
    body += `Categoría: ${order.category}\n`;
    body += `Pregunta / Situación: ${order.question}\n`;

    if (order.involved_names) {
      body += `Personas Involucradas: ${order.involved_names}\n`;
    }

    if (order.core_focus) {
      body += `Qué es lo que más deseas saber (Enfoque): ${order.core_focus}\n`;
    }

    if (slotDetails) {
      body += `\n--- HORARIO DE LLAMADA RESERVADO ---\n`;
      body += `Fecha: ${slotDetails.date}\n`;
      body += `Horario: ${slotDetails.time_start} - ${slotDetails.time_end} hrs (CDMX)\n`;
    }

    body += `\nIdentificador de Orden: ${order.id}\n`;
    body += `ID de Pago Mercado Pago: ${order.mp_payment_id || 'N/A'}\n`;
    body += `Fecha de Confirmación: ${SlotService.getCurrentIso()}\n`;

    return body;
  }

  /**
   * Generates clean plaintext body for Customer email
   */
  static generateCustomerPlaintext(
    order: Order,
    slotDetails?: { date: string; time_start: string; time_end: string } | null
  ): string {
    const tierInfo = TIER_CONFIG[order.tier_id] || { name: order.tier_id, price: order.amount_mxn };

    let body = `¡Hola ${order.customer_name}!\n\n`;
    body += `Muchas gracias por confiar en Lumina Umay. Hemos recibido tu pago con éxito.\n\n`;

    if (order.tier_id === 'llamada' || order.tier_id === 'call_session') {
      body += `Tu sesión por llamada ha sido agendada y confirmada exitosamente:\n`;
      if (slotDetails) {
        body += `Fecha: ${slotDetails.date}\n`;
        body += `Horario: ${slotDetails.time_start} - ${slotDetails.time_end} hrs (Hora Ciudad de México).\n\n`;
      } else {
        body += `Tu horario de llamada ha quedado reservado.\n\n`;
      }
      body += `Claudia se conectará contigo puntualmente a través del enlace que recibirás antes de la sesión.\n`;
    } else {
      body += `Tu orden para ${tierInfo.name} ha sido confirmada.\n`;
      body += `Responderemos en un plazo máximo de 24 horas a tu correo electrónico con tu lectura e interpretación detallada.\n\n`;
    }

    body += `--- Resumen de tu pedido ---\n`;
    body += `Orden: ${order.id}\n`;
    body += `Servicio: ${tierInfo.name}\n`;
    body += `Categoría: ${order.category}\n`;
    body += `Total pagado: $${order.amount_mxn} MXN\n`;
    body += `Pregunta: ${order.question}\n\n`;
    body += `Con luz y gratitud,\nLumina Umay`;

    return body;
  }

  /**
   * Dispatches email payload using configured transport provider.
   */
  static async sendEmail(payload: EmailPayload): Promise<SendEmailResult> {
    const provider = this.getProvider();
    const result = await provider.sendEmail(payload);
    return result;
  }

  /**
   * Dispatches consultation notification email to Claudia.
   */
  static async sendOrderNotificationToClaudia(
    order: Order,
    slotDetails?: { date: string; time_start: string; time_end: string } | null
  ): Promise<boolean> {
    const tierInfo = TIER_CONFIG[order.tier_id] || { name: order.tier_id, price: order.amount_mxn };
    const subject = `[Lumina Umay] Nueva Consulta Pagada: ${order.customer_name} (${tierInfo.name})`;
    const isCall = order.tier_id === 'llamada' || order.tier_id === 'call_session';

    const templateData: Record<string, any> = {
      order_id: order.id,
      mp_payment_id: order.mp_payment_id || 'N/A',
      amount_mxn: order.amount_mxn,
      date: SlotService.getCurrentIso(),
      customer_name: order.customer_name,
      customer_email: order.customer_email,
      customer_phone: order.customer_phone || '',
      has_phone: !!order.customer_phone,
      customer_birthdate: order.customer_birthdate,
      tier_name: tierInfo.name,
      category: order.category,
      question: order.question,
      involved_names: order.involved_names || '',
      has_involved_names: !!order.involved_names,
      core_focus: order.core_focus || '',
      has_core_focus: !!order.core_focus,
      is_call: isCall,
      slot_date: slotDetails?.date || '',
      slot_time_start: slotDetails?.time_start || '',
      slot_time_end: slotDetails?.time_end || '',
    };

    const html = this.renderTemplate('claudia-notification', templateData);
    const text = this.generateClaudiaPlaintext(order, slotDetails);

    await this.sendEmail({
      to: config.claudiaNotificationEmail,
      from: config.emailFrom,
      subject,
      text,
      html,
    });

    return true;
  }

  /**
   * Dispatches receipt / confirmation email to the customer.
   */
  static async sendConfirmationToCustomer(
    order: Order,
    slotDetails?: { date: string; time_start: string; time_end: string } | null
  ): Promise<boolean> {
    const tierInfo = TIER_CONFIG[order.tier_id] || { name: order.tier_id, price: order.amount_mxn };
    const subject = `Confirmación de tu lectura — Lumina Umay`;
    const isCall = order.tier_id === 'llamada' || order.tier_id === 'call_session';

    const templateData: Record<string, any> = {
      order_id: order.id,
      amount_mxn: order.amount_mxn,
      date: SlotService.getCurrentIso(),
      customer_name: order.customer_name,
      customer_email: order.customer_email,
      tier_name: tierInfo.name,
      category: order.category,
      question: order.question,
      is_call: isCall,
      slot_date: slotDetails?.date || '',
      slot_time_start: slotDetails?.time_start || '',
      slot_time_end: slotDetails?.time_end || '',
    };

    const html = this.renderTemplate('customer-confirmation', templateData);
    const text = this.generateCustomerPlaintext(order, slotDetails);

    await this.sendEmail({
      to: order.customer_email,
      from: config.emailFrom,
      subject,
      text,
      html,
    });

    return true;
  }
}
