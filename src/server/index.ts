import { app } from './app.js';
import { config } from './config.js';
import { initDatabase, db } from './db/database.js';
import { seedDefaultSlots } from './db/seed.js';
import { SlotService } from './services/slot.service.js';

async function bootstrap() {
  try {
    // 1. Initialize SQLite schema in WAL mode
    initDatabase();
    console.log('[Database] SQLite initialized with WAL mode.');

    // 2. Seed initial slots if slots table is empty
    const slotCount = (db.prepare(`SELECT count(*) as count FROM slots`).get() as any).count;
    if (slotCount === 0) {
      const seedRes = seedDefaultSlots();
      console.log(`[Database] Auto-seeded ${seedRes.insertedCount} consultation slots.`);
    }

    // 3. Start background TTL sweeper
    SlotService.startSweeper(60000);

    // 4. Start Express HTTP Server
    const server = app.listen(config.port, () => {
      console.log(`[Server] Lumina Umay booking backend running at http://localhost:${config.port}`);
      console.log(`[Server] Environment: ${config.nodeEnv}`);
    });

    // Graceful shutdown handling
    const shutdown = (signal: string) => {
      console.log(`[Server] Received ${signal}. Shutting down gracefully...`);
      SlotService.stopSweeper();
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
