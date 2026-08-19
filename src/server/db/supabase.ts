import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';

let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (process.env.NODE_ENV === 'test') {
    return null;
  }
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    return null;
  }
  if (!supabaseClient) {
    supabaseClient = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return supabaseClient;
}

export const supabase = getSupabaseClient();

/**
 * Background async helper to safely mirror records to Supabase without blocking local responses.
 */
export async function syncOrderToSupabase(orderData: any): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  try {
    const payload = {
      id: orderData.id,
      tier_id: orderData.tier_id,
      category: orderData.category,
      amount_mxn: Number(orderData.amount_mxn),
      customer_name: orderData.customer_name,
      customer_email: orderData.customer_email,
      customer_phone: orderData.customer_phone || null,
      customer_birthdate: orderData.customer_birthdate,
      question: orderData.question,
      involved_names: orderData.involved_names || null,
      core_focus: orderData.core_focus || null,
      slot_id: orderData.slot_id || null,
      lock_token: orderData.lock_token || null,
      mp_preference_id: orderData.mp_preference_id || null,
      mp_payment_id: orderData.mp_payment_id || null,
      status: String(orderData.status).toLowerCase(),
      email_sent: Boolean(orderData.email_sent),
      customer_email_sent: Boolean(orderData.customer_email_sent),
      notes: orderData.notes || null,
      created_at: orderData.created_at || new Date().toISOString(),
      updated_at: orderData.updated_at || new Date().toISOString(),
    };

    const { error } = await client.from('orders').upsert(payload, { onConflict: 'id' });
    if (error) {
      console.warn('[Supabase Sync] Warning syncing order:', error.message);
    }
  } catch (err: any) {
    console.warn('[Supabase Sync] Exception syncing order:', err.message);
  }
}

/**
 * Background async helper to sync slot status to Supabase.
 */
export async function syncSlotToSupabase(slotData: any): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  try {
    const payload = {
      id: slotData.id,
      start_time: slotData.start_time,
      end_time: slotData.end_time,
      status: String(slotData.status).toLowerCase(),
      locked_at: slotData.locked_at || null,
      lock_expires_at: slotData.lock_expires_at || null,
      lock_token: slotData.lock_token || null,
      created_at: slotData.created_at || new Date().toISOString(),
      updated_at: slotData.updated_at || new Date().toISOString(),
    };

    const { error } = await client.from('slots').upsert(payload, { onConflict: 'id' });
    if (error) {
      console.warn('[Supabase Sync] Warning syncing slot:', error.message);
    }
  } catch (err: any) {
    console.warn('[Supabase Sync] Exception syncing slot:', err.message);
  }
}

/**
 * Background async helper to sync webhook audit events to Supabase.
 */
export async function syncWebhookToSupabase(webhookData: any): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  try {
    let parsedPayload = webhookData.payload;
    if (typeof parsedPayload === 'string') {
      try {
        parsedPayload = JSON.parse(parsedPayload);
      } catch {
        parsedPayload = { raw: webhookData.payload };
      }
    }

    const payload = {
      id: webhookData.id,
      mp_payment_id: String(webhookData.mp_payment_id || ''),
      event_type: webhookData.event_type || 'payment',
      payload: parsedPayload,
      signature: webhookData.signature || null,
      status: webhookData.status || 'processed',
      error_message: webhookData.error_message || null,
      processed_at: webhookData.processed_at || new Date().toISOString(),
      created_at: webhookData.created_at || new Date().toISOString(),
    };

    const { error } = await client.from('webhook_events').upsert(payload, { onConflict: 'id' });
    if (error) {
      console.warn('[Supabase Sync] Warning syncing webhook event:', error.message);
    }
  } catch (err: any) {
    console.warn('[Supabase Sync] Exception syncing webhook event:', err.message);
  }
}

/**
 * Hydrates local SQLite state from Supabase on cold boot if needed.
 */
export async function hydrateFromSupabase(db: any): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  try {
    const { data: slots, error: slotsErr } = await client.from('slots').select('*');
    if (!slotsErr && slots && slots.length > 0) {
      for (const slot of slots) {
        db.prepare(`
          INSERT INTO slots (id, start_time, end_time, status, locked_at, lock_expires_at, lock_token, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            status = excluded.status,
            locked_at = excluded.locked_at,
            lock_expires_at = excluded.lock_expires_at,
            lock_token = excluded.lock_token,
            updated_at = excluded.updated_at
        `).run(
          slot.id,
          slot.start_time,
          slot.end_time,
          slot.status,
          slot.locked_at,
          slot.lock_expires_at,
          slot.lock_token,
          slot.created_at,
          slot.updated_at
        );
      }
      console.log(`[Supabase] Hydrated ${slots.length} slots from cloud database.`);
    }

    const { data: orders, error: ordersErr } = await client.from('orders').select('*');
    if (!ordersErr && orders && orders.length > 0) {
      for (const order of orders) {
        db.prepare(`
          INSERT INTO orders (
            id, tier_id, category, amount_mxn, customer_name, customer_email, customer_phone,
            customer_birthdate, question, involved_names, core_focus, slot_id, lock_token,
            mp_preference_id, mp_payment_id, status, email_sent, customer_email_sent, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            status = excluded.status,
            mp_payment_id = excluded.mp_payment_id,
            email_sent = excluded.email_sent,
            customer_email_sent = excluded.customer_email_sent,
            updated_at = excluded.updated_at
        `).run(
          order.id,
          order.tier_id,
          order.category,
          order.amount_mxn,
          order.customer_name,
          order.customer_email,
          order.customer_phone,
          order.customer_birthdate,
          order.question,
          order.involved_names,
          order.core_focus,
          order.slot_id,
          order.lock_token,
          order.mp_preference_id,
          order.mp_payment_id,
          order.status,
          order.email_sent ? 1 : 0,
          order.customer_email_sent ? 1 : 0,
          order.notes,
          order.created_at,
          order.updated_at
        );
      }
      console.log(`[Supabase] Hydrated ${orders.length} orders from cloud database.`);
    }
  } catch (err: any) {
    console.warn('[Supabase] Hydration warning:', err.message);
  }
}
