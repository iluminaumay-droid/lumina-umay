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

  // Health check endpoint
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
    });
  });

  return app;
}

export const app = createApp();

