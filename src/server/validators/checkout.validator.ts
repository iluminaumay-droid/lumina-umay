import { z } from 'zod';
import { SlotService } from '../services/slot.service.js';

/**
 * Validates a Gregorian calendar birthdate string in YYYY-MM-DD format.
 * Rejects non-existent dates (e.g. Feb 30), future dates, dates before 1900, and malformed strings.
 */
export function isValidBirthdate(dateStr: string): boolean {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }

  const parts = dateStr.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);

  if (isNaN(year) || isNaN(month) || isNaN(day)) {
    return false;
  }

  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  // Strict Gregorian check
  const dateObj = new Date(Date.UTC(year, month - 1, day));
  if (
    dateObj.getUTCFullYear() !== year ||
    dateObj.getUTCMonth() !== month - 1 ||
    dateObj.getUTCDate() !== day
  ) {
    return false;
  }

  // Must be strictly in the past
  const now = SlotService ? SlotService.getCurrentTime() : new Date();
  if (dateObj.getTime() >= now.getTime()) {
    return false;
  }

  return true;
}

export const createPreferenceSchema = z
  .object({
    tier_id: z.enum(['1_carta', '3_cartas', '5_cartas', 'llamada', 'call_session'], {
      errorMap: () => ({ message: 'Tipo de lectura o servicio no válido' }),
    }),
    category: z
      .enum(['Amor', 'Trabajo/Dinero', 'Familia', 'Otro'], {
        errorMap: () => ({ message: 'Por favor selecciona una categoría válida (Amor, Trabajo/Dinero, Familia, Otro)' }),
      })
      .default('Otro'),
    customer_name: z
      .string({ required_error: 'Nombre del consultante requerido' })
      .trim()
      .min(2, 'Nombre del consultante requerido (mínimo 2 caracteres)')
      .max(200, 'El nombre no puede exceder 200 caracteres'),
    customer_email: z
      .string({ required_error: 'Correo electrónico requerido' })
      .trim()
      .email('Correo electrónico válido requerido'),
    customer_phone: z.string().trim().optional(),
    customer_birthdate: z
      .string({ required_error: 'Fecha de nacimiento requerida' })
      .trim()
      .refine(isValidBirthdate, {
        message: 'Por favor ingresa una fecha de nacimiento válida (formato AAAA-MM-DD en el pasado).',
      }),
    question: z
      .string({ required_error: 'Por favor ingresa tu pregunta o consulta (requerido)' })
      .trim()
      .min(1, 'Por favor ingresa tu pregunta o consulta (requerido)')
      .max(10000, 'La pregunta no puede exceder 10,000 caracteres'),
    involved_names: z.string().trim().optional(),
    core_focus: z.string().trim().optional(),
    slot_id: z.string().trim().optional(),
    lock_token: z.string().trim().optional(),
    amount: z.number().optional(),
  })
  .superRefine((data, ctx) => {
    // 5 cartas requires core_focus
    if (data.tier_id === '5_cartas') {
      if (!data.core_focus || data.core_focus.trim().length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['core_focus'],
          message: 'Por favor especifica qué es lo que más deseas saber (requerido para lectura de 5 cartas)',
        });
      }
    }

    // Call session requires slot_id
    if (data.tier_id === 'llamada' || data.tier_id === 'call_session') {
      if (!data.slot_id || data.slot_id.trim().length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['slot_id'],
          message: 'Por favor selecciona un horario para tu llamada',
        });
      }
    }
  });

export type CreatePreferenceInput = z.infer<typeof createPreferenceSchema>;
