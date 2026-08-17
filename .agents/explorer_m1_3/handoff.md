# Milestone 1 Exploration Report: Toolchain, Package Setup, Server Bootstrapping & Slot Routes

**Role:** Explorer 3 — Milestone 1 (Core Database & Concurrency Engine)  
**Target Folder:** `c:/LUMINAPROJECT/.agents/explorer_m1_3`  
**Date:** 2026-08-16  
**Status:** COMPLETED (Hard Handoff)  

---

## 1. Observation

### 1.1 Direct References & Source Requirements

From `c:/LUMINAPROJECT/ORIGINAL_REQUEST.md`:
- **R2 (Live Call Session Slot Booking & Concurrency)**: "Implement live call booking ($450 MXN) with real-time slot availability, soft-locking during checkout attempt, automated release on timeout/failure, and permanent booking confirmation upon payment to eliminate double-booking." (Lines 15–17)
- **Acceptance Criteria - Booking & Concurrency**:
  - "Only currently available slots are displayed to the user." (Line 36)
  - "Selecting a slot places a temporary hold/soft-lock during the checkout session." (Line 37)
  - "Two simultaneous attempts on the same slot result in only one lock, preventing race conditions." (Line 38)
  - "Slot unlocks automatically if payment is abandoned or fails within expiration window." (Line 39)

From `c:/LUMINAPROJECT/PROJECT.md`:
- **Architecture**: "Backend: Node.js + Express + TypeScript with SQLite (`better-sqlite3` in WAL mode) for atomic transaction support, slot soft-locking with TTL, Mercado Pago SDK/REST integration, HMAC SHA-256 webhook validation, and pluggable email notification engine (Nodemailer/Resend/Mock Logger)." (Lines 4–6)
- **Interface Contracts - Slots API**:
  - `GET /api/slots`: "Returns available slots `{ success: true, slots: [{ id, start_time, end_time, status }] }`." (Line 46)
  - `POST /api/slots/:id/lock`: "Acquires a 15-minute soft lock. Returns `{ success: true, lock_token, expires_at }` or `409 Conflict`." (Line 47)
  - `POST /api/slots/:id/release`: "Releases a soft lock with `{ lock_token }`." (Line 48)
- **Code Layout Target**:
  - `src/server/index.ts` — Express application entry point (Line 66)
  - `src/server/config.ts` — Environment and pricing configuration (Line 67)
  - `src/server/routes/slots.routes.ts` — Slot query and lock routes (Line 73)
  - `src/server/services/slot.service.ts` — Atomic soft-locking & TTL sweeper (Line 77)
  - `package.json` & `tsconfig.json` (Lines 97–98)

From `c:/LUMINAPROJECT/lumina-umay-booking-system-spec-v2.md`:
- "Site language: **Mexican Spanish** throughout (all copy, labels, buttons, confirmation messages, FAQ, emails)." (Line 10)
- "Needs a lightweight backend/database... Store available call slots; only show open ones to the customer. Soft-lock a slot on payment attempt, confirm it permanently once Mercado Pago's webhook approves payment, release it if payment doesn't complete. Prevent two customers from booking the same slot." (Lines 58–63)

From Environment Diagnostics (`run_command` output):
- Node version: `v26.7.0`
- Npm version: `11.12.1`
- Operating System: Windows (`win32`)

---

## 2. Logic Chain

### 2.1 Package Setup & Dependency Strategy (`package.json`)
1. **Module Format & Runtime**:
   - Node `v26.7.0` has first-class native ESM support (`"type": "module"`).
   - Pairing `"type": "module"` with `tsx` allows instant TypeScript execution and hot-reloading (`tsx watch`) without a manual build step during development.
