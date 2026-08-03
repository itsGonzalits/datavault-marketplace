/* ============================================================
   DataVault — config.js
   Central configuration. No manual setup required.

   This app uses:
   - Netlify Identity for auth (built-in, zero setup)
   - Netlify Blobs for database/storage (built-in, zero setup)
   - Stripe for payments (keys pre-configured)
   ============================================================ */

window.DV_CONFIG = {

  /* ── Stripe Publishable Key ─────────────────────────────────
     This key is safe to include here (client-only, no risk).
     The secret key is stored in Netlify env vars only.
     ----------------------------------------------------------- */
  STRIPE_PUBLISHABLE_KEY: 'pk_test_51TwzxKCRxXjBXwRABBlFAznvxH9w58Qmlxf2TaTY54AeMXOWqSheqnQoWBkMa7reMPhXuKbNILtpRHBPLVng33qg001gBMH3PG',

  /* ── Platform Settings ────────────────────────────────────── */
  PLATFORM_FEE_PCT:  0.05,
  MIN_BID_INCREMENT: 10,

  /* ── Demo Mode ──────────────────────────────────────────────
     Automatically set to true when running as a local file.
     Set to false once deployed to Netlify.
     ----------------------------------------------------------- */
  get DEMO_MODE() {
    return window.location.protocol === 'file:';
  },

  /* ── API Base URL ───────────────────────────────────────────
     Auto-detects: local dev vs. Netlify production.
     ----------------------------------------------------------- */
  get FUNCTIONS_URL() {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return 'http://localhost:8888/.netlify/functions';
    }
    return '/.netlify/functions';
  },

  /* ── Site URL ───────────────────────────────────────────────
     Used for Netlify Identity redirect URLs.
     ----------------------------------------------------------- */
  SITE_URL: 'https://datavault-marketplace.netlify.app',
};
