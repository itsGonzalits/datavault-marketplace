/* ============================================================
   DataVault — api.js
   Talks to the Netlify Functions. Exposed as window.DVSupabase
   (old name kept so every page keeps working).

   Auth: Netlify Identity · Data: Netlify Blobs · Payments: Stripe
   ============================================================ */

'use strict';

// Same-origin in production and under `netlify dev`
const API_BASE = '/.netlify/functions';

/* Fresh JWT for the signed-in user (refreshes automatically) */
function identityUser() {
  const id = window.netlifyIdentity;
  return id?.currentUser?.() || id?.gotrue?.currentUser?.() || null;
}

async function authToken() {
  const user = identityUser();
  if (!user) return null;
  if (typeof user.jwt === 'function') {
    try { return await user.jwt(); } catch { /* fall through */ }
  }
  return user.token?.access_token || null;
}

async function apiFetch(path, options = {}) {
  const token = await authToken();
  const isForm = options.body instanceof FormData;
  const headers = {
    ...(isForm ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new Error('We couldn\'t reach DataVault. Please check your internet connection and try again.');
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const e = new Error(err.error || (response.status === 401 ? 'Please sign in again.' : 'Something went wrong. Please try again.'));
    e.status = response.status;
    throw e;
  }
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

/* ============================================================
   AUTH (thin wrapper around Netlify Identity)
   ============================================================ */
const DVAuth = {
  currentUser() { return identityUser(); },
  getUser()     { return this.currentUser(); },
  isLoggedIn()  { return !!this.currentUser(); },
  logout()      { window.netlifyIdentity?.logout(); },
  getToken:     authToken,
};

/* ============================================================
   DATASETS (listings)
   ============================================================ */
const DVDatasets = {
  async list({ category, search, country, sort = 'ending', limit = 24, offset = 0 } = {}) {
    const params = new URLSearchParams({ sort, limit, offset });
    if (category) params.set('category', category);
    if (search)   params.set('search', search);
    if (country)  params.set('country', country);
    const data = await apiFetch(`/datasets?${params}`);
    return { data: data.datasets || [], count: data.count || 0, error: null };
  },

  async get(id) {
    try {
      const data = await apiFetch(`/datasets?id=${encodeURIComponent(id)}`);
      return { data: data.dataset || null, error: null };
    } catch (err) {
      return { data: null, error: err };
    }
  },

  async mine() {
    const data = await apiFetch('/datasets?mine=true');
    return { data: data.datasets || [], error: null };
  },

  async create(payload) {
    const data = await apiFetch('/datasets', { method: 'POST', body: JSON.stringify(payload) });
    return { data: data.dataset, error: null };
  },

  /* Upload the already-encrypted file together with its key */
  async uploadFile(encryptedBlob, originalName, encryptionKey) {
    const form = new FormData();
    form.append('file', encryptedBlob, originalName + '.enc');
    form.append('name', originalName);
    form.append('type', 'dataset');
    form.append('encryption_key', encryptionKey);
    return apiFetch('/upload-file', { method: 'POST', body: form });
  },

  /* Seller: end now and charge the top bidder */
  async sellNow(datasetId, acceptBelowMinimum = false) {
    return apiFetch('/close-auction', { method: 'POST', body: JSON.stringify({ datasetId, acceptBelowMinimum }) });
  },

  /* Buyer (winner) or seller: save the original file to this device */
  async download(datasetId, fallbackName = 'dataset') {
    const token = await authToken();
    const res = await fetch(`${API_BASE}/download?dataset_id=${encodeURIComponent(datasetId)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Download failed. Please try again.');
    }
    const disposition = res.headers.get('Content-Disposition') || '';
    const name = (disposition.match(/filename="([^"]+)"/) || [])[1] || fallbackName;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },

  /* Remove personal details + suggest a title/description (CSV, text, photos) */
  async prepare(payload) {
    return apiFetch('/ai-clean-and-summarize', { method: 'POST', body: JSON.stringify(payload) });
  },

  async getPlatformStats() {
    const data = await apiFetch('/stats').catch(() => null);
    return { data: data?.stats || null, error: null };
  },
};

/* ============================================================
   BIDS
   ============================================================ */
const DVBids = {
  async getForDataset(datasetId) {
    const data = await apiFetch(`/bids?dataset_id=${encodeURIComponent(datasetId)}`);
    return { data: data.bids || [], error: null };
  },

  async mine() {
    const data = await apiFetch('/bids?mine=true');
    return { data: data.bids || [], error: null };
  },

  /* Record a bid once the card hold is authorized */
  async place(datasetId, paymentIntentId) {
    const data = await apiFetch('/bids', {
      method: 'POST',
      body: JSON.stringify({ dataset_id: datasetId, payment_intent_id: paymentIntentId }),
    });
    return { data: data.bid, dataset: data.dataset, error: null };
  },

  /* Poll a listing for changes; calls back with the fresh listing */
  watch(datasetId, onChange, everyMs = 10000) {
    let last = null;
    const timer = setInterval(async () => {
      if (document.hidden) return;
      const { data: ds } = await DVDatasets.get(datasetId);
      if (!ds) return;
      const sig = `${ds.current_top_bid}|${ds.bid_count}|${ds.status}|${ds.auction_end}`;
      if (last !== null && sig !== last) onChange(ds);
      last = sig;
    }, everyMs);
    return () => clearInterval(timer);
  },
};

/* ============================================================
   PROFILES
   ============================================================ */
const DVProfiles = {
  async get() {
    if (window.DV_CONFIG?.DEMO_MODE) return { data: DEMO_DATA.profile, error: null };
    try {
      const data = await apiFetch('/profile');
      return { data: data.profile, error: null };
    } catch (err) {
      return { data: null, error: err };
    }
  },

  async save(fields) {
    if (window.DV_CONFIG?.DEMO_MODE) return { data: { ...DEMO_DATA.profile, ...fields }, error: null };
    const data = await apiFetch('/profile', { method: 'POST', body: JSON.stringify(fields) });
    if (window.DVAuthManager) window.DVAuthManager.setProfile(data.profile);
    return { data: data.profile, error: null };
  },

  // Older call sites
  upsert(fields)       { return this.save(fields); },
  update(_id, fields)  { return this.save(fields); },

  async uploadVerificationDoc(_userId, file, docType = '') {
    const form = new FormData();
    form.append('file', file);
    form.append('name', file.name);
    form.append('type', 'verification');
    if (docType) form.append('doc_type', docType);
    const result = await apiFetch('/upload-file', { method: 'POST', body: form });
    const profile = window.DVAuthManager?.profile;
    if (profile) {
      profile.verified = result.verified;
      profile.verification_status = result.status;
    }
    return { data: result, error: null };
  },
};

/* ============================================================
   TRANSACTIONS (purchases + sales)
   ============================================================ */
const DVTransactions = {
  async purchases() {
    const data = await apiFetch('/transactions?role=buyer');
    return { data: data.transactions || [], error: null };
  },
  async sales() {
    const data = await apiFetch('/transactions?role=seller');
    return { data: data.transactions || [], error: null };
  },
};

/* Sample profile used only when the site is opened as a local file */
const DEMO_DATA = {
  profile: {
    id: 'demo-user', email: 'demo@example.com', full_name: 'Demo User', role: 'both',
    business_name: "Rosa's Bakery", industry: 'Bakery', city: 'Austin', state: 'TX',
    country: 'United States', verified: false,
  },
};

window.DVSupabase = {
  auth:         DVAuth,
  profiles:     DVProfiles,
  datasets:     DVDatasets,
  bids:         DVBids,
  transactions: DVTransactions,
  DEMO_DATA,
};
