/**
 * LUMINA UMAY — CLIENT CONTROLLER
 * Fullstack Tarot Booking, Concurrency Soft-Locking & Mercado Pago State Engine
 */

// --- Tier Metadata & Pricing Definitions ---
const TIER_METADATA = {
  '1_carta': {
    name: 'Lectura de 1 Carta',
    price: 150,
    isCall: false,
    turnaround: '24 horas',
    description: 'Respuesta puntual a una pregunta concreta de Sí o No.'
  },
  '3_cartas': {
    name: 'Lectura de 3 Cartas',
    price: 350,
    isCall: false,
    turnaround: '24 horas',
    description: 'Panorama general: pasado, presente y consejo del oráculo.'
  },
  '5_cartas': {
    name: 'Lectura de 5 Cartas',
    price: 500,
    isCall: false,
    turnaround: '24 horas',
    description: 'Tirada profunda: bloqueos, influencias y mejor desenlace.'
  },
  'llamada': {
    name: 'Sesión por Llamada',
    price: 450,
    isCall: true,
    turnaround: 'Sesión en vivo (45 min)',
    description: '45 minutos en vivo 1 a 1 con Claudia.'
  }
};

const VALID_CATEGORIES = ['Amor', 'Trabajo/Dinero', 'Familia', 'Otro'];

window.TIER_METADATA = TIER_METADATA;
window.VALID_CATEGORIES = VALID_CATEGORIES;

// Global App State
const state = {
  activeScreen: 'screen-inicio',
  selectedTier: '1_carta',
  selectedSlotId: null,
  lockToken: null,
  lockExpiresAt: null,
  slots: [],
  isSubmitting: false,
  pollTimer: null
};

// ── NAVIGATION CONTROLLER ──
function navigateTo(screenId) {
  const screens = document.querySelectorAll('.screen');
  screens.forEach(s => s.classList.remove('active'));

  const target = document.getElementById(screenId);
  if (target) {
    target.classList.add('active');
    state.activeScreen = screenId;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Update Navbar Active State
  const navBtns = document.querySelectorAll('.nav-btn');
  navBtns.forEach(b => b.classList.remove('active'));

  if (screenId === 'screen-inicio') document.getElementById('nav-inicio')?.classList.add('active');
  else if (screenId === 'screen-lectura') document.getElementById('nav-lectura')?.classList.add('active');
  else if (screenId === 'screen-sesion') {
    document.getElementById('nav-sesion')?.classList.add('active');
    loadSlots();
  }
  else if (screenId === 'screen-sobre') document.getElementById('nav-sobre')?.classList.add('active');
}
window.navigateTo = navigateTo;

// ── TIER SELECTOR (1, 3, 5 CARTAS) ──
function selectTier(tierId) {
  if (!TIER_METADATA[tierId]) return;
  state.selectedTier = tierId;

  // Update hidden tier input
  const tierInput = document.getElementById('tier_id_input');
  if (tierInput) tierInput.value = tierId;

  // Update Tabs
  document.querySelectorAll('.tier-tab').forEach(tab => {
    tab.classList.remove('active');
    tab.setAttribute('aria-selected', 'false');
  });
  const activeTab = document.getElementById(`tab-${tierId}`);
  if (activeTab) {
    activeTab.classList.add('active');
    activeTab.setAttribute('aria-selected', 'true');
  }

  // Update Price Badge & Button
  const price = TIER_METADATA[tierId].price;
  const badge = document.getElementById('lectura-price-badge');
  const btnLabel = document.getElementById('btn-price-label');
  if (badge) badge.textContent = `$${price} MXN`;
  if (btnLabel) btnLabel.textContent = `$${price} MXN`;

  // Toggle Dynamic Fields
  const fieldInvolved = document.getElementById('field-involved-names');
  const fieldCore = document.getElementById('field-core-focus');
  const inputCore = document.getElementById('core_focus');

  if (tierId === '1_carta') {
    if (fieldInvolved) fieldInvolved.classList.add('hidden');
    if (fieldCore) fieldCore.classList.add('hidden');
    if (inputCore) inputCore.removeAttribute('required');
  } else if (tierId === '3_cartas') {
    if (fieldInvolved) fieldInvolved.classList.remove('hidden');
    if (fieldCore) fieldCore.classList.add('hidden');
    if (inputCore) inputCore.removeAttribute('required');
  } else if (tierId === '5_cartas') {
    if (fieldInvolved) fieldInvolved.classList.remove('hidden');
    if (fieldCore) fieldCore.classList.remove('hidden');
    if (inputCore) inputCore.setAttribute('required', 'true');
  }
}
window.selectTier = selectTier;

// ── SLOTS & CONCURRENCY ENGINE ──
async function loadSlots() {
  const container = document.getElementById('slots-container');
  const grid = document.getElementById('slots-grid');
  if (!container || !grid) return;

  grid.innerHTML = '<div class="slots-loading"><span class="spinner"></span><span>Consultando horarios disponibles...</span></div>';

  try {
    const res = await fetch('/api/slots');
    const data = await res.json();

    if (!data.success || !Array.isArray(data.slots) || data.slots.length === 0) {
      grid.innerHTML = '<div class="slots-empty">No hay horarios disponibles por el momento. Claudia abrirá nuevos espacios pronto.</div>';
      return;
    }

    state.slots = data.slots;
    renderSlots(data.slots);
  } catch (err) {
    grid.innerHTML = '<div class="slots-empty">No fue posible cargar los horarios. Por favor intenta nuevamente.</div>';
  }
}
window.loadSlots = loadSlots;

function renderSlots(slots) {
  const grid = document.getElementById('slots-grid');
  if (!grid) return;

  grid.innerHTML = '';
  slots.forEach(slot => {
    const chip = document.createElement('div');
    chip.className = `slot-chip ${state.selectedSlotId === slot.id ? 'selected' : ''}`;
    chip.id = `slot-chip-${slot.id}`;
    chip.tabIndex = 0;

    // CDMX formatting
    const slotDate = new Date(slot.start_time);
    const dateFormatted = slot.date || slotDate.toLocaleDateString('es-MX', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'America/Mexico_City'
    });

    const timeFormatted = slot.time_start || slotDate.toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/Mexico_City'
    });

    chip.innerHTML = `
      <div class="slot-date">${dateFormatted}</div>
      <div class="slot-time">${timeFormatted} hrs</div>
    `;

    chip.addEventListener('click', () => handleSlotSelect(slot.id));
    grid.appendChild(chip);
  });
}

