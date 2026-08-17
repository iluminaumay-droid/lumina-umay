# UI/UX & Mexican Spanish Content Exploration Report: Lumina Umay Booking System

## 1. Observation

Direct observations extracted from project source files:

1. **Brand & Visual System Requirements** (`c:/LUMINAPROJECT/ORIGINAL_REQUEST.md`, lines 24-26):
   > "Preserve the exact visual design, color tokens (`--teal`, `--teal-deep`, `--gold`, `--cream`), Cormorant Garamond / Jost typography, and mobile-app shell experience from the original HTML. Replace the WhatsApp CTA with an interactive Mexican Spanish FAQ accordion."
2. **Site Language & Tone** (`c:/LUMINAPROJECT/lumina-umay-booking-system-spec-v2.md`, line 10):
   > "Site language: **Mexican Spanish** throughout (all copy, labels, buttons, confirmation messages, FAQ, emails)."
3. **Pricing & Product Tier Definitions** (`c:/LUMINAPROJECT/lumina-umay-booking-system-spec-v2.md`, lines 22-43):
   > - **Category A — Lecturas de cartas (mensaje, sin llamada)**:
   >   - 1 carta: $150 MXN (Solo preguntas de sí o no) -> Fields: Nombre, Fecha de nacimiento, Pregunta, Categoría.
   >   - 3 cartas: $350 MXN (Pregunta o situación general) -> Fields: Nombre, Fecha de nacimiento, Pregunta/Situación, Nombre de la persona involucrada (si aplica), Categoría.
   >   - 5 cartas: $500 MXN (Pregunta o situación más profunda) -> Fields: Nombre, Fecha de nacimiento, Pregunta/Situación, Nombre de la(s) persona(s) involucrada(s) (si aplica), Qué es lo que más deseas saber, Categoría.
   >   - Required category options: Amor, Trabajo/Dinero, Familia, Otro.
   > - **Category B — Sesión por llamada**:
   >   - Live call ($450 MXN), requires selecting an available time slot with concurrency control.
4. **Turnaround & Delivery Guarantees** (`c:/LUMINAPROJECT/lumina-umay-booking-system-spec-v2.md`, lines 23, 51):
   > "Guarantee: response within 24 hours."
   > "Customer sees a confirmation screen: for card readings, a 'responderemos en 24 horas' message; for calls, their confirmed date/time"
5. **CTA Transition & FAQ Specification** (`c:/LUMINAPROJECT/lumina-umay-booking-system-spec-v2.md`, lines 13-14, 64-71):
   > "- Remove: the WhatsApp contact link/CTA at the end of the flow (the official WhatsApp number isn't ready yet)"
   > "- Add: a standard FAQ section in its place"
   > "Suggested starting questions: ¿Cómo recibo mi lectura?, ¿Cuánto tarda en llegar la respuesta?, ¿Qué pasa si no puedo asistir a mi llamada agendada?, ¿Los pagos son seguros?, ¿Puedo cambiar mi pregunta después de pagar?"
6. **Payment & Confirmation Lifecycle** (`c:/LUMINAPROJECT/lumina-umay-booking-system-spec-v2.md`, lines 48-51, 55-57):
   > "Only after payment is confirmed does the order/booking get created — nothing is accepted or scheduled on unpaid submissions"
   > "Do not trust the frontend 'payment successful' redirect alone... only trigger confirmation email + slot-lock after webhook confirms `approved` status."

---

## 2. Logic Chain

1. **Visual Token & Typography System Architecture**:
   - Based on Observation 1, the design system must strictly preserve the sacred, mystical, and grounded aesthetic of Lumina Umay.
   - The primary palette consists of deep abyssal teals (`--teal-deep: #081d1c`, `--teal: #0d2b2a`, `--teal-card: #133938`, `--teal-border: #1d4d4b`), warm radiant gold accents (`--gold: #d4af37`, `--gold-light: #f3e5ab`, `--gold-glow: rgba(212, 175, 55, 0.35)`), and soft antique cream for typography (`--cream: #fbf8f2`, `--cream-muted: #dcd3c1`).
   - Headings, hero banners, and tarot titles must utilize `Cormorant Garamond` (serif) with appropriate letter-spacing (`tracking-wide`) to convey ancient wisdom and editorial elegance. Form inputs, buttons, slot chips, and body copy must utilize `Jost` (sans-serif) for sharp legibility on mobile screens.

