/* ============================================================
   Netlify Function: /stripe-webhook
   Handles Stripe webhook events for auction completion flow.
   Migrated from Supabase → Netlify Blobs.

   Events handled:
     payment_intent.succeeded → mark bid 'won', dataset 'sold', create transaction
     payment_intent.canceled  → mark matching bid 'cancelled'
   ============================================================ */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getStore, connectBlobs } = require('./_blobs');

exports.handler = async (event) => {
  connectBlobs(event);

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const sig           = event.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;
  try {
    // Verify the webhook signature using the raw body
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, endpointSecret);
  } catch (err) {
    console.error(`[stripe-webhook] Signature verification failed: ${err.message}`);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  try {
    switch (stripeEvent.type) {

      /* ── Payment succeeded — auction winner confirmed ─────── */
      case 'payment_intent.succeeded': {
        const pi         = stripeEvent.data.object;
        const datasetId  = pi.metadata?.datasetId;
        const buyerEmail = pi.metadata?.buyerEmail;

        if (!datasetId) {
          console.warn('[stripe-webhook] payment_intent.succeeded missing datasetId metadata');
          break;
        }

        const bidsStore         = getStore({ name: 'bids',         consistency: 'strong' });
        const datasetsStore     = getStore({ name: 'datasets',     consistency: 'strong' });
        const transactionsStore = getStore({ name: 'transactions', consistency: 'strong' });

        // 1. Find and update the winning bid
        const bidsRaw = await bidsStore.get(datasetId);
        if (bidsRaw) {
          const bids = JSON.parse(bidsRaw);
          let winnerBid = null;

          // Mark the bid matching this payment intent as 'won', others as 'outbid'
          const updated = bids.map(b => {
            if (b.payment_intent_id === pi.id) {
              winnerBid = { ...b, status: 'won' };
              return winnerBid;
            }
            return b.status === 'active' ? { ...b, status: 'outbid' } : b;
          });

          await bidsStore.set(datasetId, JSON.stringify(updated));

          // 2. Update dataset to 'sold'
          const dsRaw = await datasetsStore.get(datasetId);
          if (dsRaw) {
            const ds = JSON.parse(dsRaw);
            ds.status    = 'sold';
            ds.winner_id = winnerBid?.buyer_id || null;
            await datasetsStore.set(datasetId, JSON.stringify(ds));

            // 3. Create transaction record
            const tx = {
              id:              generateId(),
              dataset_id:      datasetId,
              bid_id:          winnerBid?.id || null,
              buyer_id:        winnerBid?.buyer_id || null,
              buyer_email:     buyerEmail || winnerBid?.buyer_email || null,
              seller_id:       ds.seller_id,
              amount:          winnerBid?.amount || (pi.amount / 100),
              platform_fee:    (winnerBid?.amount || (pi.amount / 100)) * 0.05,
              seller_payout:   (winnerBid?.amount || (pi.amount / 100)) * 0.95,
              stripe_charge_id: pi.latest_charge || null,
              payment_intent_id: pi.id,
              status:          'completed',
              dataset_title:   ds.title,
              file_path:       ds.file_path || null,
              encryption_key:  ds.encryption_key || null,
              created_at:      new Date().toISOString(),
            };
            await transactionsStore.set(tx.id, JSON.stringify(tx));
            console.log(`[stripe-webhook] Transaction created: ${tx.id} for dataset ${datasetId}`);
          }
        }

        console.log(`[stripe-webhook] payment_intent.succeeded processed for dataset ${datasetId}`);
        break;
      }

      /* ── Payment cancelled — release the hold ─────────────── */
      case 'payment_intent.canceled': {
        const pi        = stripeEvent.data.object;
        const datasetId = pi.metadata?.datasetId;

        if (!datasetId) break;

        const bidsStore = getStore({ name: 'bids', consistency: 'strong' });
        const bidsRaw   = await bidsStore.get(datasetId);
        if (bidsRaw) {
          const bids    = JSON.parse(bidsRaw);
          const updated = bids.map(b =>
            b.payment_intent_id === pi.id ? { ...b, status: 'cancelled' } : b
          );
          await bidsStore.set(datasetId, JSON.stringify(updated));
        }

        console.log(`[stripe-webhook] payment_intent.canceled for dataset ${datasetId}`);
        break;
      }

      default:
        console.log(`[stripe-webhook] Unhandled event type: ${stripeEvent.type}`);
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };

  } catch (err) {
    console.error('[stripe-webhook] Handler error:', err);
    return { statusCode: 500, body: 'Internal Server Error' };
  }
};

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}
