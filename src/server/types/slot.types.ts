export type SlotStatus = 'available' | 'locked' | 'booked' | 'cancelled' | 'AVAILABLE' | 'SOFT_LOCKED' | 'BOOKED' | 'CANCELLED';

export interface Slot {
  id: string;
  start_time: string;       // ISO-8601 UTC (e.g. '2026-08-20T16:00:00.000Z')
  end_time: string;         // ISO-8601 UTC (e.g. '2026-08-20T16:45:00.000Z')
  status: SlotStatus;
  locked_at: string | null;
  lock_expires_at: string | null;
  lock_token: string | null;
  created_at: string;
  updated_at: string;
}

export interface AvailableSlotDTO {
  id: string;
  start_time: string;
  end_time: string;
  status: string;
  date?: string;          // YYYY-MM-DD
  time_start?: string;    // HH:mm
  time_end?: string;      // HH:mm
}

export interface LockAcquisitionResult {
  slot_id: string;
  lock_token: string;
  expires_at: string;
}

export class SlotError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = 'SlotError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class SlotNotFoundError extends SlotError {
  constructor(slotId: string = '') {
    super(
      slotId ? `El horario con ID ${slotId} no fue encontrado (no encontrado).` : 'Horario no encontrado',
      'SLOT_NOT_FOUND',
      404
    );
    this.name = 'SlotNotFoundError';
  }
}

export class SlotConflictError extends SlotError {
  constructor(message: string = 'El horario seleccionado ya fue apartado por otra persona. Por favor elige otro horario.') {
    super(message, 'SLOT_LOCK_CONFLICT', 409);
    this.name = 'SlotConflictError';
  }
}
