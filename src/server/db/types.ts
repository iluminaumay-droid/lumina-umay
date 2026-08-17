export type ProductTier = '1_carta' | '3_cartas' | '5_cartas' | 'call_session' | 'llamada';

export type ReadingCategory = 'Amor' | 'Trabajo/Dinero' | 'Familia' | 'Otro';

export type SlotStatus = 'available' | 'locked' | 'booked' | 'cancelled' | 'AVAILABLE' | 'SOFT_LOCKED' | 'BOOKED' | 'CANCELLED';

export type OrderStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | 'expired' | 'manual_review' | 'approved' | 'rejected' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Slot {
  id: string;
  start_time: string;
  end_time: string;
  status: SlotStatus;
  locked_at: string | null;
  lock_expires_at: string | null;
  lock_token: string | null;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  tier_id: ProductTier;
  category: ReadingCategory;
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
  status: OrderStatus;
  email_sent: number;
  customer_email_sent: number;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookEvent {
  id: string;
  mp_payment_id: string;
  event_type: string;
  payload: string;
  signature?: string | null;
  status: 'processed' | 'ignored' | 'failed';
  error_message?: string | null;
  processed_at?: string | null;
  created_at: string;
}