function handleSlotSelection(slotId) {
  return handleSlotSelect(slotId);
}
window.handleSlotSelection = handleSlotSelection;

async function handleSlotSelect(slotId) {
  if (state.selectedSlotId === slotId) return;

  try {
    const res = await fetch(`/api/slots/${slotId}/lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      showToast(data.error || 'Este horario ya fue apartado por otra persona.');
      loadSlots();
      return;
    }

    // Lock granted
    state.selectedSlotId = slotId;
    state.lockToken = data.lock_token;
    state.lockExpiresAt = new Date(data.expires_at).getTime();

    const inputSlotId = document.getElementById('selected_slot_id');
    if (inputSlotId) inputSlotId.value = slotId;

    // Update UI chips
    document.querySelectorAll('.slot-chip').forEach(c => c.classList.remove('selected'));
    const chip = document.getElementById(`slot-chip-${slotId}`);
    if (chip) chip.classList.add('selected');

    // Show Lock Banner
    const banner = document.getElementById('slot-lock-banner');
    if (banner) banner.classList.remove('hidden');

  } catch (err) {
    showToast('Error al apartar horario temporalmente.');
  }
}

// ── FORM SUBMISSIONS & MERCADO PAGO CHECKOUT ──
async function handleLecturaSubmit(event) {
  if (event) event.preventDefault();
  if (state.isSubmitting) return;

  const name = document.getElementById('customer_name')?.value.trim();
  const email = document.getElementById('customer_email')?.value.trim();
  const phone = document.getElementById('customer_phone')?.value.trim() || undefined;
  const birthdate = document.getElementById('customer_birthdate')?.value;
  const category = document.getElementById('category')?.value;
  const question = document.getElementById('question')?.value.trim();
  const involvedNames = document.getElementById('involved_names')?.value.trim() || undefined;
  const coreFocus = document.getElementById('core_focus')?.value.trim() || undefined;

  if (!name || !email || !birthdate || !category || !question) {
    showToast('Por favor completa todos los campos requeridos.');
    return;
  }

  if (state.selectedTier === '5_cartas' && !coreFocus) {
    showToast('Para la lectura de 5 cartas es necesario indicar qué es lo que más deseas saber.');
    return;
  }

  const payload = {
    tier_id: state.selectedTier,
    customer_name: name,
    customer_email: email,
    customer_phone: phone,
    customer_birthdate: birthdate,
    category: category,
    question: question,
    involved_names: involvedNames,
    core_focus: coreFocus
  };

  await initiateCheckout(payload, document.getElementById('submit-btn'));
}
window.handleLecturaSubmit = handleLecturaSubmit;

async function handleLlamadaSubmit(event) {
  if (event) event.preventDefault();
  if (state.isSubmitting) return;

  const slotId = state.selectedSlotId || document.getElementById('selected_slot_id')?.value;
  const name = document.getElementById('call_customer_name')?.value.trim();
  const email = document.getElementById('call_customer_email')?.value.trim();
  const phone = document.getElementById('call_customer_phone')?.value.trim() || undefined;
  const birthdate = document.getElementById('call_customer_birthdate')?.value;
  const question = document.getElementById('call_question')?.value.trim();

  if (!slotId) {
    showToast('Por favor selecciona un horario disponible en el calendario.');
    return;
  }

  if (!name || !email || !birthdate || !question) {
    showToast('Por favor completa todos los datos de tu consulta.');
    return;
  }

  const payload = {
    tier_id: 'llamada',
    slot_id: slotId,
    lock_token: state.lockToken,
    customer_name: name,
    customer_email: email,
    customer_phone: phone,
    customer_birthdate: birthdate,
    question: question
  };

  await initiateCheckout(payload, document.getElementById('call-submit-btn'));
}
window.handleLlamadaSubmit = handleLlamadaSubmit;

async function initiateCheckout(payload, submitBtn) {
  state.isSubmitting = true;
  const originalText = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Generando enlace seguro...';
  }

  try {
    const res = await fetch('/api/checkout/create-preference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      showToast(data.error || 'Error al conectar con la pasarela de pagos.');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
      }
      state.isSubmitting = false;
      return;
    }

    // Redirect to Mercado Pago
    const redirectUrl = data.init_point || data.sandbox_init_point;
    if (redirectUrl) {
      window.location.href = redirectUrl;
    } else {
      showToast('Enlace de pago no disponible.');
      state.isSubmitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
      }
    }
  } catch (err) {
    showToast('Error de conexión al procesar la solicitud.');
    state.isSubmitting = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText;
    }
  }
}

// ── FAQ ACCORDION TOGGLE ──
function toggleFaq(element) {
  if (!element) return;
  const wasOpen = element.classList.contains('open');
  document.querySelectorAll('.faq-item').forEach(item => item.classList.remove('open'));
  if (!wasOpen) {
    element.classList.add('open');
  }
}
window.toggleFaq = toggleFaq;

// ── TOAST NOTIFICATIONS ──
function showToast(msg, duration = 4000) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => {
    if (toast) toast.classList.remove('show');
  }, duration);
}
window.showToast = showToast;

// ── POST-PAYMENT POLLING & CONFIRMATION MODAL ──
function checkForRedirectOrder() {
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get('order_id') || params.get('external_reference');

  if (orderId) {
    startOrderPolling(orderId);
  }
}

function startOrderPolling(orderId) {
  const modal = document.getElementById('confirmation-modal');
  const statePolling = document.getElementById('confirmation-polling');
  const stateAsync = document.getElementById('confirmation-success-async');
  const stateCall = document.getElementById('confirmation-success-call');
  const stateOverbooked = document.getElementById('confirmation-overbooked');

  if (modal) modal.classList.remove('hidden');
  if (statePolling) statePolling.classList.remove('hidden');
  if (stateAsync) stateAsync.classList.add('hidden');
  if (stateCall) stateCall.classList.add('hidden');
  if (stateOverbooked) stateOverbooked.classList.add('hidden');

  let attempts = 0;
  const maxAttempts = 30; // ~60 seconds

  state.pollTimer = setInterval(async () => {
    attempts++;
    try {
      const res = await fetch(`/api/orders/${orderId}/status`);
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'approved') {
          clearInterval(state.pollTimer);
          if (statePolling) statePolling.classList.add('hidden');

          if (data.tier_id === 'llamada') {
            if (stateCall) {
              stateCall.classList.remove('hidden');
              const orderIdEl = document.getElementById('call-order-id');
              if (orderIdEl) orderIdEl.textContent = `#${data.order_id || orderId}`;
              if (data.slot) {
                const dateEl = document.getElementById('call-slot-date');
                const timeEl = document.getElementById('call-slot-time');
                if (dateEl) dateEl.textContent = data.slot.date || 'Confirmada';
                if (timeEl) timeEl.textContent = data.slot.time_start ? `${data.slot.time_start} hrs` : 'Horario apartado';
              }
            }
          } else {
            if (stateAsync) {
              stateAsync.classList.remove('hidden');
              const orderIdEl = document.getElementById('async-order-id');
              const emailEl = document.getElementById('async-customer-email');
              if (orderIdEl) orderIdEl.textContent = `#${data.order_id || orderId}`;
              if (emailEl) emailEl.textContent = data.customer_email || 'tu correo';
            }
          }
          return;
        } else if (data.status === 'OVERBOOKED_NEEDS_RESCHEDULING') {
          clearInterval(state.pollTimer);
          if (statePolling) statePolling.classList.add('hidden');
          if (stateOverbooked) stateOverbooked.classList.remove('hidden');
          return;
        }
      }
    } catch (e) {
      // Keep polling
    }

    if (attempts >= maxAttempts) {
      clearInterval(state.pollTimer);
      if (statePolling) {
        statePolling.innerHTML = `
          <div class="modal-icon-badge">⏳</div>
          <h2 class="modal-title">Pago en Proceso</h2>
          <p class="modal-subtitle">Tu comprobante está siendo procesado por Mercado Pago. Te notificaremos a tu correo en cuanto se complete la confirmación.</p>
          <button type="button" class="confirm-back" id="btn-polling-timeout-back">Volver al Inicio</button>
        `;
        document.getElementById('btn-polling-timeout-back')?.addEventListener('click', closeModalAndGoHome);
      }
    }
  }, 2000);
}