2. **Production Dependencies**:
   - `express` (`^4.21.2`): Battle-tested, minimal HTTP routing and middleware framework.
   - `better-sqlite3` (`^11.8.1`): Synchronous, C-level SQLite driver in WAL mode guaranteeing atomic single-thread write executions.
   - `zod` (`^3.24.2`): Type-safe schema validation for HTTP params, query, and body payloads.
   - `uuid` (`^11.0.5`): UUIDv4 generation for slots, orders, and lock tokens.
   - `cors` (`^2.8.5`): Cross-Origin Resource Sharing middleware for frontend/backend decoupled dev environments.
   - `dotenv` (`^16.4.7`): Environment variable loader.
   - `mercadopago` (`^2.0.15`): Official Mercado Pago Node SDK (staged for M2).
   - `nodemailer` (`^6.10.0`): SMTP / email notification transport (staged for M3).
3. **Development & Testing Toolchain**:
   - `typescript` (`^5.7.3`): Static typing and compilation.
   - `tsx` (`^4.19.3`): TypeScript execution engine for dev server and database seed scripts.
   - `vitest` (`^3.0.5`): Ultra-fast, ESM-native test runner compatible with TypeScript.
   - `supertest` (`^7.0.0`): HTTP endpoint assertion library for testing Express routes in-process without listening on physical network ports.
   - `@types/*`: Full TypeScript definitions (`@types/express`, `@types/better-sqlite3`, `@types/cors`, `@types/node`, `@types/nodemailer`, `@types/supertest`, `@types/uuid`).

### 2.2 TypeScript Configuration (`tsconfig.json`)
1. **Compiler Strictness**:
   - `"strict": true`: Enforces `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, and `strictBindCallApply` to prevent runtime crashes.
2. **Module System**:
   - `"target": "ES2022"`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`: Ensures modern Node ESM syntax compliance.
   - `"esModuleInterop": true`, `"allowSyntheticDefaultImports": true`: Enables clean default imports from CommonJS modules (e.g. `import Database from 'better-sqlite3'`).
3. **Build & Path Separation**:
   - `"outDir": "./dist"` and `"rootDir": "./src"` isolates compiled output from sources.

### 2.3 Express Server Bootstrapping Architecture
1. **App / Server Decoupling (`app.ts` vs `index.ts`)**:
   - *Observation*: Supertest spins up ephemeral HTTP handlers against Express instances. If `listen()` is embedded directly inside the app definition, integration tests bind to physical ports, causing EADDRINUSE conflicts during parallel test execution.
   - *Design*:
     - `src/server/app.ts`: Creates the Express application, configures middleware, registers routes, static files, and error handlers, and exports `app`.
     - `src/server/index.ts`: Imports `app`, loads configuration, initializes the SQLite database tables (`initDatabase()`), auto-seeds slots if empty, and invokes `app.listen(PORT)`.
2. **Middleware Pipeline Sequence**:
   1. `cors({ origin: config.corsOrigin, credentials: true })`
   2. `express.json({ limit: '1mb', verify: (req, _res, buf) => { (req as any).rawBody = buf; } })` — Preserves `rawBody` for Mercado Pago webhook HMAC-SHA256 signature verification in M2.
   3. `express.urlencoded({ extended: true, limit: '1mb' })`
   4. Static file serving: `express.static(path.join(process.cwd(), 'src', 'client'))`
   5. Slot routes: `app.use('/api/slots', slotRoutes)`
   6. 404 Handler for unmatched `/api/*` routes returning standard Mexican Spanish JSON `{ success: false, error: "Endpoint no encontrado" }`.
   7. Global Error Handler catching `ZodError`, custom `AppError`, and unhandled exceptions, returning structured JSON with accurate HTTP status codes (400, 404, 409, 500).

### 2.4 Slot Route Endpoints Contract Specification
1. **`GET /api/slots`**:
   - *Action*: Triggers `slotService.releaseExpiredLocks()` lazily to sweep expired holds, then fetches all `available` slots (ordered by `start_time ASC`).
   - *Optional Filter*: Query param `?date=YYYY-MM-DD` filters slots for a specific date (in CDMX time).
   - *HTTP Response 200*:
     ```json
     {
       "success": true,
       "slots": [
         {
           "id": "7b882c1f-959c-4b51-b0de-7f6ef635f791",
           "start_time": "2026-08-17T16:00:00.000Z",
           "end_time": "2026-08-17T16:45:00.000Z",
           "status": "available"
         }
       ]
     }
     ```
