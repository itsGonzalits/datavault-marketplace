/* ============================================================
   Netlify Function: /datasets
   GET  ?id=xxx          → get single dataset
   GET  ?seller_id=xxx   → get seller's datasets
   GET  ?status=active   → list datasets with filters
   POST (body)           → create dataset
   ============================================================ */

const { getStore } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
};

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  try {
    const store = getStore({ name: 'datasets', consistency: 'strong' });

    /* ── GET ── */
    if (event.httpMethod === 'GET') {
      const q = event.queryStringParameters || {};

      // Single dataset by ID
      if (q.id) {
        const raw = await store.get(q.id);
        if (!raw) return json(404, { error: 'Not found' });
        const dataset = JSON.parse(raw);
        return json(200, { dataset });
      }

      // List all datasets
      const { blobs } = await store.list();
      let datasets = await Promise.all(
        blobs.map(async b => {
          const raw = await store.get(b.key);
          return raw ? JSON.parse(raw) : null;
        })
      );
      datasets = datasets.filter(Boolean);

      // Filter by seller
      if (q.seller_id) {
        datasets = datasets.filter(d => d.seller_id === q.seller_id);
        return json(200, { datasets, count: datasets.length });
      }

      // Filter by status if specified
      if (q.status && q.status !== 'all') {
        datasets = datasets.filter(d => d.status === q.status);
      }

      // Default active filter: if no status or status is 'active', only show active & non-expired auctions
      if (!q.status || q.status === 'active') {
        const now = new Date().toISOString();
        datasets = datasets.filter(d =>
          d.status !== 'sold' && d.status !== 'cancelled' && d.auction_end > now
        );
      }

      // Search
      if (q.search) {
        const term = q.search.toLowerCase();
        datasets = datasets.filter(d =>
          d.title?.toLowerCase().includes(term) ||
          d.description?.toLowerCase().includes(term) ||
          d.category?.toLowerCase().includes(term) ||
          d.location?.toLowerCase().includes(term) ||
          d.country?.toLowerCase().includes(term)
        );
      }

      // Country filter
      if (q.country) {
        datasets = datasets.filter(d =>
          d.country?.toLowerCase() === q.country.toLowerCase() ||
          d.location?.toLowerCase().includes(q.country.toLowerCase())
        );
      }

      // Category filter
      if (q.category) {
        datasets = datasets.filter(d => d.category === q.category);
      }

      // Sort
      switch (q.sort) {
        case 'top-bid':    datasets.sort((a, b) => (b.current_top_bid || 0) - (a.current_top_bid || 0)); break;
        case 'ending':     datasets.sort((a, b) => a.auction_end.localeCompare(b.auction_end)); break;
        case 'most-bids':  datasets.sort((a, b) => (b.bid_count || 0) - (a.bid_count || 0)); break;
        default:           datasets.sort((a, b) => b.created_at.localeCompare(a.created_at));
      }

      const limit  = parseInt(q.limit  || '24', 10);
      const offset = parseInt(q.offset || '0',  10);
      const total  = datasets.length;
      datasets = datasets.slice(offset, offset + limit);

      return json(200, { datasets, count: total });
    }

    /* ── POST — Create dataset ── */
    if (event.httpMethod === 'POST') {
      const user = context.clientContext?.user;
      if (!user) return json(401, { error: 'Unauthorized' });

      const body    = JSON.parse(event.body || '{}');
      const id      = generateId();
      const dataset = {
        id,
        seller_id:        user.sub,
        seller_email:     user.email,
        title:            body.title,
        description:      body.description,
        category:         body.category,
        location:         body.location     || null,
        country:          body.country      || null,
        row_count:        body.row_count    || null,
        date_range_start: body.date_range_start || null,
        date_range_end:   body.date_range_end   || null,
        starting_bid:     body.starting_bid,
        reserve_price:    body.reserve_price,
        current_top_bid:  0,
        bid_count:        0,
        auction_end:      body.auction_end,
        status:           'active',
        file_path:        body.file_path    || null,
        encryption_key:   body.encryption_key || null,
        seller:           body.seller       || { business_name: user.email, verified: false },
        created_at:       new Date().toISOString(),
        ai_analysis:      body.ai_analysis  || null,
      };

      await store.set(id, JSON.stringify(dataset));
      return json(201, { dataset });
    }

    return json(405, { error: 'Method not allowed' });

  } catch (err) {
    console.error('[datasets]', err);
    return json(500, { error: err.message });
  }
};

/* ── Helpers ── */
function json(status, body) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}
