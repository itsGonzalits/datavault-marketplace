/* ============================================================
   DataVault — supabase.js
   Supabase client initialization + all database operations.

   Depends on:
     - js/config.js  (window.DV_CONFIG)
     - Supabase CDN  (loaded via <script> tag in HTML)
   ============================================================ */

'use strict';

/* ----------------------------------------------------------
   CLIENT INIT
   ---------------------------------------------------------- */
let _supabase = null;

function getClient() {
  if (_supabase) return _supabase;

  const cfg = window.DV_CONFIG;
  if (!cfg || cfg.DEMO_MODE || !cfg.SUPABASE_URL || cfg.SUPABASE_URL.startsWith('YOUR_')) {
    return null; // Demo mode — callers check for null
  }

  if (!window.supabase?.createClient) {
    console.error('[DVSupabase] Supabase CDN not loaded. Add the <script> tag before supabase.js');
    return null;
  }

  _supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession:   true,
      detectSessionInUrl: true,
    },
  });

  return _supabase;
}

/* ============================================================
   AUTH OPERATIONS
   ============================================================ */
const DVAuth = {

  /* Send magic link to email */
  async sendMagicLink(email, redirectTo) {
    const sb = getClient();
    if (!sb) return { error: { message: 'Demo mode — auth disabled' } };

    const opts = {
      email,
      options: {
        emailRedirectTo: redirectTo || window.location.origin + '/login.html',
      },
    };
    return sb.auth.signInWithOtp(opts);
  },

  /* OAuth sign-in (Google) */
  async signInWithGoogle() {
    const sb = getClient();
    if (!sb) return { error: { message: 'Demo mode — auth disabled' } };

    return sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/login.html',
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });
  },

  /* Sign out */
  async signOut() {
    const sb = getClient();
    if (!sb) return;
    return sb.auth.signOut();
  },

  /* Get current session */
  async getSession() {
    const sb = getClient();
    if (!sb) return { data: { session: null } };
    return sb.auth.getSession();
  },

  /* Get current user */
  async getUser() {
    const { data } = await this.getSession();
    return data?.session?.user || null;
  },

  /* Listen to auth state changes */
  onAuthStateChange(callback) {
    const sb = getClient();
    if (!sb) return { data: { subscription: { unsubscribe: () => {} } } };
    return sb.auth.onAuthStateChange(callback);
  },
};

/* ============================================================
   PROFILE OPERATIONS
   ============================================================ */
const DVProfiles = {

  /* Get profile by user ID */
  async get(userId) {
    const sb = getClient();
    if (!sb) return { data: DEMO_DATA.profile, error: null };

    return sb.from('profiles').select('*').eq('id', userId).single();
  },

  /* Create or update profile */
  async upsert(profileData) {
    const sb = getClient();
    if (!sb) return { data: profileData, error: null };

    return sb.from('profiles').upsert(profileData, { onConflict: 'id' }).select().single();
  },

  /* Update specific fields */
  async update(userId, fields) {
    const sb = getClient();
    if (!sb) return { data: { id: userId, ...fields }, error: null };

    return sb.from('profiles').update(fields).eq('id', userId).select().single();
  },

  /* Upload verification document */
  async uploadVerificationDoc(userId, file) {
    const sb = getClient();
    if (!sb) return { data: { path: 'demo/doc.pdf' }, error: null };

    const ext  = file.name.split('.').pop();
    const path = `${userId}/verification.${ext}`;
    const { data, error } = await sb.storage
      .from('verification-docs')
      .upload(path, file, { upsert: true });

    if (error) return { data: null, error };

    // Save URL to profile
    const url = sb.storage.from('verification-docs').getPublicUrl(path).data.publicUrl;
    await this.update(userId, { verification_doc_url: url });
    return { data: { path, url }, error: null };
  },
};

/* ============================================================
   DATASET OPERATIONS
   ============================================================ */
