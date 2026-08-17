export type TierId = '1_carta' | '3_cartas' | '5_cartas' | 'llamada' | 'call_session';

export type ReadingCategory = 'Amor' | 'Trabajo/Dinero' | 'Familia' | 'Otro';

export type OrderStatus =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'manual_review'
  | 'approved'
  | 'rejected'
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'OVERBOOKED_NEEDS_RESCHEDULING';

export interface Order {
  id: string;
  tier_id: string;
  category: string;
  amount_mxn: number;
  customer_name: string;
  customer_email: string;
  customer_phone?: string | null;
  customer_birthdate: string;
  question: string;
  involved_names?: string | null;
  core_focus?: string | null;
  slot_id?: string | null;
  lock_token?: string | null;
  mp_preference_id?: string | null;
  mp_payment_id?: string | null;
  status: string;
  email_sent: number;
  customer_email_sent: number;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreatePreferenceDTO {
  tier_id: TierId;
  category: ReadingCategory;
  customer_name: string;
  customer_email: string;
  customer_phone?: string;
  customer_birthdate: string;
  question: string;
  involved_names?: string;
  core_focus?: string;
  slot_id?: string;
  lock_token?: string;
  amount?: number;
}

export interface TierInfo {
  id: string;
  price: number;
  name: string;
  description: string;
  isCall: boolean;
}

export const TIER_CONFIG: Record<string, TierInfo> = {
  '1_carta': {
    id: '1_carta',
    price: 150,
    name: 'Lectura de 1 Carta',
    description: 'Lectura puntual de sí o no. Respuesta garantizada en 24 horas por correo electrónico.',
    isCall: false,
  },
  '3_cartas': {
    id: '3_cartas',
    price: 350,
    name: 'Lectura de 3 Cartas',
    description: 'Lectura general de situación. Respuesta garantizada en 24 horas por correo electrónico.',
    isCall: false,
  },
  '5_cartas': {
    id: '5_cartas',
    price: 500,
    name: 'Lectura de 5 Cartas',
    description: 'Lectura profunda con enfoque y personas involucradas. Respuesta garantizada en 24 horas por correo electrónico.',
    isCall: false,
  },
  'llamada': {
    id: 'llamada',
    price: 450,
    name: 'Sesión por Llamada',
    description: 'Sesión en vivo de 45 minutos por videollamada / llamada en horario reservado.',
    isCall: true,
  },
  'call_session': {
    id: 'llamada',
    price: 450,
    name: 'Sesión por Llamada',
    description: 'Sesión en vivo de 45 minutos por videollamada / llamada en horario reservado.',
    isCall: true,
  },
};