2. **Mobile-App Shell Architecture**:
   - Based on Observation 1, the application must feel like an exquisite native mobile web app.
   - The layout is constrained to a max-width container (`max-w-md` ~ 480px–500px), centered horizontally on larger displays with an ambient atmospheric background blur/radial gradient.
   - The navigation structure follows a cohesive, friction-free 3-step funnel:
     - **Step 1: Selección de Servicio (Category & Tier Tabs)**
     - **Step 2: Detalles & Personalización (+ Selección de Horario para Llamadas)**
     - **Step 3: Pago Seguro & Confirmación de Orden**
   - High visual hierarchy with animated micro-transitions (fade-in, slide-up) when changing tiers or toggling accordions.

3. **Tier-Specific Dynamic Form Validation**:
   - Based on Observation 3, the form must adapt dynamically without page reloads:
     - Selecting **1 Carta ($150 MXN)**: Renders `Nombre completo`, `Fecha de nacimiento`, `Categoría` (Amor, Trabajo/Dinero, Familia, Otro), and `Pregunta concreta (Sí/No)` + `Email` + `WhatsApp/Teléfono`.
     - Selecting **3 Cartas ($350 MXN)**: Dynamically injects `Nombre de la persona involucrada (opcional / si aplica)` and updates the question label to `Pregunta o situación general`.
     - Selecting **5 Cartas ($500 MXN)**: Dynamically injects `Nombre(s) de persona(s) involucrada(s)` and `¿Qué es lo que más deseas saber / descubrir? (Enfoque prioritario)`.
     - Selecting **Sesión por llamada ($450 MXN)**: Activates the interactive date/time calendar picker alongside `Nombre`, `Fecha de nacimiento`, `Categoría`, `Tema principal de la sesión`, `Email`, and `WhatsApp`.
   - Real-time client-side validation gives friendly, immediate Mexican Spanish feedback before Mercado Pago checkout initiation.

4. **Interactive Slot Selection UI (Category B)**:
   - Based on Observation 3 & 6, Category B requires live slot rendering:
     - Date Selector (horizontal date pills / calendar carousel showing the next 14 available days).
     - Slot Grid (pill buttons formatted in CDMX time, e.g. "10:00 AM", "11:30 AM", "04:00 PM").
     - Visual states:
       - `Disponible` (teal-card with gold hover glow)
       - `Seleccionado` (solid gold background with dark teal text, pulsing ring)
       - `Bloqueado temporalmente` (disabled, subtle opacity, badge: "En proceso")
       - `Ocupado` (filtered out or disabled strikethrough)
     - Soft-lock UX: When clicking "Proceder al Pago", a subtle 10-minute hold banner alerts the user: *"Tu horario está reservado por 10:00 minutos mientras completas tu pago."*

5. **Interactive Mexican Spanish FAQ Accordion**:
   - Based on Observation 2 & 5, replacing the WhatsApp CTA requires a dedicated accordion section (`<details>` / smooth animated container) addressing all trust, turnaround, logistics, and confidentiality questions in warm, respectful Mexican Spanish.
   - Accordion features smooth height animation, SVG chevron rotation, and accessible keyboard toggle (`Enter`/`Space`).

6. **Confirmation & Turnaround Screens**:
   - Based on Observation 4 & 6, the confirmation screen dynamically branches based on the purchase tier:
     - **Async Card Readings (1, 3, 5 Cartas)**: Prominently highlights the 24-hour turnaround pledge: *"⏰ Tu lectura llegará a tu correo en menos de 24 horas"*, summarizing the captured question and client details.
     - **Live Call Sessions ($450 MXN)**: Prominently displays the confirmed Date, Time (CDMX), Google Meet / Call link placeholder, and "Agregar a mi calendario" action.
     - Both screens provide an Order Reference ID (e.g. `#LUM-84920`) and payment verification badge.