const DVDatasets = {

  /* List datasets with optional filters */
  async list({ category, location, search, status = 'active', limit = 24, offset = 0 } = {}) {
    const sb = getClient();
    if (!sb) return { data: DEMO_DATA.datasets, error: null, count: DEMO_DATA.datasets.length };

    let q = sb.from('datasets')
      .select('*, profiles!datasets_seller_id_fkey(business_name, industry, verified)', { count: 'exact' })
      .eq('status', status)
      .gt('auction_end', new Date().toISOString())
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (category)  q = q.eq('category', category);
    if (location)  q = q.ilike('location', `%${location}%`);
    if (search)    q = q.or(`title.ilike.%${search}%,description.ilike.%${search}%,category.ilike.%${search}%`);

    return q;
  },

  /* Get single dataset with seller info */
  async get(id) {
    const sb = getClient();
    if (!sb) {
      const ds = DEMO_DATA.datasets.find(d => d.id === id) || DEMO_DATA.datasets[0];
      return { data: { ...ds, profiles: DEMO_DATA.profile }, error: null };
    }

    return sb.from('datasets')
      .select('*, profiles!datasets_seller_id_fkey(business_name, industry, city, state, verified)')
      .eq('id', id)
      .single();
  },

  /* Create a new dataset listing */
  async create(datasetData) {
    const sb = getClient();
    if (!sb) return { data: { id: 'demo_' + Date.now(), ...datasetData }, error: null };

    return sb.from('datasets').insert(datasetData).select().single();
  },

  /* Update dataset */
  async update(id, fields) {
    const sb = getClient();
    if (!sb) return { data: { id, ...fields }, error: null };

    return sb.from('datasets').update(fields).eq('id', id).select().single();
  },

  /* Upload encrypted dataset file */
  async uploadFile(sellerId, encryptedBlob, originalName) {
    const sb = getClient();
    if (!sb) return { data: { path: 'demo/dataset.enc', url: '#' }, error: null };

    const path = `${sellerId}/${Date.now()}_${originalName}.enc`;
    const { data, error } = await sb.storage
      .from('datasets')
      .upload(path, encryptedBlob, { contentType: 'application/octet-stream' });

    if (error) return { data: null, error };
    return { data: { path, url: path }, error: null };
  },

  /* Get seller's datasets */
  async getBySellerWithStats(sellerId) {
    const sb = getClient();
    if (!sb) return { data: DEMO_DATA.datasets, error: null };

    return sb.from('datasets')
      .select('*, bids(count)')
      .eq('seller_id', sellerId)
      .order('created_at', { ascending: false });
  },

  /* Get platform-wide stats for homepage */
  async getPlatformStats() {
    const sb = getClient();
    if (!sb) return { data: DEMO_DATA.stats, error: null };

    const { data, error } = await sb.rpc('get_platform_stats');
    if (error) return { data: DEMO_DATA.stats, error: null }; // Fall back to demo
    return { data, error: null };
  },
};

/* ============================================================
   BIDS OPERATIONS
   ============================================================ */
const DVBids = {

  /* Get all bids for a dataset */
  async getForDataset(datasetId) {
    const sb = getClient();
    if (!sb) return { data: DEMO_DATA.bids, error: null };

    return sb.from('bids')
      .select('*, profiles!bids_buyer_id_fkey(id)')
      .eq('dataset_id', datasetId)
      .eq('status', 'active')
      .order('amount', { ascending: false });
  },

  /* Place a bid */
  async place(datasetId, amount, buyerId, paymentIntentId) {
    const sb = getClient();
    if (!sb) {
      return {
        data: { id: 'bid_' + Date.now(), dataset_id: datasetId, amount, buyer_id: buyerId, status: 'active' },
        error: null,
      };
    }

    return sb.from('bids')
      .insert({ dataset_id: datasetId, amount, buyer_id: buyerId, payment_intent_id: paymentIntentId })
      .select()
      .single();
  },

  /* Get buyer's bid history */
  async getByBuyer(buyerId) {
    const sb = getClient();
    if (!sb) return { data: DEMO_DATA.bids, error: null };

    return sb.from('bids')
      .select('*, datasets(id, title, category, current_top_bid, auction_end, status)')
      .eq('buyer_id', buyerId)
      .order('created_at', { ascending: false });
  },

  /* Subscribe to real-time bid updates for a dataset */
  subscribeToDataset(datasetId, onNewBid) {
    const sb = getClient();
    if (!sb) return () => {};

    const channel = sb.channel(`bids:${datasetId}`)
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'bids',
        filter: `dataset_id=eq.${datasetId}`,
      }, payload => {
        onNewBid(payload.new);
      })
      .subscribe();

    // Return unsubscribe function
    return () => sb.removeChannel(channel);
  },

  /* Subscribe to dataset top_bid updates */
  subscribeToDatasetPrice(datasetId, onPriceUpdate) {
    const sb = getClient();
    if (!sb) return () => {};

    const channel = sb.channel(`dataset_price:${datasetId}`)
      .on('postgres_changes', {
        event:  'UPDATE',
        schema: 'public',
        table:  'datasets',
        filter: `id=eq.${datasetId}`,
      }, payload => {
        onPriceUpdate(payload.new);
      })
      .subscribe();

    return () => sb.removeChannel(channel);
  },
};