2. **`POST /api/slots/:id/lock`**:
   - *Action*: Calls `slotService.acquireSoftLock(slotId)`.
   - *Atomic Outcome 1 (Success)* -> HTTP 200:
     ```json
     {
       "success": true,
       "message": "Horario apartado temporalmente por 15 minutos",
       "slot_id": "7b882c1f-959c-4b51-b0de-7f6ef635f791",
       "lock_token": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
       "expires_at": "2026-08-17T16:15:00.000Z"
     }
     ```
   - *Atomic Outcome 2 (Conflict)* -> Slot already locked by active hold or already booked -> HTTP 409 Conflict:
     ```json
     {
       "success": false,
       "error": "El horario seleccionado ya fue apartado por otra persona. Por favor elige otro horario."
     }
     ```
   - *Atomic Outcome 3 (Not Found)* -> Slot does not exist -> HTTP 404:
     ```json
     {
       "success": false,
       "error": "Horario no encontrado"
     }
     ```
3. **`POST /api/slots/:id/release`**:
   - *Body*: `{ "lock_token": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d" }`
   - *Action*: Validates `lock_token` presence via Zod, then calls `slotService.releaseSoftLock(slotId, lockToken)`.
   - *Outcome 1 (Success)* -> HTTP 200:
     ```json
     {
       "success": true,
       "message": "Horario liberado exitosamente"
     }
     ```
   - *Outcome 2 (Mismatch / Invalid)* -> HTTP 400 Bad Request:
     ```json
     {
       "success": false,
       "error": "No se pudo liberar el horario. El token de bloqueo no coincide o el horario no está apartado."
     }
     ```

---

## 3. Caveats & Assumptions

1. **Timezone Uniformity**:
   - All slot timestamps in HTTP request/responses and SQLite database records are stored in ISO-8601 UTC strings (`YYYY-MM-DDTHH:mm:ss.sssZ`).
   - The frontend and email services are responsible for formatting these UTC timestamps into Mexico City Central Time (`America/Mexico_City`, UTC-6).
2. **Raw Body Retention for Webhooks**:
   - `express.json` is configured with a `verify` hook to capture `req.rawBody` on all incoming requests. This ensures Milestone 2 webhook verification can compute HMAC signatures against unaltered binary payloads without needing custom body parsers later.
3. **Database Test Isolation**:
   - Supertest tests must be able to inject an in-memory SQLite database (`:memory:`) or isolated test database file via `process.env.DB_PATH` to guarantee idempotent, side-effect-free test execution.

---

## 4. Conclusion & Concrete Implementation Blueprints

### 4.1 `package.json` Specification

```json
{
  "name": "lumina-umay-booking",
  "version": "1.0.0",
  "description": "Lumina Umay Tarot Booking & Payment System",
  "private": true,
  "type": "module",
  "main": "dist/server/index.js",
  "scripts": {
    "dev": "tsx watch src/server/index.ts",
    "build": "tsc",
    "start": "node dist/server/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "db:seed": "tsx src/server/db/seed.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "better-sqlite3": "^11.8.1",
    "cors": "^2.8.5",
    "dotenv": "^16.4.7",
    "express": "^4.21.2",
    "mercadopago": "^2.0.15",
    "nodemailer": "^6.10.0",
    "uuid": "^11.0.5",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/cors": "^2.8.17",
    "@types/express": "^5.0.0",
    "@types/node": "^22.13.4",
    "@types/nodemailer": "^6.4.17",
    "@types/supertest": "^6.0.2",
    "@types/uuid": "^10.0.0",
    "supertest": "^7.0.0",
    "tsx": "^4.19.3",
    "typescript": "^5.7.3",
    "vitest": "^3.0.5"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

### 4.2 `tsconfig.json` Specification

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "sourceMap": true,
    "declaration": true,
    "isolatedModules": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests/**/*"]
}
```