---

## 3. Caveats

1. **WhatsApp Contact Absence**: Per spec line 13, the official WhatsApp number is not yet active, so direct WhatsApp redirect buttons are omitted. However, collecting the customer's phone number/WhatsApp during checkout is retained so Claudia can deliver readings via WhatsApp or email once active.
2. **Email Server Dependency**: Claudia's production email credentials (SMTP / Resend API key) may be configured with fallback/test mode during initial staging, but frontend UI displays seamless transactional receipt messaging.
3. **Time Zone Standard**: Call slots are displayed in Mexico City Central Time (CST / UTC-6) with clear UI labeling to avoid confusion for users in Northwest or international time zones.

---

## 4. Conclusion & Complete Design Specification

### 4.1. Design Tokens (CSS Variables)

```css
:root {
  /* Core Backgrounds */
  --teal-deep: #081d1c;
  --teal: #0d2b2a;
  --teal-card: #133938;
  --teal-card-hover: #194846;
  --teal-border: #1d4d4b;
  --teal-input: #0a2221;
  --teal-glow: rgba(13, 43, 42, 0.85);

  /* Gold Accents & Highlights */
  --gold: #d4af37;
  --gold-light: #f3e5ab;
  --gold-dark: #aa8c2c;
  --gold-muted: rgba(212, 175, 55, 0.18);
  --gold-border: rgba(212, 175, 55, 0.4);
  --gold-glow: rgba(212, 175, 55, 0.35);

  /* Typography & Neutral Shades */
  --cream: #fbf8f2;
  --cream-muted: #dcd3c1;
  --cream-subtle: #9fa8a3;
  --white: #ffffff;

  /* Status Colors */
  --error: #ef5350;
  --error-bg: rgba(239, 83, 80, 0.12);
  --error-border: rgba(239, 83, 80, 0.4);
  --success: #66bb6a;
  --success-bg: rgba(102, 187, 106, 0.12);
  --success-border: rgba(102, 187, 106, 0.4);
  --pending: #ffa726;
  --pending-bg: rgba(255, 167, 38, 0.12);

  /* Fonts */
  --font-serif: 'Cormorant Garamond', Georgia, serif;
  --font-sans: 'Jost', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;

  /* Radii & Shadows */
  --radius-sm: 8px;
  --radius-md: 14px;
  --radius-lg: 20px;
  --radius-full: 9999px;
  --shadow-card: 0 10px 30px -5px rgba(0, 0, 0, 0.5), 0 0 20px rgba(212, 175, 55, 0.08);
  --shadow-gold: 0 4px 20px rgba(212, 175, 55, 0.3);
  --shadow-input: inset 0 2px 4px rgba(0, 0, 0, 0.3);

  /* Transitions */
  --transition-fast: 0.18s cubic-bezier(0.4, 0, 0.2, 1);
  --transition-normal: 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}
```

---

### 4.2. Mobile-App Shell Wireframe & Structure

