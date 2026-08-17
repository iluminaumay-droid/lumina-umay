import { z } from 'zod';

export const SlotIdParamSchema = z.object({
  id: z.string().min(1, { message: 'El ID del horario es requerido' }),
});

export const ReleaseSlotBodySchema = z.object({
  lock_token: z.string().min(1, { message: 'Token de bloqueo no proporcionado.' }),
});

export const GetSlotsQuerySchema = z.object({
  date: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});