/* ============================================================
   TRANSACTIONS
   ============================================================ */
const DVTransactions = {

  /* Get buyer's purchased datasets */
  async getByBuyer(buyerId) {
    const sb = getClient();
    if (!sb) return { data: [], error: null };

    return sb.from('transactions')
      .select('*, datasets(id, title, category, file_url, encryption_key)')
      .eq('buyer_id', buyerId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false });
  },

  /* Get seller earnings */
  async getSellerEarnings(sellerId) {
    const sb = getClient();
    if (!sb) return { data: DEMO_DATA.earnings, error: null };

    return sb.from('transactions')
      .select('amount, platform_fee, seller_payout, created_at, datasets(title)')
      .eq('seller_id', sellerId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false });
  },
};

/* ============================================================
   DEMO DATA (shown when Supabase not configured)
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
    {
      id: 'demo-ds-1',
      title: 'Downtown Cafe Sales Data 2023–2024',
      description: '24 months of daily sales transactions, item-level breakdowns, and seasonal trends from a busy downtown Austin cafe. Includes 18,400+ individual transactions.',
      category: 'Retail Sales',
      location: 'Austin, TX',
      starting_bid: 200,
      reserve_price: 400,
      current_top_bid: 680,
      bid_count: 8,
      row_count: 18420,
      date_range_start: '2023-01-01',
      date_range_end: '2024-12-31',
      auction_end: new Date(Date.now() + 3.5 * 86400 * 1000).toISOString(),
      status: 'active',
      tags: ['sales', 'daily', 'beverage', 'Austin'],
      profiles: { business_name: "Rosa's Café", industry: 'Cafe', verified: true },
    },
    {
      id: 'demo-ds-2',
      title: 'Boutique Inventory & Pricing 2024',
      description: 'Complete inventory turnover, pricing history, and seasonal demand data from an independent boutique clothing store. Perfect for retail AI training.',
      category: 'Inventory',
      location: 'Nashville, TN',
      starting_bid: 150,
      reserve_price: 300,
      current_top_bid: 320,
      bid_count: 4,
      row_count: 5200,
      date_range_start: '2024-01-01',
      date_range_end: '2024-12-31',
      auction_end: new Date(Date.now() + 1.2 * 86400 * 1000).toISOString(),
      status: 'active',
      tags: ['inventory', 'fashion', 'pricing'],
      profiles: { business_name: 'Bella Boutique', industry: 'Retail', verified: true },
    },
    {
      id: 'demo-ds-3',
      title: 'Restaurant Foot Traffic & Orders Q1–Q3 2024',
      description: 'Hourly foot traffic counts, order frequency, and average ticket sizes across 9 months. Includes weather correlation data.',
      category: 'Foot Traffic',
      location: 'Chicago, IL',
      starting_bid: 300,
      reserve_price: 600,
      current_top_bid: 0,
      bid_count: 0,
      row_count: 9800,
      date_range_start: '2024-01-01',
      date_range_end: '2024-09-30',
      auction_end: new Date(Date.now() + 5 * 86400 * 1000).toISOString(),
      status: 'active',
      tags: ['foot-traffic', 'restaurant', 'Chicago'],
      profiles: { business_name: 'The Corner Kitchen', industry: 'Restaurant', verified: true },
    },
    {
      id: 'demo-ds-4',
      title: 'Auto Repair Shop Service History 2022–2024',
      description: '3 years of service records, parts pricing, labor hours, and customer return rates from a 5-bay auto repair shop. Anonymized customer IDs.',
      category: 'Services',
      location: 'Phoenix, AZ',
      starting_bid: 250,
      reserve_price: 500,
      current_top_bid: 410,
      bid_count: 5,
      row_count: 3100,
      date_range_start: '2022-01-01',
      date_range_end: '2024-12-31',
      auction_end: new Date(Date.now() + 2 * 86400 * 1000).toISOString(),
      status: 'active',
      tags: ['automotive', 'service', 'pricing'],
      profiles: { business_name: "Mike's Auto", industry: 'Auto Repair', verified: true },
    },
    {
      id: 'demo-ds-5',
      title: 'Local Grocery Pricing Survey 2024',
      description: 'Weekly price tracking for 200+ SKUs across 3 competing local grocery stores in the same neighborhood. Ideal for price elasticity research.',
      category: 'Local Pricing',
      location: 'Portland, OR',
      starting_bid: 180,
      reserve_price: 350,
      current_top_bid: 220,
      bid_count: 2,
      row_count: 10400,
      date_range_start: '2024-01-01',
      date_range_end: '2024-12-31',
      auction_end: new Date(Date.now() + 4 * 86400 * 1000).toISOString(),
      status: 'active',
      tags: ['pricing', 'grocery', 'competitive'],
      profiles: { business_name: 'FreshMarket Data Co', industry: 'Retail', verified: false },
    },
    {
      id: 'demo-ds-6',
      title: 'Hair Salon Customer Visit Patterns 2023',
      description: 'Appointment frequency, service types, seasonal patterns, and repeat customer rates from a 6-stylist salon. Fully anonymized.',
      category: 'Customer Demographics',
      location: 'Miami, FL',
      starting_bid: 120,
      reserve_price: 250,
      current_top_bid: 195,
      bid_count: 3,
      row_count: 4800,
      date_range_start: '2023-01-01',
      date_range_end: '2023-12-31',
      auction_end: new Date(Date.now() + 6 * 86400 * 1000).toISOString(),
      status: 'active',
      tags: ['beauty', 'appointments', 'demographics'],
      profiles: { business_name: 'Style Studio', industry: 'Hair Salon', verified: true },
    },
  ],

  bids: [
    { id: 'bid-1', dataset_id: 'demo-ds-1', amount: 680, buyer_id: 'buyer-a', created_at: new Date(Date.now() - 900000).toISOString(), status: 'active' },
    { id: 'bid-2', dataset_id: 'demo-ds-1', amount: 640, buyer_id: 'buyer-b', created_at: new Date(Date.now() - 3600000).toISOString(), status: 'active' },
    { id: 'bid-3', dataset_id: 'demo-ds-1', amount: 580, buyer_id: 'buyer-c', created_at: new Date(Date.now() - 7200000).toISOString(), status: 'active' },
  ],

  earnings: [
    { amount: 800, platform_fee: 40, seller_payout: 760, created_at: new Date(Date.now() - 7 * 86400000).toISOString(), datasets: { title: 'Cafe Sales 2022' } },
    { amount: 1200, platform_fee: 60, seller_payout: 1140, created_at: new Date(Date.now() - 14 * 86400000).toISOString(), datasets: { title: 'Inventory Q4 2022' } },
  ],
};

/* ============================================================
   EXPOSE GLOBALLY
   ============================================================ */
window.DVSupabase = {
  getClient,
  auth:         DVAuth,
  profiles:     DVProfiles,
  datasets:     DVDatasets,
  bids:         DVBids,
  transactions: DVTransactions,
  DEMO_DATA,
};