```
+-------------------------------------------------------------+
|                      HEADER / BRAND                         |
|   ✨ LUMINA UMAY ✨                                         |
|   Tarot Terapéutico & Guía Espiritual                       |
+-------------------------------------------------------------+
|               CATEGORY SELECTOR TABS                        |
|   [ 🃏 Lectura de Cartas ]      [ 📞 Sesión en Vivo ]       |
+-------------------------------------------------------------+
|                 TIER CARDS (CATEGORY A)                     |
|  +--------------------+ +--------------------+ +----------+ |
|  | 1 CARTA ($150 MXN) | | 3 CARTAS ($350 MXN)| | 5 CARTAS | |
|  | Sí o No Concreto   | | Panorama General   | | Profunda | |
|  | (Seleccionada)     | |                    | |          | |
|  +--------------------+ +--------------------+ +----------+ |
+-------------------------------------------------------------+
|                 DYNAMIC CONSULTATION FORM                   |
|  * Tu Nombre Completo: [                         ]          |
|  * Fecha de Nacimiento: [ YYYY - MM - DD         ]          |
|  * Área de Consulta: [ ▼ Amor / Trabajo / ...    ]          |
|  * [Si 3 o 5 cartas] Nombre persona involucrada: [        ] |
|  * [Si 5 cartas] ¿Qué es lo que más deseas saber?: [      ] |
|  * Tu Pregunta o Situación:                                 |
|    [ Escribe aquí con claridad y apertura...     ]          |
|  * Correo Electrónico (para recibir tu lectura):            |
|    [ tu@correo.com                               ]          |
|  * WhatsApp / Teléfono: [ +52 ...                ]          |
+-------------------------------------------------------------+
|  [CATEGORY B ONLY] INTERACTIVE SLOT PICKER                  |
|  Selecciona tu Día: [ Hoy 16 ] [ Lun 17 ] [ Mar 18 ] ...    |
|  Horarios disponibles (CDMX):                               |
|  [ 10:00 AM ] [ 11:30 AM ] [ 04:00 PM ] [ 05:30 PM ]        |
+-------------------------------------------------------------+
|                     ORDER SUMMARY & CTA                     |
|  Total: $150 MXN  •  Garantía de entrega en 24h             |
|  [ 💳 Continuar al Pago Seguro con Mercado Pago ]           |
|  🔒 Pago protegido con cifrado SSL bancario                |
+-------------------------------------------------------------+
|               PREGUNTAS FRECUENTES (FAQ)                    |
|  ▶ ¿Cómo y cuándo recibo mi lectura?                        |
|  ▶ ¿Cómo funciona la sesión por llamada?                    |
|  ▶ ¿Qué pasa si no puedo asistir a mi llamada agendada?     |
|  ▶ ¿Los pagos son seguros?                                  |
|  ▶ ¿Puedo cambiar mi pregunta después de pagar?             |
|  ▶ ¿Qué tipo de preguntas puedo consultar?                  |
|  ▶ ¿Mis datos y consultas son confidenciales?               |
+-------------------------------------------------------------+
|                       FOOTER                                |
|  © 2026 Lumina Umay. Todos los derechos reservados.         |
|  Lecturas canalizadas con respeto y consciencia espiritual. |
+-------------------------------------------------------------+
```

---

### 4.3. Dynamic Form Field Specifications & Validation Logic

| Field Name | Type | Required | Condition / Tier | Placeholder / Options | Mexican Spanish Validation Message |
|---|---|---|---|---|---|
| `customer_name` | Text | Yes | All Tiers | "Ej. María Elena Garza" | "Por favor ingresa tu nombre completo." |
| `birth_date` | Date | Yes | All Tiers | YYYY-MM-DD | "Selecciona tu fecha de nacimiento." |
| `category` | Select | Yes | All Tiers | `amor`, `trabajo_dinero`, `familia`, `otro` | "Por favor selecciona el área de tu consulta." |
| `question` | Textarea | Yes | All Tiers | 1 carta: "¿Conseguiré el nuevo empleo este mes?"<br>3/5 cartas: "Explica la situación que deseas consultar..." | "Por favor escribe tu pregunta o situación." |
| `related_name` | Text | No | 3 cartas, 5 cartas | "Nombre de la persona (opcional)" | N/A (Opcional) |
| `deep_focus` | Textarea | Yes | 5 cartas only | "¿Qué aspecto o revelación buscas profundizar?" | "Por favor detalla qué es lo que más deseas descubrir." |
| `email` | Email | Yes | All Tiers | "maria@ejemplo.com" | "Ingresa un correo electrónico válido para enviarte tu lectura." |
| `phone` | Tel | Yes | All Tiers | "Ej. 55 1234 5678" | "Ingresa un número de teléfono o WhatsApp válido." |
| `slot_id` | Hidden/Radio | Yes | Category B only | Slot UUID (Date + Time) | "Por favor selecciona un horario para tu sesión en vivo." |

