/* ============================================================
   Netlify Function: /transactions
   GET ?role=buyer  → buyer's purchased datasets
   GET ?role=seller → seller's earnings
   POST             → create transaction (internal use only)
   ============================================================ */

const { getStore, connectBlobs } = require('./_blobs');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  connectBlobs(event);

  try {
    const user = context.clientContext?.user;
    if (!user) return json(401, { error: 'Unauthorized' });

    const store = getStore({ name: 'transactions', consistency: 'strong' });
    const q     = event.queryStringParameters || {};

    /* ── GET ── */
    if (event.httpMethod === 'GET') {
      const { blobs } = await store.list();
      const all = await Promise.all(blobs.map(async b => {
        const raw = await store.get(b.key);
        return raw ? JSON.parse(raw) : null;
      }));
      const txs = all.filter(Boolean);

      let filtered;
      if (q.role === 'buyer') {
        filtered = txs.filter(t => t.buyer_id === user.sub && t.status === 'completed');
      } else if (q.role === 'seller') {
        filtered = txs.filter(t => t.seller_id === user.sub);
      } else {
        filtered = txs.filter(t => t.buyer_id === user.sub || t.seller_id === user.sub);
      }

      filtered.sort((a, b) => b.created_at.localeCompare(a.created_at));
      return json(200, { transactions: filtered });
    }

    /* ── POST — Create transaction ── */
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const id   = generateId();
      const tx   = {
        id,
        dataset_id:      body.dataset_id,
        bid_id:          body.bid_id,
        buyer_id:        body.buyer_id,
        seller_id:       body.seller_id,
        amount:          parseFloat(body.amount),
        platform_fee:    parseFloat(body.amount) * 0.05,
        seller_payout:   parseFloat(body.amount) * 0.95,
        stripe_charge_id: body.stripe_charge_id || null,
        status:          body.status || 'pending',
        dataset_title:   body.dataset_title,
        file_path:       body.file_path || null,
        encryption_key:  body.encryption_key || null,
        created_at:      new Date().toISOString(),
      };

      await store.set(id, JSON.stringify(tx));
      return json(201, { transaction: tx });
    }

    return json(405, { error: 'Method not allowed' });

  } catch (err) {
    console.error('[transactions]', err);
    return json(500, { error: err.message });
  }
};

function json(status, body) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}
