/* ============================================================
   Netlify Function: /stripe-webhook
   Keeps bid records in step with Stripe:
     payment_intent.canceled → the bid's hold is gone
   Sales themselves are recorded by closeAuction(), so a captured
   payment is never counted twice.
   ============================================================ */

const { getStore, connectBlobs, getJSON, setJSON } = require('../lib/blobs');
const { stripe } = require('../lib/market');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  connectBlobs(event);

  const sig     = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : event.body;

  let stripeEvent;
  try {
    stripeEvent = stripe().webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe-webhook] signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  try {
    if (stripeEvent.type === 'payment_intent.canceled') {
      const pi = stripeEvent.data.object;
      const datasetId = pi.metadata?.datasetId;
      if (datasetId) {
        const store = getStore('bids');
        const bids = (await getJSON(store, datasetId)) || [];
        const bid = bids.find(b => b.payment_intent_id === pi.id);
        // A hold that expired or was cancelled outside DataVault can't win any more
        if (bid && bid.status === 'active') {
          bid.status = 'cancelled';
          await setJSON(store, datasetId, bids);
        }
      }
    }
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    console.error('[stripe-webhook] handler error:', err);
    return { statusCode: 500, body: 'Internal Server Error' };
  }
};
