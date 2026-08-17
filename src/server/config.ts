import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export type EmailProviderType = 'smtp' | 'resend' | 'mock' | 'console';

export interface AppConfig {
  port: number;
  nodeEnv: string;
  corsOrigin: string;
  dbPath: string;
  slotLockTtlMinutes: number;
  mpAccessToken: string;
  mpWebhookSecret: string;
  emailProvider: EmailProviderType;
  emailFrom: string;
  claudiaNotificationEmail: string;
  resendApiKey: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  dbPath: process.env.DB_PATH || process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'lumina_umay.sqlite'),
  slotLockTtlMinutes: parseInt(process.env.SLOT_LOCK_TTL_MINUTES || '15', 10),
  mpAccessToken: process.env.MP_ACCESS_TOKEN || '',
  mpWebhookSecret: process.env.MP_WEBHOOK_SECRET || '',
  emailProvider: (process.env.EMAIL_PROVIDER as EmailProviderType) || 'mock',
  emailFrom: process.env.EMAIL_FROM || 'Lumina Umay <contacto@luminaumay.com>',
  claudiaNotificationEmail: process.env.CLAUDIA_NOTIFICATION_EMAIL || 'claudia@luminaumay.com',
  resendApiKey: process.env.RESEND_API_KEY || '',
  smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
  smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
  smtpSecure: process.env.SMTP_SECURE === 'true' || parseInt(process.env.SMTP_PORT || '587', 10) === 465,
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
};