### 4.3 `vitest.config.ts` Specification

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.ts'],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/server/**/*.ts'],
      exclude: ['src/server/index.ts', 'src/server/db/seed.ts']
    }
  }
});
```

### 4.4 `.env.example` Specification

```ini
# Server Configuration
PORT=3000
NODE_ENV=development
CORS_ORIGIN=*
DB_PATH=./data/lumina_umay.sqlite

# Slot Concurrency Settings
SLOT_LOCK_TTL_MINUTES=15

# Mercado Pago Integration (Milestone 2)
MP_ACCESS_TOKEN=TEST-0000000000000000-000000-00000000000000000000000000000000-000000000
MP_WEBHOOK_SECRET=00000000000000000000000000000000

# Email Notification Provider (Milestone 3)
EMAIL_PROVIDER=mock
CLAUDIA_NOTIFICATION_EMAIL=claudia@luminaumay.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=notificaciones@luminaumay.com
SMTP_PASS=app_password_placeholder
```

### 4.5 Server Configuration Module (`src/server/config.ts`)

```ts
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export interface AppConfig {
  port: number;
  nodeEnv: string;
  corsOrigin: string;
  dbPath: string;
  slotLockTtlMinutes: number;
  mpAccessToken: string;
  mpWebhookSecret: string;
  emailProvider: string;
  claudiaNotificationEmail: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  dbPath: process.env.DB_PATH || path.join(process.cwd(), 'data', 'lumina_umay.sqlite'),
  slotLockTtlMinutes: parseInt(process.env.SLOT_LOCK_TTL_MINUTES || '15', 10),
  mpAccessToken: process.env.MP_ACCESS_TOKEN || '',
  mpWebhookSecret: process.env.MP_WEBHOOK_SECRET || '',
  emailProvider: process.env.EMAIL_PROVIDER || 'mock',
  claudiaNotificationEmail: process.env.CLAUDIA_NOTIFICATION_EMAIL || 'claudia@luminaumay.com',
  smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
  smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
};
```

### 4.6 Custom Error Classes (`src/server/errors/app-error.ts`)

```ts
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code?: string;

  constructor(message: string, statusCode: number = 500, code?: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Recurso no encontrado') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Conflicto en la operación') {
    super(message, 409, 'CONFLICT');
  }
}

export class BadRequestError extends AppError {
  constructor(message: string = 'Solicitud inválida') {
    super(message, 400, 'BAD_REQUEST');
  }
}
```

### 4.7 Zod Validation Schemas (`src/server/validators/slot.validator.ts`)

```ts
import { z } from 'zod';

export const SlotIdParamSchema = z.object({
  id: z.string().uuid({ message: 'El ID del horario debe ser un UUID válido' })
});

export const ReleaseSlotBodySchema = z.object({
  lock_token: z.string().min(1, { message: 'El token de bloqueo es requerido' })
});

export const GetSlotsQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'El formato de fecha debe ser YYYY-MM-DD' }).optional(),
  from: z.string().optional(),
  to: z.string().optional()
});
```

### 4.8 Slot Routes Controller (`src/server/routes/slots.routes.ts`)

```ts
import { Router, Request, Response, NextFunction } from 'express';
import { slotService } from '../services/slot.service.js';
import { SlotIdParamSchema, ReleaseSlotBodySchema, GetSlotsQuerySchema } from '../validators/slot.validator.js';

export const slotsRouter = Router();

/**
 * GET /api/slots
 * Returns all currently available slots (auto-sweeping expired locks)
 */
slotsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = GetSlotsQuerySchema.parse(req.query);
    const slots = slotService.getAvailableSlots(query.date);

    return res.status(200).json({
      success: true,
      slots
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /api/slots/:id/lock
 * Acquires a 15-minute soft lock on a slot
 */
slotsRouter.post('/:id/lock', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = SlotIdParamSchema.parse(req.params);
    const lockResult = slotService.acquireSoftLock(params.id);

    return res.status(200).json({
      success: true,
      message: 'Horario apartado temporalmente por 15 minutos',
      slot_id: lockResult.slot_id,
      lock_token: lockResult.lock_token,
      expires_at: lockResult.expires_at
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /api/slots/:id/release
 * Manually releases a held soft lock using its lock_token
 */
slotsRouter.post('/:id/release', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = SlotIdParamSchema.parse(req.params);
    const body = ReleaseSlotBodySchema.parse(req.body);

    slotService.releaseSoftLock(params.id, body.lock_token);

    return res.status(200).json({
      success: true,
      message: 'Horario liberado exitosamente'
    });
  } catch (error) {
    return next(error);
  }
});
```

### 4.9 Express App Setup (`src/server/app.ts`)

```ts
import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { ZodError } from 'zod';
import { config } from './config.js';
import { AppError } from './errors/app-error.js';
import { slotsRouter } from './routes/slots.routes.js';

export function createApp(): Express {
  const app = express();

  // CORS middleware
  app.use(cors({
    origin: config.corsOrigin,
    credentials: true
  }));

  // JSON Body parser with rawBody retention for webhook HMAC signature verification
  app.use(express.json({
    limit: '2mb',
    verify: (req: Request & { rawBody?: Buffer }, _res: Response, buf: Buffer) => {
      req.rawBody = buf;
    }
  }));

  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // Static assets serving (Frontend client)
  const clientPath = path.join(process.cwd(), 'src', 'client');
  app.use(express.static(clientPath));

  // Health check endpoint
  app.get('/api/health', (_req: Request, res: Response) => {
    res.status(200).json({
      success: true,
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'Lumina Umay API'
    });
  });

  // Slot Routes
  app.use('/api/slots', slotsRouter);

  // 404 handler for API routes
  app.all('/api/*', (_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: 'Endpoint no encontrado'
    });
  });

  // Global Error Handler
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      return res.status(400).json({
        success: false,
        error: 'Error de validación en los datos enviados',
        details: err.errors.map(e => ({
          path: e.path.join('.'),
          message: e.message
        }))
      });
    }

    if (err instanceof AppError) {
      return res.status(err.statusCode).json({
        success: false,
        error: err.message,
        code: err.code
      });
    }

    console.error('[Unhandled Server Error]:', err);
    return res.status(500).json({
      success: false,
      error: 'Error interno del servidor. Por favor intenta más tarde.'
    });
  });

  return app;
}

export const app = createApp();
```

### 4.10 Express Server Entry Point (`src/server/index.ts`)

```ts
import { app } from './app.js';
import { config } from './config.js';
import { initDatabase } from './db/database.js';
import { seedDefaultSlots } from './db/seed.js';

