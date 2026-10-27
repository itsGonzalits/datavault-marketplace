/* ============================================================
   DataVault — payments.js
   Stripe Payment Element for bids. A bid puts a temporary HOLD on
   the buyer's card; it is only charged if the bid wins.
   ============================================================ */

'use strict';

const DVPayments = (() => {

  let stripe   = null;
  let elements = null;
  let current  = null; // { paymentIntentId, amount, datasetId }

  async function initStripe() {
    if (stripe) return stripe;
    const key = window.DV_CONFIG?.STRIPE_PUBLISHABLE_KEY;
    if (!key) throw new Error('Payments are not set up yet.');
    if (!window.Stripe) await loadScript('https://js.stripe.com/v3/');
    stripe = window.Stripe(key);
    return stripe;
  }

  /* Create the hold on the server and show the card form */
  async function mountPaymentElement(containerId, amount, datasetId) {
    const container = document.getElementById(containerId);
    container.innerHTML = `<div class="text-center py-4"><div class="spinner spinner--lg mx-auto mb-4"></div><p class="text-secondary text-sm">Loading secure card form…</p></div>`;
    current = null;
    elements = null;

    try {
      await initStripe();
      const token = await DVSupabase.auth.getToken();
      const base = window.DV_CONFIG?.FUNCTIONS_URL || '/.netlify/functions';
      const res = await fetch(`${base}/create-payment-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ datasetId, amount }), // dollars — the server converts to cents
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not start the payment. Please try again.');

      elements = stripe.elements({ clientSecret: data.clientSecret, appearance: appearance() });
      container.innerHTML = '';
      elements.create('payment', { layout: 'tabs' }).mount(`#${containerId}`);
      current = { paymentIntentId: data.paymentIntentId, amount: data.amount, datasetId };
      return current;
    } catch (err) {
      container.innerHTML = `<div class="alert alert--error"><span class="alert__icon">⚠️</span><div></div></div>`;
      container.querySelector('.alert div').textContent = err.message;
      throw err;
    }
  }

  /* Authorize the hold. Resolves with the PaymentIntent id. */
  async function confirmHold() {
    if (!stripe || !elements || !current) throw new Error('The card form is still loading.');
    const returnUrl = new URL(window.location.href);
    returnUrl.searchParams.set('bid_return', '1');
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
      confirmParams: { return_url: returnUrl.toString() },
    });
    if (error) throw new Error(error.message || 'Your card was not accepted.');
    if (paymentIntent && paymentIntent.status !== 'requires_capture') {
      throw new Error('Your card could not be authorized. Please try another card.');
    }
    return (paymentIntent && paymentIntent.id) || current.paymentIntentId;
  }

  function appearance() {
    return {
      theme: 'stripe',
      variables: {
        colorPrimary: '#0D9488', colorText: '#1C1917', colorDanger: '#DC2626',
        fontFamily: "'Outfit', system-ui, sans-serif", borderRadius: '10px', fontSizeBase: '16px',
      },
    };
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load the secure payment form. Please check your connection.'));
      document.head.appendChild(s);
    });
  }

  return { initStripe, mountPaymentElement, confirmHold, PLATFORM_FEE_PCT: 0.05 };
})();

window.DVPayments = DVPayments;
