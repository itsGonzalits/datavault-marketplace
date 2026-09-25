/* ============================================================
   Netlify Function: /capture-payment
   POST { paymentIntentId, datasetId, winnerId }

   Called by the seller when they choose to close the auction.
   1. Captures the Stripe PaymentIntent (charges the card)
   2. Updates bid → 'won' in Netlify Blobs
   3. Updates dataset → 'sold' in Netlify Blobs
   4. Creates a transaction record in Netlify Blobs

   Migrated from Supabase → Netlify Blobs.
   ============================================================ */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getStore, connectBlobs } = require('./_blobs');

const HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  connectBlobs(event);

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // Require Netlify Identity JWT
  const user = context.clientContext?.user;
  if (!user) {
    return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const { paymentIntentId, datasetId, winnerId } = JSON.parse(event.body || '{}');

    if (!paymentIntentId || !datasetId || !winnerId) {
      return {
        statusCode: 400,
        headers: HEADERS,
        body: JSON.stringify({ error: 'paymentIntentId, datasetId, and winnerId are required' }),
      };
    }

    const bidsStore         = getStore({ name: 'bids',         consistency: 'strong' });
    const datasetsStore     = getStore({ name: 'datasets',     consistency: 'strong' });
    const transactionsStore = getStore({ name: 'transactions', consistency: 'strong' });

    // 1. Load dataset (caller must be the seller)
    const dsRaw = await datasetsStore.get(datasetId);
    if (!dsRaw) return json(404, { error: 'Dataset not found' });
    const dataset = JSON.parse(dsRaw);

    if (dataset.seller_id !== user.sub) {
      return json(403, { error: 'Only the dataset seller can close the auction' });
    }
    if (dataset.status !== 'active') {
      return json(400, { error: `Cannot capture — dataset status is '${dataset.status}'` });
    }

    // 2. Capture the Stripe payment
    const paymentIntent = await stripe.paymentIntents.capture(paymentIntentId);
    const chargeId = paymentIntent.latest_charge;

    // 3. Update bids: mark winner 'won', others 'outbid'
    const bidsRaw = await bidsStore.get(datasetId);
    let winnerBid = null;
    if (bidsRaw) {
      const bids = JSON.parse(bidsRaw);
      const updated = bids.map(b => {
        if (b.payment_intent_id === paymentIntentId || b.buyer_id === winnerId) {
          winnerBid = { ...b, status: 'won' };
          return winnerBid;
        }
        return b.status === 'active' ? { ...b, status: 'outbid' } : b;
      });
      await bidsStore.set(datasetId, JSON.stringify(updated));
    }

    // 4. Mark dataset as sold
    dataset.status    = 'sold';
    dataset.winner_id = winnerId;
    await datasetsStore.set(datasetId, JSON.stringify(dataset));

    // 5. Create transaction record
    const amount = winnerBid?.amount || (paymentIntent.amount / 100);
    const tx = {
      id:               generateId(),
      dataset_id:       datasetId,
      bid_id:           winnerBid?.id || null,
      buyer_id:         winnerId,
      buyer_email:      winnerBid?.buyer_email || null,
      seller_id:        dataset.seller_id,
      amount,
      platform_fee:     amount * 0.05,
      seller_payout:    amount * 0.95,
      stripe_charge_id: chargeId || null,
      payment_intent_id: paymentIntentId,
      status:           'completed',
      dataset_title:    dataset.title,
      file_path:        dataset.file_path || null,
      encryption_key:   dataset.encryption_key || null,
      created_at:       new Date().toISOString(),
    };
    await transactionsStore.set(tx.id, JSON.stringify(tx));

    return json(200, {
      success:     true,
      chargeId,
      transaction: tx,
    });

  } catch (err) {
    console.error('[capture-payment]', err);
    return json(500, { error: err.message });
  }
};

function json(status, body) {
  return {
    statusCode: status,
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}
