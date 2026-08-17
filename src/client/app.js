/**
 * LUMINA UMAY — CLIENT APPLICATION CONTROLLER
 * Fullstack Tarot Booking, Concurrency Soft-Locking & Mercado Pago State Engine
 */

(function () {
  'use strict';

  // --- Tier Definitions & Pricing ---
  const TIER_METADATA = {
    '1_carta': {
      name: 'Lectura de 1 Carta',
      price: 150,
      isCall: false,
      questionLabel: 'Tu Pregunta o Consulta (Sí o No) *',
      questionPlaceholder: 'Ej. ¿Conseguiré el empleo al que apliqué este mes?',
      turnaroundText: '✨ Tu lectura personalizada será grabada y enviada a tu correo dentro de las próximas 24 horas hábiles.',
      btnText: 'Continuar al Pago Seguro ($150 MXN) 🔒'
    },
    '3_cartas': {
      name: 'Lectura de 3 Cartas',
      price: 350,
      isCall: false,
      questionLabel: 'Tu Pregunta o Situación General *',
      questionPlaceholder: 'Explica la situación, antecedentes o duda general que deseas consultar...',
      turnaroundText: '✨ Tu lectura personalizada será grabada y enviada a tu correo dentro de las próximas 24 horas hábiles.',
      btnText: 'Continuar al Pago Seguro ($350 MXN) 🔒'
    },
    '5_cartas': {
      name: 'Lectura de 5 Cartas',
      price: 500,
      isCall: false,
      questionLabel: 'Tu Situación o Consulta Detallada *',
      questionPlaceholder: 'Explica a detalle tu situación, contexto y los aspectos que deseas profundizar...',
      turnaroundText: '✨ Tu lectura personalizada será grabada y enviada a tu correo dentro de las próximas 24 horas hábiles.',
      btnText: 'Continuar al Pago Seguro ($500 MXN) 🔒'
    },
    'llamada': {
      name: 'Sesión en Vivo por Llamada',
      price: 450,
      isCall: true,
      questionLabel: 'Tema o Enfoque Principal para tu Llamada *',
      questionPlaceholder: 'Describe brevemente los temas o inquietudes que deseas abordar en vivo con Claudia...',
      turnaroundText: '📞 Sesión 1 a 1 de 45 minutos en vivo reservada en el horario seleccionado.',
      btnText: 'Continuar al Pago Seguro ($450 MXN) 🔒'
    }
  };

  // --- Runtime Application State ---
  const state = {
    selectedTier: '1_carta',
    selectedSlotId: null,
    lockToken: null,
    lockExpiresAt: null,
    lockTimerInterval: null,
    slots: [],
    groupedSlots: {},
    selectedDate: null,
    isSubmitting: false,
    pollInterval: null
  };

  // --- DOM Elements Cache ---
  const DOM = {
    form: document.getElementById('booking-form'),
    tierCards: document.querySelectorAll('.tier-card'),
    tierRadios: document.querySelectorAll('input[name="tier_id"]'),
    
    // Dynamic Form Groups
    fieldInvolvedNames: document.getElementById('field-involved-names'),
    fieldCoreFocus: document.getElementById('field-core-focus'),
    asyncSlaBanner: document.getElementById('async-sla-banner'),
    slotPickerSection: document.getElementById('slot-picker-section'),
    
    // Form Inputs
    categoryInput: document.getElementById('category'),
    nameInput: document.getElementById('customer_name'),
    emailInput: document.getElementById('customer_email'),
    phoneInput: document.getElementById('customer_phone'),
    birthdateInput: document.getElementById('customer_birthdate'),
    involvedNamesInput: document.getElementById('involved_names'),
    coreFocusInput: document.getElementById('core_focus'),
    questionInput: document.getElementById('question'),
    questionLabel: document.getElementById('question-label'),
    slotIdInput: document.getElementById('slot_id'),
    lockTokenInput: document.getElementById('lock_token'),
    
    // Slot Picker Components
    slotLockBanner: document.getElementById('slot-lock-banner'),
    slotLockTimerText: document.getElementById('slot-lock-timer-text'),
    btnReleaseLock: document.getElementById('btn-release-lock'),
    slotLoading: document.getElementById('slot-loading-spinner'),
    slotEmptyMsg: document.getElementById('slot-empty-msg'),
    slotDatesContainer: document.getElementById('slot-dates-container'),
    slotTimesGrid: document.getElementById('slot-times-grid'),
    
    // Summary & CTA
    summaryTierName: document.getElementById('summary-tier-name'),
    summaryPrice: document.getElementById('summary-price'),
    summaryTurnaround: document.getElementById('summary-turnaround'),
    submitBtn: document.getElementById('submit-btn'),
    submitBtnText: document.getElementById('submit-btn-text'),
    submitSpinner: document.getElementById('submit-spinner'),
    formErrorBanner: document.getElementById('form-error-banner'),
    formErrorText: document.getElementById('form-error-text'),

    // Confirmation Modal Elements
    confirmationModal: document.getElementById('confirmation-modal'),
    modalPolling: document.getElementById('confirmation-polling'),
    modalSuccessAsync: document.getElementById('confirmation-success-async'),
    modalSuccessCall: document.getElementById('confirmation-success-call'),
    modalOverbooked: document.getElementById('confirmation-overbooked'),
    
    // Async Modal Fields
    asyncOrderId: document.getElementById('async-order-id'),
    asyncCustomerEmail: document.getElementById('async-customer-email'),
    asyncTierName: document.getElementById('async-tier-name'),
    asyncCategoryName: document.getElementById('async-category-name'),
    asyncAmountPaid: document.getElementById('async-amount-paid'),
    asyncTurnaroundText: document.getElementById('async-turnaround-text'),
    btnCloseAsyncModal: document.getElementById('btn-close-async-modal'),

    // Call Modal Fields
    callOrderId: document.getElementById('call-order-id'),
    callSlotDate: document.getElementById('call-slot-date'),
    callSlotTime: document.getElementById('call-slot-time'),
    btnCloseCallModal: document.getElementById('btn-close-call-modal'),

    // Overbooked Modal Fields
    overbookedOrderId: document.getElementById('overbooked-order-id'),
    btnCloseOverbookedModal: document.getElementById('btn-close-overbooked-modal')
  };

  // --- Initialization ---
  function init() {
    bindEvents();
    checkUrlForPostPaymentConfirmation();
    applyTierSelection(state.selectedTier);
  }

  // --- Event Bindings ---
  function bindEvents() {
    // Tier Card Click and Radio Change
    DOM.tierCards.forEach((card) => {
      card.addEventListener('click', () => {
        const tier = card.getAttribute('data-tier');
        if (tier && tier !== state.selectedTier) {
          const radio = card.querySelector('input[type="radio"]');
          if (radio) radio.checked = true;
          handleTierSwitch(tier);
        }
      });

      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const tier = card.getAttribute('data-tier');
          if (tier && tier !== state.selectedTier) {
            const radio = card.querySelector('input[type="radio"]');
            if (radio) radio.checked = true;
            handleTierSwitch(tier);
          }
        }
      });
    });

    DOM.tierRadios.forEach((radio) => {
      radio.addEventListener('change', (e) => {
        handleTierSwitch(e.target.value);
      });
    });

    // Form Submission
    DOM.form.addEventListener('submit', handleFormSubmit);

    // Release Lock Button
    if (DOM.btnReleaseLock) {
      DOM.btnReleaseLock.addEventListener('click', () => {
        if (state.selectedSlotId && state.lockToken) {
          releaseCurrentSlotLock(state.selectedSlotId, state.lockToken);
        }
        clearSlotLockState();
        fetchAvailableSlots();
      });
    }

    // Modal Close Buttons
    const closeButtons = [
      DOM.btnCloseAsyncModal,
      DOM.btnCloseCallModal,
      DOM.btnCloseOverbookedModal
    ];

    closeButtons.forEach((btn) => {
      if (btn) {
        btn.addEventListener('click', closeModalAndClearParams);
      }
    });

    // Real-time input error removal on typing
    const allInputs = [
      DOM.categoryInput,
      DOM.nameInput,
      DOM.emailInput,
      DOM.phoneInput,
      DOM.birthdateInput,
      DOM.involvedNamesInput,
      DOM.coreFocusInput,
      DOM.questionInput
    ];

    allInputs.forEach((input) => {
      if (input) {
        input.addEventListener('input', () => {
          input.classList.remove('input-error');
          const errEl = document.getElementById(`${input.id}-error`);
          if (errEl) errEl.classList.add('hidden');
          hideGlobalError();
        });
        input.addEventListener('change', () => {
          input.classList.remove('input-error');
          const errEl = document.getElementById(`${input.id}-error`);
          if (errEl) errEl.classList.add('hidden');
          hideGlobalError();
        });
      }
    });
  }

  // --- Tier Switching Controller ---
  function handleTierSwitch(newTier) {
    if (!TIER_METADATA[newTier]) return;

    // If switching away from live call while holding a soft-lock, release it immediately
    if (state.selectedTier === 'llamada' && newTier !== 'llamada') {
      if (state.selectedSlotId && state.lockToken) {
        releaseCurrentSlotLock(state.selectedSlotId, state.lockToken);
        clearSlotLockState();
      }
    }

    state.selectedTier = newTier;
    applyTierSelection(newTier);

    if (newTier === 'llamada') {
      fetchAvailableSlots();
    }
  }

  function applyTierSelection(tier) {
    const meta = TIER_METADATA[tier] || TIER_METADATA['1_carta'];

    // Update active tier card classes and ARIA radio states
    DOM.tierCards.forEach((card) => {
      const cardTier = card.getAttribute('data-tier');
      const isSelected = cardTier === tier;
      if (isSelected) {
        card.classList.add('active');
        card.setAttribute('aria-checked', 'true');
      } else {
        card.classList.remove('active');
        card.setAttribute('aria-checked', 'false');
      }
    });

    // Toggle Dynamic Form Fields
    if (tier === '1_carta') {
      DOM.fieldInvolvedNames.classList.add('hidden');
      DOM.fieldCoreFocus.classList.add('hidden');
      DOM.asyncSlaBanner.classList.remove('hidden');
      DOM.slotPickerSection.classList.add('hidden');
    } else if (tier === '3_cartas') {
      DOM.fieldInvolvedNames.classList.remove('hidden');
      DOM.fieldCoreFocus.classList.add('hidden');
      DOM.asyncSlaBanner.classList.remove('hidden');
      DOM.slotPickerSection.classList.add('hidden');
    } else if (tier === '5_cartas') {
      DOM.fieldInvolvedNames.classList.remove('hidden');
      DOM.fieldCoreFocus.classList.remove('hidden');
      DOM.asyncSlaBanner.classList.remove('hidden');
      DOM.slotPickerSection.classList.add('hidden');
    } else if (tier === 'llamada') {
      DOM.fieldInvolvedNames.classList.add('hidden');
      DOM.fieldCoreFocus.classList.add('hidden');
      DOM.asyncSlaBanner.classList.add('hidden');
      DOM.slotPickerSection.classList.remove('hidden');
    }

    // Update labels and placeholders
    DOM.questionLabel.textContent = meta.questionLabel;
    DOM.questionInput.placeholder = meta.questionPlaceholder;

    // Update Summary Card
    DOM.summaryTierName.textContent = meta.name;
    DOM.summaryPrice.textContent = `$${meta.price} MXN`;
    DOM.summaryTurnaround.textContent = meta.turnaroundText;

    // Update Submit CTA Button
    DOM.submitBtnText.textContent = meta.btnText;
  }

  // --- Slot Calendar & Soft-Locking Controller ---
  async function fetchAvailableSlots() {
    DOM.slotLoading.classList.remove('hidden');
    DOM.slotEmptyMsg.classList.add('hidden');
    DOM.slotDatesContainer.innerHTML = '';
    DOM.slotTimesGrid.innerHTML = '';

    try {
      const response = await fetch('/api/slots');
      const data = await response.json();

      DOM.slotLoading.classList.add('hidden');

      if (!response.ok || !data.success || !data.slots || data.slots.length === 0) {
        DOM.slotEmptyMsg.classList.remove('hidden');
        return;
      }

      state.slots = data.slots;
      state.groupedSlots = {};

      // Group available slots by date
      data.slots.forEach((slot) => {
        const d = slot.date || (slot.start_time ? slot.start_time.slice(0, 10) : '2026-08-20');
        if (!state.groupedSlots[d]) {
          state.groupedSlots[d] = [];
        }
        state.groupedSlots[d].push(slot);
      });

      const dates = Object.keys(state.groupedSlots).sort();
      if (dates.length === 0) {
        DOM.slotEmptyMsg.classList.remove('hidden');
        return;
      }

      // Default to first available date or keep selected if still present
      if (!state.selectedDate || !state.groupedSlots[state.selectedDate]) {
        state.selectedDate = dates[0];
      }

      renderDatePills(dates);
      renderTimeSlots(state.selectedDate);
    } catch (err) {
      DOM.slotLoading.classList.add('hidden');
      DOM.slotEmptyMsg.textContent = 'Ocurrió un error al cargar los horarios disponibles. Por favor intenta de nuevo.';
      DOM.slotEmptyMsg.classList.remove('hidden');
    }
  }

  function renderDatePills(dates) {
    DOM.slotDatesContainer.innerHTML = '';
    dates.forEach((dateStr) => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = `date-pill ${dateStr === state.selectedDate ? 'active' : ''}`;
      pill.setAttribute('role', 'tab');
      pill.setAttribute('aria-selected', dateStr === state.selectedDate ? 'true' : 'false');
      pill.textContent = formatDatePill(dateStr);

      pill.addEventListener('click', () => {
        state.selectedDate = dateStr;
        document.querySelectorAll('.date-pill').forEach((p) => {
          p.classList.remove('active');
          p.setAttribute('aria-selected', 'false');
        });
        pill.classList.add('active');
        pill.setAttribute('aria-selected', 'true');
        renderTimeSlots(dateStr);
      });

      DOM.slotDatesContainer.appendChild(pill);
    });
  }

  function renderTimeSlots(dateStr) {
    DOM.slotTimesGrid.innerHTML = '';
    const daySlots = state.groupedSlots[dateStr] || [];

    if (daySlots.length === 0) {
      DOM.slotTimesGrid.innerHTML = '<p class="form-hint" style="grid-column: 1/-1; text-align: center; padding: 1rem;">No hay horarios disponibles para esta fecha.</p>';
      return;
    }

    daySlots.forEach((slot) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isSelected = slot.id === state.selectedSlotId;
      btn.className = `slot-btn ${isSelected ? 'active' : ''}`;
      btn.setAttribute('data-slot-id', slot.id);

      const timeLabel = slot.time_start ? `${slot.time_start} hrs` : formatTimeLabel(slot.start_time);
      btn.textContent = timeLabel;

      btn.addEventListener('click', () => handleSlotSelection(slot.id));
      DOM.slotTimesGrid.appendChild(btn);
    });
  }

  function formatDatePill(dateStr) {
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const dateObj = new Date(Date.UTC(year, month, day, 12, 0, 0));

    const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

    return `${dayNames[dateObj.getUTCDay()]} ${day} ${monthNames[month]}`;
  }

  function formatTimeLabel(isoStr) {
    if (!isoStr) return '';
    try {
      const date = new Date(isoStr);
      const hours = String(date.getUTCHours()).padStart(2, '0');
      const mins = String(date.getUTCMinutes()).padStart(2, '0');
      return `${hours}:${mins} hrs`;
    } catch {
      return isoStr;
    }
  }

  async function handleSlotSelection(slotId) {
    if (state.selectedSlotId === slotId && state.lockToken) return;

    // Release previously held lock if switching slots
    if (state.selectedSlotId && state.lockToken) {
      releaseCurrentSlotLock(state.selectedSlotId, state.lockToken);
    }

    try {
      const response = await fetch(`/api/slots/${slotId}/lock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await response.json();

      if (response.status === 409 || !response.ok || !data.success) {
        showGlobalError(data.error || 'El horario seleccionado ya fue apartado por otra persona. Por favor elige otro horario.');
        clearSlotLockState();
        fetchAvailableSlots();
        return;
      }

      // Lock acquired successfully
      state.selectedSlotId = slotId;
      state.lockToken = data.lock_token;
      state.lockExpiresAt = new Date(data.expires_at).getTime();

      DOM.slotIdInput.value = slotId;
      DOM.lockTokenInput.value = data.lock_token;

      // Update UI active slot chip
      renderTimeSlots(state.selectedDate);

      // Start 15-minute countdown ticker
      startLockTimer();
      hideGlobalError();
      const slotErr = document.getElementById('slot_id-error');
      if (slotErr) slotErr.classList.add('hidden');
    } catch (err) {
      showGlobalError('No fue posible apartar el horario. Por favor revisa tu conexión e intenta de nuevo.');
    }
  }

  function startLockTimer() {
    if (state.lockTimerInterval) clearInterval(state.lockTimerInterval);
    DOM.slotLockBanner.classList.remove('hidden');

    function tick() {
      const remainingMs = state.lockExpiresAt - Date.now();

      if (remainingMs <= 0) {
        clearInterval(state.lockTimerInterval);
        clearSlotLockState();
        showGlobalError('El tiempo de apartado de 15 minutos ha expirado. Por favor selecciona y aparta un nuevo horario.');
        fetchAvailableSlots();
        return;
      }

      const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
      const mins = Math.floor(totalSeconds / 60);
      const secs = totalSeconds % 60;
      DOM.slotLockTimerText.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    tick();
    state.lockTimerInterval = setInterval(tick, 1000);
  }

  function clearSlotLockState() {
    if (state.lockTimerInterval) clearInterval(state.lockTimerInterval);
    state.selectedSlotId = null;
    state.lockToken = null;
    state.lockExpiresAt = null;

    DOM.slotIdInput.value = '';
    DOM.lockTokenInput.value = '';
    DOM.slotLockBanner.classList.add('hidden');
    renderTimeSlots(state.selectedDate);
  }

  async function releaseCurrentSlotLock(slotId, lockToken) {
    try {
      await fetch(`/api/slots/${slotId}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lock_token: lockToken })
      });
    } catch {
      // Best-effort lock release
    }
  }

  // --- Strict Form Validation ---
  function validateForm() {
    hideAllErrors();
    let isValid = true;
    let firstErrorField = null;

    function setFieldError(inputElem, errorElemId, message) {
      if (inputElem) inputElem.classList.add('input-error');
      const errElem = document.getElementById(errorElemId);
      if (errElem) {
        errElem.textContent = message;
        errElem.classList.remove('hidden');
      }
      if (!firstErrorField && inputElem) {
        firstErrorField = inputElem;
      }
      isValid = false;
    }

    // Category Validation
    const category = DOM.categoryInput.value;
    if (!category || !['Amor', 'Trabajo/Dinero', 'Familia', 'Otro'].includes(category)) {
      setFieldError(DOM.categoryInput, 'category-error', 'Por favor selecciona el área de tu consulta.');
    }

    // Name Validation (>= 2 chars)
    const name = DOM.nameInput.value.trim();
    if (!name || name.length < 2) {
      setFieldError(DOM.nameInput, 'customer_name-error', 'Por favor ingresa tu nombre completo (mínimo 2 letras).');
    }

    // Email Validation (RFC 5322 regex)
    const email = DOM.emailInput.value.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      setFieldError(DOM.emailInput, 'customer_email-error', 'Ingresa un correo electrónico válido para recibir tu lectura.');
    }

    // Birthdate Validation (Past Gregorian date YYYY-MM-DD)
    const birthdate = DOM.birthdateInput.value.trim();
    if (!isValidPastDate(birthdate)) {
      setFieldError(DOM.birthdateInput, 'customer_birthdate-error', 'Ingresa una fecha de nacimiento válida en el pasado (AAAA-MM-DD).');
    }

    // 5-Cartas Core Focus Validation (Required for 5_cartas)
    if (state.selectedTier === '5_cartas') {
      const coreFocus = DOM.coreFocusInput.value.trim();
      if (!coreFocus || coreFocus.length < 1) {
        setFieldError(DOM.coreFocusInput, 'core_focus-error', 'Por favor especifica qué es lo que más deseas saber para la tirada de 5 cartas.');
      }
    }

    // Primary Question Validation
    const question = DOM.questionInput.value.trim();
    if (!question || question.length < 1) {
      setFieldError(DOM.questionInput, 'question-error', 'Por favor ingresa tu pregunta o consulta.');
    }

    // Live Call Slot Selection Validation
    if (state.selectedTier === 'llamada') {
      if (!state.selectedSlotId || !state.lockToken) {
        const slotErr = document.getElementById('slot_id-error');
        if (slotErr) {
          slotErr.textContent = 'Por favor selecciona y aparta un horario disponible en el calendario para tu llamada.';
          slotErr.classList.remove('hidden');
        }
        showGlobalError('Por favor selecciona y aparta un horario en el calendario para tu llamada.');
        if (!firstErrorField) firstErrorField = DOM.slotPickerSection;
        isValid = false;
      }
    }

    if (firstErrorField) {
      firstErrorField.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (typeof firstErrorField.focus === 'function') {
        firstErrorField.focus();
      }
    }

    return isValid;
  }

  function isValidPastDate(dateStr) {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
    const [y, m, d] = dateStr.split('-').map(Number);
    if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
    const dateObj = new Date(Date.UTC(y, m - 1, d));
    if (dateObj.getUTCFullYear() !== y || dateObj.getUTCMonth() !== m - 1 || dateObj.getUTCDate() !== d) {
      return false;
    }
    // Must be in the past
    return dateObj.getTime() < Date.now();
  }

  function hideAllErrors() {
    document.querySelectorAll('.input-error').forEach((el) => el.classList.remove('input-error'));
    document.querySelectorAll('.field-error-text').forEach((el) => el.classList.add('hidden'));
    hideGlobalError();
  }

  function showGlobalError(msg) {
    DOM.formErrorText.textContent = msg;
    DOM.formErrorBanner.classList.remove('hidden');
  }

  function hideGlobalError() {
    DOM.formErrorBanner.classList.add('hidden');
  }

  // --- Form Submission & Mercado Pago Preference Creation ---
  async function handleFormSubmit(e) {
    e.preventDefault();
    if (state.isSubmitting) return;

    if (!validateForm()) return;

    state.isSubmitting = true;
    DOM.submitBtn.disabled = true;
    DOM.submitBtnText.classList.add('hidden');
    DOM.submitSpinner.classList.remove('hidden');

    const payload = {
      tier_id: state.selectedTier,
      category: DOM.categoryInput.value,
      customer_name: DOM.nameInput.value.trim(),
      customer_email: DOM.emailInput.value.trim(),
      customer_phone: DOM.phoneInput.value.trim() || undefined,
      customer_birthdate: DOM.birthdateInput.value.trim(),
      question: DOM.questionInput.value.trim()
    };

    if (state.selectedTier === '3_cartas' || state.selectedTier === '5_cartas') {
      const involved = DOM.involvedNamesInput.value.trim();
      if (involved) payload.involved_names = involved;
    }

    if (state.selectedTier === '5_cartas') {
      payload.core_focus = DOM.coreFocusInput.value.trim();
    }

    if (state.selectedTier === 'llamada') {
      payload.slot_id = state.selectedSlotId;
      payload.lock_token = state.lockToken;
    }

    try {
      const response = await fetch('/api/checkout/create-preference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        showGlobalError(data.error || 'Ocurrió un error al procesar tu solicitud. Por favor intenta de nuevo.');
        resetSubmitButton();
        return;
      }

      // Save order metadata to sessionStorage for fallback polling
      try {
        sessionStorage.setItem('lumina_last_order_id', data.order_id);
        sessionStorage.setItem('lumina_last_tier_id', state.selectedTier);
        sessionStorage.setItem('lumina_customer_email', payload.customer_email);
      } catch {
        // Ignore sessionStorage restrictions
      }

      // Redirect user to Mercado Pago Checkout
      const redirectUrl = data.init_point || data.sandbox_init_point;
      if (redirectUrl) {
        window.location.href = redirectUrl;
      } else {
        showGlobalError('No fue posible generar el enlace de pago de Mercado Pago.');
        resetSubmitButton();
      }
    } catch (err) {
      showGlobalError('Error de comunicación con el servidor. Por favor verifica tu conexión e intenta de nuevo.');
      resetSubmitButton();
    }
  }

  function resetSubmitButton() {
    state.isSubmitting = false;
    DOM.submitBtn.disabled = false;
    DOM.submitBtnText.classList.remove('hidden');
    DOM.submitSpinner.classList.add('hidden');
  }

  // --- Post-Payment Status Polling & Confirmation Engine ---
  function checkUrlForPostPaymentConfirmation() {
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get('order_id') || params.get('external_reference') || sessionStorage.getItem('lumina_last_order_id');
    const hasPaymentParam = params.has('status') || params.has('payment_id') || params.has('collection_status') || params.has('order_id') || params.has('preference_id');

    if (orderId && hasPaymentParam) {
      openStatusConfirmationModal(orderId);
    }
  }

  function openStatusConfirmationModal(orderId) {
    DOM.confirmationModal.classList.remove('hidden');
    DOM.modalPolling.classList.remove('hidden');
    DOM.modalSuccessAsync.classList.add('hidden');
    DOM.modalSuccessCall.classList.add('hidden');
    DOM.modalOverbooked.classList.add('hidden');

    let attempts = 0;
    const maxAttempts = 35;

    async function poll() {
      attempts++;
      try {
        const response = await fetch(`/api/orders/${orderId}/status`);
        const data = await response.json();

        if (response.ok && data.success) {
          const status = (data.status || '').toUpperCase();

          if (status === 'APPROVED' || status === 'PAID') {
            if (state.pollInterval) clearInterval(state.pollInterval);
            renderSuccessConfirmation(data);
            return;
          }

          if (status === 'OVERBOOKED_NEEDS_RESCHEDULING') {
            if (state.pollInterval) clearInterval(state.pollInterval);
            renderOverbookedConfirmation(data);
            return;
          }
        }
      } catch {
        // Keep polling on transient network hiccups
      }

      if (attempts >= maxAttempts) {
        if (state.pollInterval) clearInterval(state.pollInterval);
        renderPendingFallback(orderId);
      }
    }

    poll();
    state.pollInterval = setInterval(poll, 2500);
  }

  function renderSuccessConfirmation(orderData) {
    DOM.modalPolling.classList.add('hidden');

    const isCall = orderData.tier_id === 'llamada' || !!orderData.slot;

    if (isCall) {
      DOM.modalSuccessCall.classList.remove('hidden');
      DOM.callOrderId.textContent = `#${orderData.order_id}`;

      if (orderData.slot) {
        DOM.callSlotDate.textContent = orderData.slot.date ? formatDatePill(orderData.slot.date) : 'Fecha confirmada';
        DOM.callSlotTime.textContent = `${orderData.slot.time_start || '16:00'} - ${orderData.slot.time_end || '16:45'} hrs (Hora CDMX / UTC-6)`;
      }
    } else {
      DOM.modalSuccessAsync.classList.remove('hidden');
      DOM.asyncOrderId.textContent = `#${orderData.order_id}`;
      DOM.asyncTierName.textContent = orderData.tier_name || TIER_METADATA[orderData.tier_id]?.name || 'Lectura de Tarot';
      DOM.asyncCategoryName.textContent = orderData.category || 'Consulta Espiritual';
      DOM.asyncAmountPaid.textContent = `$${orderData.amount || TIER_METADATA[orderData.tier_id]?.price || 150} MXN`;
      DOM.asyncTurnaroundText.textContent = orderData.turnaround_message || '✨ Tu lectura personalizada será grabada y enviada a tu correo dentro de las próximas 24 horas hábiles.';

      const storedEmail = sessionStorage.getItem('lumina_customer_email');
      if (storedEmail) {
        DOM.asyncCustomerEmail.textContent = storedEmail;
      }
    }
  }

  function renderOverbookedConfirmation(orderData) {
    DOM.modalPolling.classList.add('hidden');
    DOM.modalOverbooked.classList.remove('hidden');
    DOM.overbookedOrderId.textContent = `#${orderData.order_id}`;
  }

  function renderPendingFallback(orderId) {
    DOM.modalPolling.classList.add('hidden');
    DOM.modalSuccessAsync.classList.remove('hidden');
    DOM.asyncOrderId.textContent = `#${orderId}`;
    DOM.asyncTierName.textContent = 'Pago en Verificación';
    DOM.asyncCategoryName.textContent = 'Consulta';
    DOM.asyncAmountPaid.textContent = 'Procesando';
    DOM.asyncTurnaroundText.textContent = 'Tu pago se está procesando con Mercado Pago. En cuanto se confirme recibirás tu comprobante y lectura en un plazo de 24 horas a tu correo.';
  }

  function closeModalAndClearParams() {
    DOM.confirmationModal.classList.add('hidden');
    if (state.pollInterval) clearInterval(state.pollInterval);
    try {
      window.history.replaceState({}, document.title, window.location.pathname);
      sessionStorage.removeItem('lumina_last_order_id');
    } catch {
      // Ignore
    }
  }

  // --- Start Application on DOM Ready ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
