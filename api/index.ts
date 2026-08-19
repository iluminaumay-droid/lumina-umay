import { createApp } from '../src/server/app.js';
import { initDatabase, db } from '../src/server/db/database.js';
import { hydrateFromSupabase } from '../src/server/db/supabase.js';
import { seedDefaultSlots } from '../src/server/db/seed.js';

const app = createApp();

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    try {
      initDatabase();
      await hydrateFromSupabase(db);
      
      // Auto seed slots if still empty
      const slotCount = (db.prepare(`SELECT count(*) as count FROM slots`).get() as any).count;
      if (slotCount === 0) {
        seedDefaultSlots();
      }
      initialized = true;
    } catch (err) {
      console.warn('[Vercel Bootstrap Warning]:', err);
    }
  }
}

export default async function handler(req: any, res: any) {
  await ensureInitialized();
  return app(req, res);
}
