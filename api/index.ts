import { createApp } from '../src/server/app.js';
import { initDatabase, db } from '../src/server/db/database.js';
import { hydrateFromSupabase } from '../src/server/db/supabase.js';
import { seedDefaultSlots } from '../src/server/db/seed.js';

const app = createApp();

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    try {
      initDatabase({ dbPath: '/tmp/lumina_umay.sqlite' });
      await hydrateFromSupabase(db);
      
      // Auto seed slots if still empty
      const slotCount = (db.prepare(`SELECT count(*) as count FROM slots`).get() as any).count;
      if (slotCount === 0) {
        seedDefaultSlots({ dbPath: '/tmp/lumina_umay.sqlite' });
      }
      initialized = true;
    } catch (err) {
      console.error('[Vercel Bootstrap Warning]:', err);
    }
  }
}

export default async function handler(req: any, res: any) {
  try {
    await ensureInitialized();
  } catch (initErr) {
    console.error('[Handler Init Error]:', initErr);
  }
  return app(req, res);
}