async function bootstrap() {
  try {
    // 1. Initialize SQLite schema in WAL mode
    initDatabase();
    console.log('[Database] SQLite initialized with WAL mode.');

    // 2. Seed initial slots if table is empty
    seedDefaultSlots();

    // 3. Start listening
    const server = app.listen(config.port, () => {
      console.log(`[Server] Lumina Umay booking backend running at http://localhost:${config.port}`);
      console.log(`[Server] Environment: ${config.nodeEnv}`);
    });

    // Graceful shutdown handling
    const shutdown = (signal: string) => {
      console.log(`[Server] Received ${signal}. Shutting down gracefully...`);
      server.close(() => {
        console.log('[Server] HTTP server closed.');
        process.exit(0);
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    console.error('[Fatal Bootstrap Error]:', error);
    process.exit(1);
  }
}

bootstrap();
```

### 4.11 Integration Test Suite Spec (`tests/integration/slots.routes.test.ts`)

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/app.js';
import { getDb, closeDb } from '../../src/server/db/database.js';
import { seedDefaultSlots } from '../../src/server/db/seed.js';

describe('Slots API Integration Tests', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    // In-memory or isolated DB for testing
    process.env.DB_PATH = ':memory:';
    getDb();
    seedDefaultSlots();
    app = createApp();
  });

  afterEach(() => {
    closeDb();
  });

  it('GET /api/slots returns available slots', async () => {
    const res = await request(app).get('/api/slots');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.slots)).toBe(true);
    expect(res.body.slots.length).toBeGreaterThan(0);
    expect(res.body.slots[0]).toHaveProperty('id');
    expect(res.body.slots[0]).toHaveProperty('start_time');
    expect(res.body.slots[0]).toHaveProperty('end_time');
    expect(res.body.slots[0].status).toBe('available');
  });

  it('POST /api/slots/:id/lock successfully acquires a 15-min soft lock', async () => {
    const listRes = await request(app).get('/api/slots');
    const slotId = listRes.body.slots[0].id;

    const lockRes = await request(app).post(`/api/slots/${slotId}/lock`);
    expect(lockRes.status).toBe(200);
    expect(lockRes.body.success).toBe(true);
    expect(lockRes.body.slot_id).toBe(slotId);
    expect(lockRes.body.lock_token).toBeDefined();
    expect(lockRes.body.expires_at).toBeDefined();
  });

  it('POST /api/slots/:id/lock returns 409 Conflict on already locked slot', async () => {
    const listRes = await request(app).get('/api/slots');
    const slotId = listRes.body.slots[0].id;

    // First lock succeeds
    const lock1 = await request(app).post(`/api/slots/${slotId}/lock`);
    expect(lock1.status).toBe(200);

    // Second lock fails with 409
    const lock2 = await request(app).post(`/api/slots/${slotId}/lock`);
    expect(lock2.status).toBe(409);
    expect(lock2.body.success).toBe(false);
    expect(lock2.body.error).toContain('apartado');
  });

  it('POST /api/slots/:id/release successfully releases a held lock', async () => {
    const listRes = await request(app).get('/api/slots');
    const slotId = listRes.body.slots[0].id;

    const lockRes = await request(app).post(`/api/slots/${slotId}/lock`);
    const lockToken = lockRes.body.lock_token;

    const releaseRes = await request(app)
      .post(`/api/slots/${slotId}/release`)
      .send({ lock_token: lockToken });

    expect(releaseRes.status).toBe(200);
    expect(releaseRes.body.success).toBe(true);

    // Now slot should be lockable again
    const lockAgainRes = await request(app).post(`/api/slots/${slotId}/lock`);
    expect(lockAgainRes.status).toBe(200);
  });

  it('Prevents race conditions: 10 concurrent locks on same slot yield exactly 1 winner and 9 conflicts', async () => {
    const listRes = await request(app).get('/api/slots');
    const slotId = listRes.body.slots[0].id;

    const promises = Array.from({ length: 10 }).map(() =>
      request(app).post(`/api/slots/${slotId}/lock`)
    );

    const results = await Promise.all(promises);
    const successes = results.filter(r => r.status === 200);
    const conflicts = results.filter(r => r.status === 409);

    expect(successes.length).toBe(1);
    expect(conflicts.length).toBe(9);
  });
});
```

---

## 5. Verification Method

To independently verify the toolchain, package setup, and slot route endpoints during Worker execution:

1. **Package Installation & Compilation**:
   ```bash
   npm install
   npm run typecheck
   ```
   *Expected Result*: Zero TypeScript errors (`tsc --noEmit` exits with code 0).

2. **Database Seeding**:
   ```bash
   npm run db:seed
   ```
   *Expected Result*: Default Monday–Friday slots populated in SQLite database.

3. **Vitest Unit & Integration Test Suite**:
   ```bash
   npm test
   ```
   *Expected Result*: 100% passing tests across unit slot services and Supertest route endpoints (verifying 200, 400, 404, 409, and concurrent lock resolution).

4. **Invalidation Conditions**:
   - If `npm run build` or `npm run typecheck` produces module resolution errors on NodeNext imports.
   - If simultaneous lock requests on the same slot ID produce more than one HTTP 200 response.
   - If release endpoint accepts invalid/empty lock tokens.
