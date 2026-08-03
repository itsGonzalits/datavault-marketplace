/* ============================================================
   Netlify Function: /bids
   GET  ?dataset_id=xxx → bids for a dataset
   GET  ?my_bids=true   → current user's bids
   POST (body)          → place a bid
   ============================================================ */

const { getStore } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  try {
    const bidsStore    = getStore({ name: 'bids',    consistency: 'strong' });
    const datasetsStore = getStore({ name: 'datasets', consistency: 'strong' });
    const q = event.queryStringParameters || {};

    /* ── GET ── */
    if (event.httpMethod === 'GET') {

      // All bids for a dataset
      if (q.dataset_id) {
        const raw = await bidsStore.get(q.dataset_id);
        const bids = raw ? JSON.parse(raw) : [];
        return json(200, { bids: bids.sort((a, b) => b.amount - a.amount) });
      }

      // Current user's bids (across all datasets)
      if (q.my_bids && context.clientContext?.user) {
        const userId = context.clientContext.user.sub;
        const { blobs } = await bidsStore.list();
        const all = await Promise.all(blobs.map(async b => {
          const raw = await bidsStore.get(b.key);
          return raw ? JSON.parse(raw) : [];
        }));
        const myBids = all.flat().filter(bid => bid.buyer_id === userId);
        return json(200, { bids: myBids.sort((a, b) => b.created_at.localeCompare(a.created_at)) });
      }

      return json(400, { error: 'dataset_id or my_bids required' });
    }

    /* ── POST — Place bid ── */
    if (event.httpMethod === 'POST') {
      const user = context.clientContext?.user;
      if (!user) return json(401, { error: 'Must be logged in to bid' });

      const body = JSON.parse(event.body || '{}');
      const { dataset_id, amount, payment_intent_id } = body;

      if (!dataset_id || !amount) return json(400, { error: 'dataset_id and amount required' });

      // Validate against dataset
      const dsRaw = await datasetsStore.get(dataset_id);
      if (!dsRaw) return json(404, { error: 'Dataset not found' });
      const dataset = JSON.parse(dsRaw);

      if (dataset.status !== 'active') return json(400, { error: 'Auction is not active' });
      if (new Date(dataset.auction_end) < new Date()) return json(400, { error: 'Auction has ended' });
      if (amount <= (dataset.current_top_bid || dataset.starting_bid || 0) - 0.01)
        return json(400, { error: `Bid must exceed current top bid of $${dataset.current_top_bid}` });

      // Save bid
      const existing = await bidsStore.get(dataset_id);
      const bids = existing ? JSON.parse(existing) : [];
      const bid = {
        id:                generateId(),
        dataset_id,
        buyer_id:          user.sub,
        buyer_email:       user.email,
        amount:            parseFloat(amount),
        payment_intent_id: payment_intent_id || null,
        status:            'active',
        created_at:        new Date().toISOString(),
      };
      bids.push(bid);
      await bidsStore.set(dataset_id, JSON.stringify(bids));

      // Update dataset's top bid
      dataset.current_top_bid = parseFloat(amount);
      dataset.bid_count = bids.filter(b => b.status === 'active').length;
      await datasetsStore.set(dataset_id, JSON.stringify(dataset));

      return json(201, { bid });
    }

    return json(405, { error: 'Method not allowed' });

  } catch (err) {
    console.error('[bids]', err);
    return json(500, { error: err.message });
  }
};

function json(status, body) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}
