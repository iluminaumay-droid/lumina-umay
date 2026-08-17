import { Router, Request, Response } from 'express';
import { db } from '../db/database.js';
import { SlotService } from '../services/slot.service.js';
import { seedDefaultSlots } from '../db/seed.js';
import { EmailService } from '../services/email.service.js';

export const testRouter = Router();

/**
 * POST /api/test/reset
 * Resets database state and re-seeds default slots for testing.
 */
testRouter.post('/reset', (_req: Request, res: Response) => {
  try {
    db.prepare(`DELETE FROM webhook_events`).run();
    db.prepare(`DELETE FROM orders`).run();
    db.prepare(`DELETE FROM slots`).run();

    SlotService.resetVirtualTime();
    EmailService.clearCapturedEmails();
    seedDefaultSlots({ daysAhead: 21, force: true });

    return res.status(200).json({
      success: true,
      message: 'State reset and slots reseeded successfully.',
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/test/advance-time
 * Advances virtual time for testing TTL expirations.
 */
testRouter.post('/advance-time', (req: Request, res: Response) => {
  try {
    const { seconds } = req.body;
    SlotService.advanceTime(seconds || 0);

    return res.status(200).json({
      success: true,
      currentTime: SlotService.getCurrentIso(),
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/test/emails
 * Returns captured mock emails.
 */
testRouter.get('/emails', (_req: Request, res: Response) => {
  return res.status(200).json({
    success: true,
    emails: EmailService.getCapturedEmails(),
  });
});

