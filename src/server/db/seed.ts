import { v4 as uuidv4 } from 'uuid';
import { getDatabase, closeDatabase } from './database.js';

export interface SeedOptions {
  daysAhead?: number;
  dbPath?: string;
  force?: boolean;
}

/**
 * Daily consultation time blocks in Mexico Central Time (America/Mexico_City, UTC-6).
 * Monday - Friday: 10:00, 11:30, 14:00, 15:30, 17:00 (45-min duration each).
 */
const DAILY_SCHEDULE_CDMX = [
  { startHour: 10, startMinute: 0, durationMinutes: 45 },
  { startHour: 11, startMinute: 30, durationMinutes: 45 },
  { startHour: 14, startMinute: 0, durationMinutes: 45 },
  { startHour: 15, startMinute: 30, durationMinutes: 45 },
  { startHour: 17, startMinute: 0, durationMinutes: 45 },
];

/**
 * Converts a CDMX year, month, day, hour, minute to UTC ISO-8601 string.
 * Mexico City is UTC-6 year-round.
 */
export function toUtcIso(year: number, month: number, day: number, cdmxHour: number, cdmxMinute: number): string {
  // CDMX is UTC-6, so UTC hour = cdmxHour + 6
  const utcDate = new Date(Date.UTC(year, month - 1, day, cdmxHour + 6, cdmxMinute, 0, 0));
  return utcDate.toISOString();
}

/**
 * Seeds default consultation slots.
 */
export function seedDefaultSlots(options: SeedOptions = {}): { insertedCount: number; totalAvailable: number } {
  const daysAhead = options.daysAhead || 21; // 3 weeks of slots
  const db = getDatabase({ dbPath: options.dbPath });

  if (options.force) {
    db.prepare(`DELETE FROM slots WHERE status = 'available'`).run();
  }

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO slots (id, start_time, end_time, status)
    VALUES (?, ?, ?, 'available')
  `);

  let insertedCount = 0;
  const now = new Date();

  const seedTransaction = db.transaction(() => {
    // Generate weekday slots for the upcoming weeks
    for (let dayOffset = 1; dayOffset <= daysAhead; dayOffset++) {
      const targetDate = new Date();
      targetDate.setDate(now.getDate() + dayOffset);

      // 0 = Sunday, 6 = Saturday (Skip weekends)
      const dayOfWeek = targetDate.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        continue;
      }

      const year = targetDate.getFullYear();
      const month = targetDate.getMonth() + 1;
      const day = targetDate.getDate();

      for (const block of DAILY_SCHEDULE_CDMX) {
        const startTimeUtc = toUtcIso(year, month, day, block.startHour, block.startMinute);

        // Calculate end time
        const endMinutesTotal = block.startMinute + block.durationMinutes;
        const endHour = block.startHour + Math.floor(endMinutesTotal / 60);
        const endMinute = endMinutesTotal % 60;
        const endTimeUtc = toUtcIso(year, month, day, endHour, endMinute);

        // Deterministic or unique ID
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const timeStr = `${String(block.startHour).padStart(2, '0')}${String(block.startMinute).padStart(2, '0')}`;
        const slotId = `slot_${dateStr}_${timeStr}`;

        const result = insertStmt.run(slotId, startTimeUtc, endTimeUtc);
        if (result.changes > 0) {
          insertedCount++;
        }
      }
    }
  });

  seedTransaction();

  const totalAvailable = (
    db.prepare(`SELECT count(*) as count FROM slots WHERE status IN ('available', 'AVAILABLE')`).get() as any
  ).count;

  return { insertedCount, totalAvailable };
}

// Direct execution check
const isMain = process.argv[1] && (process.argv[1].endsWith('seed.ts') || process.argv[1].endsWith('seed.js'));
if (isMain) {
  console.log('🌱 Seeding Lumina Umay consultation slots...');
  const result = seedDefaultSlots();
  console.log(`✅ Seeding complete: ${result.insertedCount} new slots created. Total available: ${result.totalAvailable}`);
  closeDatabase();
}
