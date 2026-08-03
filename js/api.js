/* ============================================================
   DataVault — api.js
   Unified API client. Calls Netlify Functions for all data ops.
   Replaces supabase.js for the pure-Netlify backend.

   Auth: Netlify Identity (gotrue-js)
   Data: Netlify Blobs (via Netlify Functions)
   ============================================================ */

'use strict';

/* ----------------------------------------------------------
   BASE URL — auto-detects dev vs production
   ---------------------------------------------------------- */
const API_BASE = (() => {
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:8888/.netlify/functions';
  }
  return '/.netlify/functions';
})();

/* ----------------------------------------------------------
   HTTP HELPER
   ---------------------------------------------------------- */
async function apiFetch(path, options = {}) {
  const identity = window.netlifyIdentity;
  const token    = identity?.currentUser()?.token?.access_token;

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(err.error || `HTTP ${response.status}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

/* ============================================================
   AUTH — wraps Netlify Identity (gotrue-js widget)
   ============================================================ */
const DVAuth = {

  /* Returns current user or null */
  currentUser() {
    return window.netlifyIdentity?.currentUser() || null;
  },

  /* Shorthand */
  getUser() {
    return this.currentUser();
  },

  /* Open login modal */
  openLogin() {
    window.netlifyIdentity?.open('login');
  },

  /* Open signup modal */
  openSignup() {
    window.netlifyIdentity?.open('signup');
  },

  /* Sign out */
  logout() {
    window.netlifyIdentity?.logout();
  },

  /* Get JWT token for API calls */
  getToken() {
    return window.netlifyIdentity?.currentUser()?.token?.access_token || null;
  },

  /* Listen to auth events */
  on(event, cb) {
    window.netlifyIdentity?.on(event, cb);
  },

  off(event, cb) {
    window.netlifyIdentity?.off(event, cb);
  },

  /* Check if logged in */
  isLoggedIn() {
    return !!this.currentUser();
  },
};

/* ============================================================
   DATASETS
   ============================================================ */
const DVDatasets = {

  /* List datasets with filters */
  async list({ category, search, status = 'active', sort = 'newest', limit = 24, offset = 0 } = {}) {
    const params = new URLSearchParams({ status, limit, offset });
    if (category) params.set('category', category);
    if (search)   params.set('search', search);
    if (sort)     params.set('sort', sort);

    const data = await apiFetch(`/datasets?${params}`);
    return { data: data.datasets || [], count: data.count || 0, error: null };
  },

  /* Get single dataset */
  async get(id) {
    const data = await apiFetch(`/datasets?id=${encodeURIComponent(id)}`);
    return { data: data.dataset || null, error: null };
  },

  /* Create dataset */
  async create(payload) {
    const data = await apiFetch('/datasets', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return { data: data.dataset, error: null };
  },

  /* Get seller's datasets */
  async getBySeller(sellerId) {
    const data = await apiFetch(`/datasets?seller_id=${encodeURIComponent(sellerId)}`);
    return { data: data.datasets || [], error: null };
  },

  /* Upload encrypted file */
  async uploadFile(encryptedBlob, originalName) {
    const formData = new FormData();
    formData.append('file', encryptedBlob, originalName + '.enc');
    formData.append('name', originalName);

    const identity = window.netlifyIdentity;
    const token    = identity?.currentUser()?.token?.access_token;

    const response = await fetch(`${API_BASE}/upload-file`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });

    if (!response.ok) throw new Error('Upload failed');
    return response.json();
  },

  /* Get platform stats */
  async getPlatformStats() {
    const data = await apiFetch('/stats').catch(() => null);
    return { data: data?.stats || DEMO_DATA.stats, error: null };
  },
};

/* ============================================================
   BIDS
   ============================================================ */
const DVBids = {

  /* Get bids for a dataset */
  async getForDataset(datasetId) {
    const data = await apiFetch(`/bids?dataset_id=${encodeURIComponent(datasetId)}`);
    return { data: data.bids || [], error: null };
  },

  /* Place a bid */
  async place(datasetId, amount, paymentIntentId) {
    const data = await apiFetch('/bids', {
      method: 'POST',
      body: JSON.stringify({ dataset_id: datasetId, amount, payment_intent_id: paymentIntentId }),
    });
    return { data: data.bid, error: null };
  },

  /* Get buyer's bids */
  async getByBuyer() {
    const data = await apiFetch('/bids?my_bids=true');
    return { data: data.bids || [], error: null };
  },

  /* Poll for bid updates (replaces Supabase Realtime) */
  subscribeToDataset(datasetId, onNewBid) {
    let lastCount = 0;
    const interval = setInterval(async () => {
      const { data: bids } = await DVBids.getForDataset(datasetId).catch(() => ({ data: [] }));
      if (bids.length > lastCount) {
        const newBids = bids.slice(0, bids.length - lastCount);
        newBids.forEach(b => onNewBid(b));
        lastCount = bids.length;
      }
    }, 10000); // Poll every 10 seconds

    return () => clearInterval(interval);
  },

  subscribeToDatasetPrice(datasetId, onPriceUpdate) {
    let lastPrice = null;
    const interval = setInterval(async () => {
      const { data: ds } = await DVDatasets.get(datasetId).catch(() => ({ data: null }));
      if (ds && ds.current_top_bid !== lastPrice) {
        onPriceUpdate(ds);
        lastPrice = ds.current_top_bid;
      }
    }, 8000);

    return () => clearInterval(interval);
  },
};

/* ============================================================
   PROFILES
   ============================================================ */
const DVProfiles = {

  async get(userId) {
    const data = await apiFetch(`/profile?user_id=${encodeURIComponent(userId)}`);
    return { data: data.profile, error: null };
  },

  async upsert(profileData) {
    const data = await apiFetch('/profile', {
      method: 'POST',
      body: JSON.stringify(profileData),
    });
    return { data: data.profile, error: null };
  },

  async update(userId, fields) {
    const data = await apiFetch('/profile', {
      method: 'PATCH',
      body: JSON.stringify({ user_id: userId, ...fields }),
    });
    return { data: data.profile, error: null };
  },

  async uploadVerificationDoc(userId, file) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('user_id', userId);
    formData.append('type', 'verification');

    const identity = window.netlifyIdentity;
    const token    = identity?.currentUser()?.token?.access_token;

    const response = await fetch(`${API_BASE}/upload-file`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });

    if (!response.ok) throw new Error('Upload failed');
    const result = await response.json();

    // Update profile with doc URL
    await this.update(userId, { verification_doc_url: result.url });
    return { data: result, error: null };
  },
};

/* ============================================================
   TRANSACTIONS
   ============================================================ */
const DVTransactions = {

  async getByBuyer() {
    const data = await apiFetch('/transactions?role=buyer');
    return { data: data.transactions || [], error: null };
  },

  async getSellerEarnings() {
    const data = await apiFetch('/transactions?role=seller');
    return { data: data.transactions || [], error: null };
  },
};

/* ============================================================
   DEMO DATA — fallback when functions aren't deployed yet
   ============================================================ */
const DEMO_DATA = {
  profile: {
    id: 'demo-user',
    email: 'demo@example.com',
    full_name: 'Demo User',
    role: 'seller',
    business_name: "Rosa's Bakery",
    industry: 'Bakery',
    city: 'Austin',
    state: 'TX',
    verified: true,
  },
  stats: {
    total_datasets: 2400,
    total_paid_out: 840000,
    total_buyers: 12000,
    satisfaction_pct: 98.4,
  },
  datasets: [
    { id: 'demo-1', title: 'Downtown Café Sales 2023–2024', description: '24 months of daily sales, 18,400+ transactions.', category: 'Retail Sales', location: 'Austin, TX', starting_bid: 200, reserve_price: 400, current_top_bid: 680, bid_count: 8, row_count: 18420, date_range_start: '2023-01-01', date_range_end: '2024-12-31', auction_end: new Date(Date.now() + 3.5 * 86400000).toISOString(), status: 'active', seller: { business_name: "Rosa's Café", verified: true } },
    { id: 'demo-2', title: 'Boutique Inventory & Pricing 2024', description: 'Complete inventory turnover and pricing history.', category: 'Inventory', location: 'Nashville, TN', starting_bid: 150, reserve_price: 300, current_top_bid: 320, bid_count: 4, row_count: 5200, date_range_start: '2024-01-01', date_range_end: '2024-12-31', auction_end: new Date(Date.now() + 1.2 * 86400000).toISOString(), status: 'active', seller: { business_name: 'Bella Boutique', verified: true } },
    { id: 'demo-3', title: 'Restaurant Foot Traffic Q1–Q3 2024', description: 'Hourly foot traffic counts + weather correlation.', category: 'Foot Traffic', location: 'Chicago, IL', starting_bid: 300, reserve_price: 600, current_top_bid: 0, bid_count: 0, row_count: 9800, date_range_start: '2024-01-01', date_range_end: '2024-09-30', auction_end: new Date(Date.now() + 5 * 86400000).toISOString(), status: 'active', seller: { business_name: 'The Corner Kitchen', verified: true } },
    { id: 'demo-4', title: 'Auto Repair Service History 2022–2024', description: '3 years of service records, parts pricing, labor hours.', category: 'Services', location: 'Phoenix, AZ', starting_bid: 250, reserve_price: 500, current_top_bid: 410, bid_count: 5, row_count: 3100, date_range_start: '2022-01-01', date_range_end: '2024-12-31', auction_end: new Date(Date.now() + 2 * 86400000).toISOString(), status: 'active', seller: { business_name: "Mike's Auto", verified: true } },
    { id: 'demo-5', title: 'Local Grocery Pricing Survey 2024', description: 'Weekly prices for 200+ SKUs across 3 competing stores.', category: 'Local Pricing', location: 'Portland, OR', starting_bid: 180, reserve_price: 350, current_top_bid: 220, bid_count: 2, row_count: 10400, date_range_start: '2024-01-01', date_range_end: '2024-12-31', auction_end: new Date(Date.now() + 4 * 86400000).toISOString(), status: 'active', seller: { business_name: 'FreshMarket Data', verified: false } },
    { id: 'demo-6', title: 'Hair Salon Visit Patterns 2023', description: 'Appointment frequency, service types, repeat rates.', category: 'Customer Demographics', location: 'Miami, FL', starting_bid: 120, reserve_price: 250, current_top_bid: 195, bid_count: 3, row_count: 4800, date_range_start: '2023-01-01', date_range_end: '2023-12-31', auction_end: new Date(Date.now() + 6 * 86400000).toISOString(), status: 'active', seller: { business_name: 'Style Studio', verified: true } },
  ],
};

/* ============================================================
   EXPOSE — mirrors DVSupabase API so existing pages work
   ============================================================ */
window.DVSupabase = {
  auth:         DVAuth,
  profiles:     DVProfiles,
  datasets:     DVDatasets,
  bids:         DVBids,
  transactions: DVTransactions,
  DEMO_DATA,
  getClient:    () => null, // Netlify Identity is not a Supabase client
};