---

### 4.4. Complete Mexican Spanish Copywriting

#### A. Hero & Header Copy
- **Logo Title**: `Lumina Umay`
- **Subtitle**: `Tarot Terapéutico & Guía Espiritual`
- **Hero Tagline**: `Espacio sagrado para encontrar claridad, dirección y paz interior a través de la sabiduría del tarot.`

#### B. Tier Selection Cards Copy
1. **1 Carta — $150 MXN**
   - *Título*: `1 Carta: Claridad Directa`
   - *Subtítulo*: `Preguntas concretas de Sí o No`
   - *Descripción*: `Ideal para dudas puntuales, decisiones inmediatas o una respuesta certera y concisa a una situación específica.`
   - *Tiempo de entrega*: `Entrega en menos de 24 horas por mensaje/correo`

2. **3 Cartas — $350 MXN**
   - *Título*: `3 Cartas: Panorama Integral`
   - *Subtítulo*: `Pasado, Presente y Porvenir`
   - *Descripción*: `Tirada dinámica para entender el origen de una situación, la energía presente y la tendencia hacia donde se dirige tu camino.`
   - *Tiempo de entrega*: `Entrega en menos de 24 horas con audio explicativo`

3. **5 Cartas — $500 MXN**
   - *Título*: `5 Cartas: Inmersión Profunda`
   - *Subtítulo*: `Análisis Completo y Consejo Espiritual`
   - *Descripción*: `La lectura más completa: origen oculto, obstáculos, influencia de personas involucradas, consejo superior y desenlace.`
   - *Tiempo de entrega*: `Entrega en menos de 24 horas con audio y guía energética`

4. **Sesión por Llamada — $450 MXN**
   - *Título*: `Sesión en Vivo 1:1`
   - *Subtítulo*: `Videollamada o llamada personalizada (45–60 min)`
   - *Descripción*: `Un espacio íntimo y en tiempo real para profundizar en tus preguntas, realizar múltiples tiradas y dialogar directamente con Claudia.`
   - *Modalidad*: `Reserva de horario en vivo vía Google Meet / Llamada`

---

#### C. Mexican Spanish Interactive FAQ Accordion Content

1. **¿Cómo y cuándo recibo mi lectura de cartas?**
   > Para las lecturas de 1, 3 y 5 cartas, no necesitas agendar horario. Recibirás tu lectura interpretada detalladamente por Claudia directamente en tu correo electrónico (y WhatsApp de respaldo) en un plazo máximo de **24 horas** a partir de la confirmación de tu pago. Se incluye la fotografía en alta resolución de tus cartas y un mensaje de audio/texto con la canalización completa.

2. **¿Cómo funciona la sesión por llamada en vivo?**
   > Al elegir la sesión en vivo, podrás seleccionar en el calendario el día y la hora que mejor te acomoden (en horario del Centro de México). Una vez confirmado tu pago con Mercado Pago, recibirás inmediatamente un correo de confirmación con tu enlace exclusivo de videollamada y recordatorios previos a tu cita.

3. **¿Qué pasa si no puedo asistir a mi llamada agendada?**
   > Entendemos que surgen imprevistos. Puedes reagendar tu sesión sin ningún costo avisando con al menos **4 horas de anticipación** respondiendo a tu correo de confirmación. En caso de no avisar, se otorgará una tolerancia de 10 minutos al inicio de la llamada.

4. **¿Los pagos son seguros?**
   > Totalmente seguros. Todos los cobros se gestionan a través de la plataforma de **Mercado Pago** con cifrado SSL de nivel bancario. Puedes pagar de manera rápida y confiable con tarjeta de crédito, débito, transferencia directa SPEI o en efectivo en puntos autorizados como OXXO. En ningún momento almacenamos datos bancarios de tu tarjeta.

5. **¿Puedo cambiar mi pregunta después de pagar?**
   > En lecturas de cartas (1, 3 y 5 cartas), si Claudia aún no ha comenzado tu tirada, puedes enviar una actualización respondiendo a tu correo de confirmación a la brevedad. En sesiones en vivo, tendrás total libertad de plantear y ajustar tus dudas conforme fluye la conversación durante la llamada.