function closeModalAndGoHome() {
  const modal = document.getElementById('confirmation-modal');
  if (modal) modal.classList.add('hidden');
  window.history.replaceState({}, document.title, window.location.pathname);
  navigateTo('screen-inicio');
}
window.closeModalAndGoHome = closeModalAndGoHome;

// ── INITIALIZE EVENT LISTENERS (UNOBTRUSIVE JS) ──
document.addEventListener('DOMContentLoaded', () => {
  // Service Cards on Inicio
  document.getElementById('btn-goto-lectura')?.addEventListener('click', () => navigateTo('screen-lectura'));
  document.getElementById('btn-goto-sesion')?.addEventListener('click', () => navigateTo('screen-sesion'));

  // Back Buttons
  document.getElementById('btn-back-lectura')?.addEventListener('click', () => navigateTo('screen-inicio'));
  document.getElementById('btn-back-sesion')?.addEventListener('click', () => navigateTo('screen-inicio'));

  // Navbar Buttons
  document.getElementById('nav-inicio')?.addEventListener('click', () => navigateTo('screen-inicio'));
  document.getElementById('nav-lectura')?.addEventListener('click', () => navigateTo('screen-lectura'));
  document.getElementById('nav-sesion')?.addEventListener('click', () => navigateTo('screen-sesion'));
  document.getElementById('nav-sobre')?.addEventListener('click', () => navigateTo('screen-sobre'));

  // Tier Selector Tabs
  document.querySelectorAll('.tier-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tier = tab.getAttribute('data-tier');
      if (tier) selectTier(tier);
    });
  });

  // Booking Forms
  document.getElementById('booking-form')?.addEventListener('submit', handleLecturaSubmit);
  document.getElementById('form-llamada')?.addEventListener('submit', handleLlamadaSubmit);

  // FAQ Accordion Items
  document.querySelectorAll('.faq-item').forEach(item => {
    item.addEventListener('click', () => toggleFaq(item));
  });

  // Modal Close Buttons
  document.getElementById('btn-close-modal-async')?.addEventListener('click', closeModalAndGoHome);
  document.getElementById('btn-close-modal-call')?.addEventListener('click', closeModalAndGoHome);
  document.getElementById('btn-close-modal-overbooked')?.addEventListener('click', closeModalAndGoHome);

  // Check URL params for order redirect
  checkForRedirectOrder();
});
