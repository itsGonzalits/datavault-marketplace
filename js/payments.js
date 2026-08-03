/* ============================================================
   DataVault — payments.js
   Stripe integration: cards, PayPal, Apple Pay, Google Pay
   Uses Stripe Payment Element for a unified checkout UI
   ============================================================ */

'use strict';

const DVPayments = (() => {

  /* ----------------------------------------------------------
     CONFIGURATION
     !! Replace with your actual Stripe publishable key !!
     Get yours at: https://dashboard.stripe.com/apikeys
     ---------------------------------------------------------- */
  const STRIPE_PUBLISHABLE_KEY = window.DV_CONFIG?.STRIPE_PUBLISHABLE_KEY || 'pk_test_REPLACE_WITH_YOUR_STRIPE_KEY';
  const PLATFORM_FEE_PCT = window.DV_CONFIG?.PLATFORM_FEE_PCT || 0.05;

  let stripe        = null;
  let elements      = null;
  let paymentElement = null;

  /* ----------------------------------------------------------
     INIT STRIPE
     Loads Stripe.js from CDN if not already loaded.
     ---------------------------------------------------------- */
  async function initStripe() {
    if (stripe) return stripe;

    if (!window.Stripe) {
      await loadScript('https://js.stripe.com/v3/');
    }

    stripe = Stripe(STRIPE_PUBLISHABLE_KEY);
    return stripe;
  }

  /* ----------------------------------------------------------
     CREATE PAYMENT INTENT (mock — replace with real API call)
     In production this call goes to your backend server,
     which creates the PaymentIntent using your SECRET key.
     ---------------------------------------------------------- */
  async function createPaymentIntent(amount, datasetId, buyerEmail) {
    const isDemoMode = window.DV_CONFIG?.DEMO_MODE;

    // Demo mode — return a simulated client secret so UI still works
    if (isDemoMode || STRIPE_PUBLISHABLE_KEY.includes('REPLACE_WITH')) {
      console.log('[DVPayments] Demo mode: simulating PaymentIntent');
      await delay(600);
      return {
        clientSecret: 'pi_demo_' + Math.random().toString(36).slice(2) + '_secret_demo',
        paymentIntentId: 'pi_demo_' + Math.random().toString(36).slice(2),
        amount: Math.round(amount * 100),
        status: 'requires_payment_method',
        mock: true,
      };
    }

    // Real mode — call Netlify Function (secret key lives server-side only)
    const functionsUrl = window.DV_CONFIG?.FUNCTIONS_URL || '/.netlify/functions';
    const response = await fetch(`${functionsUrl}/create-payment-intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: Math.round(amount * 100), // Stripe uses cents
        currency: 'usd',
        datasetId,
        buyerEmail,
        captureMethod: 'manual', // Authorize only; capture on auction win
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Server error' }));
      throw new Error(err.error || 'Failed to create payment intent');
    }

    return response.json();
  }

  /* ----------------------------------------------------------
     MOUNT PAYMENT ELEMENT
     Renders the Stripe Payment Element into a container div.
     Supports: Cards, PayPal, Apple Pay, Google Pay, Link
     ---------------------------------------------------------- */
  async function mountPaymentElement(containerId, amount, metadata = {}) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error(`[DVPayments] Container #${containerId} not found`);
      return;
    }

    container.innerHTML = renderPaymentPlaceholder(amount);
    await initStripe();

    try {
      const intent = await createPaymentIntent(amount, metadata.datasetId, metadata.email);

      if (intent.mock) {
        // Show styled mock UI (for demo without real Stripe key)
        container.innerHTML = renderMockPaymentUI(amount);
        return { mock: true };
      }

      // Real Stripe Elements
      elements = stripe.elements({
        clientSecret: intent.clientSecret,
        appearance: stripeAppearance(),
      });

      paymentElement = elements.create('payment', {
        layout: { type: 'tabs', defaultCollapsed: false },
        paymentMethodOrder: ['card', 'paypal', 'apple_pay', 'google_pay'],
      });
      paymentElement.mount(`#${containerId}`);

      return { intent, elements, paymentElement };

    } catch (err) {
      container.innerHTML = renderPaymentError(err.message);
      throw err;
    }
  }

  /* ----------------------------------------------------------
     CONFIRM PAYMENT (for immediate charges)
     ---------------------------------------------------------- */
  async function confirmPayment(returnUrl) {
    if (!stripe || !elements) throw new Error('Stripe not initialized');

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl || window.location.href },
    });

    if (error) throw new Error(error.message);
  }

  /* ----------------------------------------------------------
     CAPTURE PAYMENT INTENT (called when auction closes and this bid wins)
     In production: your backend captures the pre-authorized payment.
     ---------------------------------------------------------- */
  async function capturePayment(paymentIntentId) {
    console.log('[DVPayments] Capturing payment intent (MOCK):', paymentIntentId);
    await delay(500);
    return { success: true, paymentIntentId, capturedAt: new Date().toISOString() };
  }

  /* ----------------------------------------------------------
     CANCEL PAYMENT INTENT (if bid loses)
     ---------------------------------------------------------- */
  async function cancelPayment(paymentIntentId) {
    console.log('[DVPayments] Canceling payment intent (MOCK):', paymentIntentId);
    await delay(300);
    return { success: true, paymentIntentId };
  }

  /* ----------------------------------------------------------
     STRIPE APPEARANCE CONFIG (matches DataVault design tokens)
     ---------------------------------------------------------- */
  function stripeAppearance() {
    return {
      theme: 'stripe',
      variables: {
        colorPrimary:         '#0D9488',
        colorBackground:      '#FFFFFF',
        colorText:            '#1C1917',
        colorDanger:          '#DC2626',
        colorTextSecondary:   '#78716C',
        fontFamily:           "'Outfit', system-ui, sans-serif",
        spacingUnit:          '4px',
        borderRadius:         '10px',
        fontSizeBase:         '16px',
        fontWeightNormal:     '500',
      },
      rules: {
        '.Input': {
          border:    '2px solid #E7E5E4',
          boxShadow: 'none',
          padding:   '12px 16px',
        },
        '.Input:focus': {
          border:    '2px solid #0D9488',
          boxShadow: '0 0 0 3px #CCFBF1',
        },
        '.Label': { fontWeight: '600', color: '#1C1917' },
        '.Tab':   { border: '2px solid #E7E5E4', boxShadow: 'none' },
        '.Tab--selected': {
          border: '2px solid #0D9488',
          color:  '#0D9488',
        },
      },
    };
  }

  /* ----------------------------------------------------------
     PRICE BREAKDOWN
     ---------------------------------------------------------- */
  function getPriceBreakdown(bidAmount) {
    const fee    = bidAmount * PLATFORM_FEE_PCT;
    const payout = bidAmount - fee;
    return {
      bidAmount,
      platformFee:   fee,
      vendorPayout:  payout,
      displayAmount: `$${bidAmount.toFixed(2)}`,
      displayFee:    `$${fee.toFixed(2)}`,
      displayPayout: `$${payout.toFixed(2)}`,
    };
  }

  /* ----------------------------------------------------------
     RENDER HELPERS (DOM)
     ---------------------------------------------------------- */
  function renderPaymentPlaceholder(amount) {
    return `
      <div style="padding:24px;text-align:center;">
        <div class="spinner spinner--lg" style="margin:0 auto 16px;"></div>
        <p class="text-secondary text-sm">Loading secure payment form for $${amount?.toFixed(2) || '—'}…</p>
      </div>
    `;
  }

  function renderMockPaymentUI(amount) {
    return `
      <div style="border:2px solid var(--c-border);border-radius:var(--r-lg);padding:var(--sp-5);">
        <div style="display:flex;gap:var(--sp-3);margin-bottom:var(--sp-4);">
          ${['💳 Card','🅿️ PayPal','🍎 Apple Pay','G Pay'].map((m,i) => `
            <button onclick="this.parentElement.querySelectorAll('button').forEach(b=>b.style.borderColor='var(--c-border)');this.style.borderColor='var(--c-primary)'"
              style="flex:1;padding:var(--sp-3);border:2px solid ${i===0?'var(--c-primary)':'var(--c-border)'};border-radius:var(--r-md);background:var(--c-surface);cursor:pointer;font-family:var(--font);font-size:var(--fs-xs);font-weight:600;color:var(--c-text)">
              ${m}
            </button>
          `).join('')}
        </div>
        <div class="form-group mt-4">
          <label class="form-label">Card number</label>
          <input class="input" placeholder="1234 5678 9012 3456" maxlength="19" oninput="this.value=this.value.replace(/[^0-9]/g,'').replace(/(.{4})/g,'$1 ').trim()">
        </div>
        <div class="grid-2 mt-4">
          <div class="form-group">
            <label class="form-label">Expiry</label>
            <input class="input" placeholder="MM / YY" maxlength="7">
          </div>
          <div class="form-group">
            <label class="form-label">CVC</label>
            <input class="input" placeholder="123" maxlength="4">
          </div>
        </div>
        <div class="form-group mt-4">
          <label class="form-label">Cardholder name</label>
          <input class="input" placeholder="Name on card">
        </div>
        <div class="alert alert--neutral mt-4" style="font-size:var(--fs-xs)">
          <span class="alert__icon">🔒</span>
          <span>Secured by Stripe. Your card info never touches our servers. <strong>You will only be charged if your bid wins.</strong></span>
        </div>
        <div style="text-align:center;margin-top:var(--sp-4);">
          <small class="text-secondary text-xs" style="display:flex;align-items:center;justify-content:center;gap:8px;">
            <span>Powered by</span>
            <strong style="color:#635BFF">Stripe</strong>
            <span>·</span>
            <span>💳 Visa · MC · Amex · PayPal · 🍎 · G</span>
          </small>
        </div>
      </div>
    `;
  }

  function renderPaymentError(message) {
    return `
      <div class="alert alert--error">
        <span class="alert__icon">❌</span>
        <div>
          <div class="alert__title">Payment setup failed</div>
          <div>${message || 'Could not load payment form. Please refresh and try again.'}</div>
        </div>
      </div>
    `;
  }

  /* ----------------------------------------------------------
     LOAD EXTERNAL SCRIPT
     ---------------------------------------------------------- */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });
  }

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  /* ----------------------------------------------------------
     PUBLIC API
     ---------------------------------------------------------- */
  return {
    initStripe,
    mountPaymentElement,
    confirmPayment,
    capturePayment,
    cancelPayment,
    createPaymentIntent,
    getPriceBreakdown,
    PLATFORM_FEE_PCT,
  };

})();

window.DVPayments = DVPayments;
