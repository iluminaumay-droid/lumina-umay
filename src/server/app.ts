import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { ZodError } from 'zod';
import { config } from './config.js';
import { AppError } from './errors/app-error.js';
import { SlotError } from './types/slot.types.js';
import { slotsRouter } from './routes/slots.routes.js';
import { checkoutRouter, ordersRouter } from './routes/checkout.routes.js';
import { webhookRouter } from './routes/webhook.routes.js';
import { testRouter } from './routes/test.routes.js';
import { GoogleCalendarService } from './services/google-calendar.service.js';
import { db } from './db/database.js';

export function createApp(): Express {
  const app = express();

  // CORS middleware
  app.use(
    cors({
      origin: config.corsOrigin,
      credentials: true,
    })
  );

  // JSON Body parser with rawBody retention for webhook HMAC signature verification
  app.use(
    express.json({
      limit: '2mb',
      verify: (req: Request & { rawBody?: Buffer }, _res: Response, buf: Buffer) => {
        req.rawBody = buf;
      },
    })
  );

  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // Robust multi-environment static client path resolution
  const candidateClientPaths = [
    path.join(process.cwd(), 'src', 'client'),
    path.join(process.cwd(), 'dist', 'src', 'client'),
    path.join(process.cwd(), 'dist', 'client'),
  ];
  const clientPath = candidateClientPaths.find((p) => fs.existsSync(p)) || path.join(process.cwd(), 'src', 'client');
  app.use(express.static(clientPath));

  // Health check endpoints
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime() });
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.status(200).json({
      success: true,
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'Lumina Umay API',
    });
  });

  // Slot Routes
  app.use('/api/slots', slotsRouter);

  // Checkout & Order Routes
  app.use('/api/checkout', checkoutRouter);
  app.use('/api/orders', ordersRouter);

  // Mercado Pago Webhook Routes
  app.use('/api/webhooks', webhookRouter);

  // Live iCal Calendar Feed for Claudia
  app.get('/api/calendar/feed.ics', (_req: Request, res: Response) => {
    try {
      const bookedOrders = db.prepare(`
        SELECT o.*, s.start_time as slot_start, s.end_time as slot_end
        FROM orders o
        JOIN slots s ON o.slot_id = s.id
        WHERE o.status IN ('paid', 'approved', 'PAID', 'APPROVED')
        ORDER BY s.start_time ASC
      `).all() as any[];

      const icsEvents = bookedOrders.map((bo) =>
        GoogleCalendarService.generateIcsContent({
          summary: `🔮 Sesión de Tarot: ${bo.customer_name}`,
          description: `Cliente: ${bo.customer_name}\nPregunta: ${bo.question}\nTel: ${bo.customer_phone || 'N/A'}\nOrden: ${bo.id}`,
          startTime: bo.slot_start,
          endTime: bo.slot_end,
          attendeeEmail: bo.customer_email,
        })
      ).join('\n');

      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', 'inline; filename="lumina-claudia.ics"');
      return res.status(200).send(icsEvents || 'BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Lumina Umay//Tarot//ES\nEND:VCALENDAR');
    } catch (err: any) {
      return res.status(500).send('Error generating calendar feed');
    }
  });

  // Test Support Routes
  app.use('/api/test', testRouter);

  // 404 handler for API routes
  app.all('/api/*', (_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: 'Endpoint no encontrado',
    });
  });

  // SPA fallback for frontend routes
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    const indexPath = path.join(clientPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      return res.sendFile(indexPath);
    }
    next();
  });

  // Fallback for client-side navigation / index.html serving
  app.get('*', (_req: Request, res: Response) => {
    const indexPath = path.join(clientPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send('Frontend client not found');
    }
  });

  // Global Error Handler
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      const firstError = err.errors[0];
      return res.status(400).json({
        success: false,
        error: firstError?.message || 'Error de validación en los datos enviados',
        details: err.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      });
    }

    if (err instanceof SlotError) {
      return res.status(err.statusCode).json({
        success: false,
        code: err.code,
        error: err.message,
      });
    }

    if (err instanceof AppError) {
      return res.status(err.statusCode).json({
        success: false,
        code: err.code,
        error: err.message,
      });
    }

    console.error('[Unhandled Server Error]:', err);
    return res.status(500).json({
      success: false,
      error: 'Error interno del servidor. Por favor intenta más tarde.',
      debug: err instanceof Error ? err.message : String(err),
    });
  });

  return app;
}

export const app = createApp();

