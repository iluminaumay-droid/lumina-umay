import { Router, Request, Response, NextFunction } from 'express';
import { SlotService } from '../services/slot.service.js';
import { SlotError } from '../types/slot.types.js';
import { SlotIdParamSchema, ReleaseSlotBodySchema, GetSlotsQuerySchema } from '../validators/slot.validator.js';

export const slotsRouter = Router();

/**
 * GET /api/slots
 * Returns all currently available upcoming slots (auto-sweeping expired locks).
 */
slotsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = GetSlotsQuerySchema.parse(req.query);
    const filter = query.date || query.from;
    const slots = SlotService.getAvailableSlots(filter);

    return res.status(200).json({
      success: true,
      slots,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /api/slots/:id/lock
 * Acquires a 15-minute soft lock on the specified slot.
 */
slotsRouter.post('/:id/lock', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = SlotIdParamSchema.parse(req.params);
    const lockResult = SlotService.acquireSoftLock(params.id);

    return res.status(200).json({
      success: true,
      message: 'Horario apartado temporalmente por 15 minutos',
      slot_id: lockResult.slot_id,
      lock_token: lockResult.lock_token,
      expires_at: lockResult.expires_at,
    });
  } catch (error) {
    if (error instanceof SlotError) {
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        error: error.message,
      });
    }
    return next(error);
  }
});

/**
 * POST /api/slots/:id/release
 * Releases a soft lock with the matching lock token.
 */
slotsRouter.post('/:id/release', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = SlotIdParamSchema.parse(req.params);
    const body = ReleaseSlotBodySchema.parse(req.body);

    const released = SlotService.releaseSoftLock(params.id, body.lock_token);

    if (!released) {
      return res.status(404).json({
        success: false,
        error: 'El horario no está apartado o el token de bloqueo es inválido.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Horario liberado exitosamente',
    });
  } catch (error) {
    if (error instanceof SlotError) {
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        error: error.message,
      });
    }
    return next(error);
  }
});