6. **¿Qué tipo de preguntas puedo hacer?**
   > Puedes consultar sobre decisiones de vida, relaciones afectivas, proyectos laborales, finanzas, dinámicas familiares y autoconocimiento espiritual. Por ética profesional, no realizamos diagnósticos médicos, consultas sobre temas legales graves ni juegos de azar.

7. **¿Mis datos e información son confidenciales?**
   > Absolutamente. Todo lo compartido —nombre, fecha de nacimiento, preguntas, fotografías y lecturas— permanece bajo estricta confidencialidad profesional y respeto espiritual. Jamás se comparte ninguna información con terceros.

---

### 4.5. Confirmation Screen Specifications

#### 1. Category A Confirmation View (1, 3, 5 Cartas)
```
+-------------------------------------------------------------+
|                     ✨ PAGO CONFIRMADO ✨                   |
|              ¡Tu lectura ha sido reservada con éxito!       |
|                                                             |
|   Número de Orden: #LUM-84920                               |
|   Servicio: Lectura de 3 Cartas ($350 MXN)                  |
|   Área: Amor & Relaciones                                   |
|   Correo de Entrega: maria@ejemplo.com                      |
+-------------------------------------------------------------+
|  ⏰ GARANTÍA DE ENTREGA EN 24 HORAS                         |
|  Claudia ha recibido tus datos y preparará tu espacio       |
|  sagrado para canalizar tu lectura. Recibirás la fotografía |
|  de tus cartas y el audio explicativo en tu correo dentro   |
|  de las próximas 24 horas.                                  |
+-------------------------------------------------------------+
|  [ 📄 Descargar Comprobante ]    [ 🏠 Volver al Inicio ]    |
+-------------------------------------------------------------+
```

#### 2. Category B Confirmation View (Sesión por Llamada)
```
+-------------------------------------------------------------+
|                     ✨ CITA CONFIRMADA ✨                   |
|              ¡Tu sesión en vivo está agendada!              |
|                                                             |
|   Número de Orden: #LUM-92144                               |
|   Servicio: Sesión en Vivo 1:1 ($450 MXN)                   |
|   Fecha: Jueves, 20 de Agosto de 2026                       |
|   Horario: 05:00 PM – 05:50 PM (Hora CDMX)                  |
|   Plataforma: Google Meet (Enlace enviado a tu correo)      |
+-------------------------------------------------------------+
|  📝 RECOMENDACIONES PARA TU SESIÓN                          |
|  • Conéctate 5 minutos antes desde un lugar tranquilo.      |
|  • Ten a la mano un vaso con agua y libreta para notas.     |
|  • Mantén tu mente abierta y receptiva a los mensajes.      |
+-------------------------------------------------------------+
|  [ 📅 Agregar a Google Calendar ]  [ 🏠 Volver al Inicio ]  |
+-------------------------------------------------------------+
```

---

## 5. Verification Method

To independently verify this design and copy specification:
1. **Design Token Conformance**: Inspect the CSS variables in the project styles to verify exact match with `--teal: #0d2b2a`, `--teal-deep: #081d1c`, `--gold: #d4af37`, `--cream: #fbf8f2`, Cormorant Garamond headings, and Jost body font.
2. **Form Tier Switching Logic**: Verify that selecting `1 carta` reveals only name, birthdate, category, question, email, and phone; selecting `3 cartas` adds `related_name`; selecting `5 cartas` adds `deep_focus`; selecting `call session` triggers the interactive slot calendar.
3. **Copy Authenticity Check**: Review all Mexican Spanish strings against the text provided in Section 4.4 to confirm natural Mexican phrasing (e.g. "comprobante", "reagendar", "en tiempo real", "Centro de México").
4. **FAQ Accordion Behavior**: Ensure all 7 FAQ items expand/collapse cleanly with keyboard accessibility and without any lingering WhatsApp CTA.
