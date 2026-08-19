import { google, calendar_v3 } from 'googleapis';
import { config } from '../config.js';
import { Order } from '../types/checkout.types.js';

export interface BusyRange {
  start: Date;
  end: Date;
}

export class GoogleCalendarService {
  private static calendarClient: calendar_v3.Calendar | null = null;

  /**
   * Initializes or returns the authenticated Google Calendar API client.
   */
  private static getClient(): calendar_v3.Calendar | null {
    if (this.calendarClient) {
      return this.calendarClient;
    }

    const serviceAccountEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

    try {
      if (serviceAccountEmail && privateKey) {
        const auth = new google.auth.JWT({
          email: serviceAccountEmail,
          key: privateKey,
          scopes: ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/calendar.events'],
          subject: process.env.GOOGLE_CALENDAR_ID || config.claudiaNotificationEmail,
        });

        this.calendarClient = google.calendar({ version: 'v3', auth });
        return this.calendarClient;
      }

      if (clientId && clientSecret && refreshToken) {
        const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
        oauth2Client.setCredentials({ refresh_token: refreshToken });

        this.calendarClient = google.calendar({ version: 'v3', auth: oauth2Client });
        return this.calendarClient;
      }
    } catch (error) {
      console.warn('[Google Calendar] Failed to initialize Google Calendar client:', error);
    }

    return null;
  }

  /**
   * Checks if Google Calendar integration is actively configured.
   */
  static isConfigured(): boolean {
    return this.getClient() !== null;
  }

  /**
   * Fetches busy time intervals from Claudia's Google Calendar.
   */
  static async getBusyRanges(timeMin: string, timeMax: string): Promise<BusyRange[]> {
    const client = this.getClient();
    if (!client) return [];

    const calendarId = process.env.GOOGLE_CALENDAR_ID || config.claudiaNotificationEmail || 'primary';

    try {
      const res = await client.freebusy.query({
        requestBody: {
          timeMin,
          timeMax,
          timeZone: 'America/Mexico_City',
          items: [{ id: calendarId }],
        },
      });

      const busyList = res.data.calendars?.[calendarId]?.busy || [];
      return busyList
        .filter((b) => b.start && b.end)
        .map((b) => ({
          start: new Date(b.start!),
          end: new Date(b.end!),
        }));
    } catch (error: any) {
      console.warn('[Google Calendar] Error querying FreeBusy:', error.message);
      return [];
    }
  }

  /**
   * Creates a Google Calendar event for an approved live tarot call session.
   */
  static async createAppointmentEvent(
    order: Order,
    slot: { start_time: string; end_time: string }
  ): Promise<{ eventId?: string; meetLink?: string; htmlLink?: string } | null> {
    const client = this.getClient();
    if (!client) {
      console.log('[Google Calendar] Service not configured — skipping Google Calendar event creation.');
      return null;
    }

    const calendarId = process.env.GOOGLE_CALENDAR_ID || config.claudiaNotificationEmail || 'primary';

    const description = [
      '🔮 SESIÓN DE TAROT EN VIVO — LUMINA UMAY',
      '───────────────────────────────────────',
      `👤 Cliente: ${order.customer_name}`,
      `📧 Correo: ${order.customer_email}`,
      `📱 Teléfono del Cliente: ${order.customer_phone || 'No especificado'}`,
      `🎂 Fecha de Nacimiento: ${order.customer_birthdate}`,
      `🏷️ Categoría: ${order.category}`,
      `❓ Pregunta / Tema: ${order.question}`,
      order.involved_names ? `👥 Personas Involucradas: ${order.involved_names}` : '',
      order.core_focus ? `🎯 Enfoque Principal: ${order.core_focus}` : '',
      '───────────────────────────────────────',
      '📞 Teléfono de Contacto Lumina: +52 870 171 3372',
      `💳 ID de Orden: ${order.id}`,
      `💰 Monto Pagado: $${order.amount_mxn} MXN`,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const event: calendar_v3.Schema$Event = {
        summary: `🔮 Tarot: ${order.customer_name}`,
        description,
        start: {
          dateTime: slot.start_time,
          timeZone: 'America/Mexico_City',
        },
        end: {
          dateTime: slot.end_time,
          timeZone: 'America/Mexico_City',
        },
        attendees: [
          { email: config.claudiaNotificationEmail, displayName: 'Claudia — Lumina Umay', responseStatus: 'accepted' },
          { email: order.customer_email, displayName: order.customer_name },
        ],
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 24 * 60 }, // 24 hours before
            { method: 'popup', minutes: 60 },      // 1 hour before
            { method: 'popup', minutes: 15 },      // 15 mins before
          ],
        },
      };

      const response = await client.events.insert({
        calendarId,
        requestBody: event,
        sendUpdates: 'all', // Sends calendar invitations to both Claudia and customer
      });

      console.log(`[Google Calendar] Event successfully created: ${response.data.id} (${response.data.htmlLink})`);

      return {
        eventId: response.data.id || undefined,
        meetLink: response.data.hangoutLink || undefined,
        htmlLink: response.data.htmlLink || undefined,
      };
    } catch (error: any) {
      console.error('[Google Calendar] Error creating event:', error.message);
      return null;
    }
  }

  /**
   * Generates a downloadable / subscribable iCalendar (.ics) string for Claudia or customers.
   */
  static generateIcsContent(
    eventData: {
      summary: string;
      description: string;
      startTime: string;
      endTime: string;
      organizerEmail?: string;
      attendeeEmail?: string;
    }
  ): string {
    const formatDate = (iso: string) => {
      return new Date(iso)
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}/, '');
    };

    const start = formatDate(eventData.startTime);
    const end = formatDate(eventData.endTime);
    const now = formatDate(new Date().toISOString());

    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Lumina Umay//Tarot Appointments//ES',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${now}-lumina-${Math.random().toString(36).substring(2, 9)}@luminaumay.com`,
      `DTSTAMP:${now}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${eventData.summary}`,
      `DESCRIPTION:${eventData.description.replace(/\n/g, '\\n')}`,
      `ORGANIZER;CN=Claudia Lumina Umay:mailto:${eventData.organizerEmail || config.claudiaNotificationEmail}`,
      eventData.attendeeEmail ? `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT:mailto:${eventData.attendeeEmail}` : '',
      'STATUS:CONFIRMED',
      'BEGIN:VALARM',
      'TRIGGER:-PT60M',
      'ACTION:DISPLAY',
      'DESCRIPTION:Recordatorio de Sesión de Tarot en 1 hora',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ]
      .filter(Boolean)
      .join('\r\n');
  }
}
