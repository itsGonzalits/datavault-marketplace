/* ============================================================
   Netlify Function: /create-payment-intent
   POST { datasetId, amount }   (amount in DOLLARS)

   Creates a card HOLD (manual capture) for a bid. Nothing is
   charged unless this bid wins when the auction closes.
   ============================================================ */

const { getStore, connectBlobs, getJSON } = require('../lib/blobs');
const { json, parseBody, getUser, cleanText, handler, httpError } = require('../lib/http');
const { stripe, minNextBid, isOpenForBids, round2 } = require('../lib/market');

exports.handler = handler(async (event, context) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  connectBlobs(event);

  const user = getUser(context);
  if (!user) throw httpError(401, 'Please sign in to bid.');

  const body      = parseBody(event);
  const datasetId = cleanText(body.datasetId, 64);
  const amount    = round2(body.amount);
  if (!datasetId || !(amount > 0)) throw httpError(400, 'Please enter a bid amount.');

  const ds = await getJSON(getStore('datasets'), datasetId);
  if (!ds) throw httpError(404, 'This listing could not be found.');
  if (!isOpenForBids(ds)) throw httpError(400, 'Sorry — this auction has already ended.');
  if (ds.seller_id === user.sub) throw httpError(400, 'You can\'t bid on your own listing.');
  const min = minNextBid(ds);
  if (amount < min) throw httpError(400, `Your bid must be at least $${min.toFixed(2)}.`);
  if (amount > 999999) throw httpError(400, 'That bid is too large.');

  const pi = await stripe().paymentIntents.create({
    amount:               Math.round(amount * 100),
    currency:             'usd',
    capture_method:       'manual',
    payment_method_types: ['card'], // cards + Apple Pay / Google Pay wallets
    receipt_email:        user.email,
    description:          `DataVault bid: ${String(ds.title).slice(0, 80)}`,
    metadata:             { datasetId, buyerId: user.sub, buyerEmail: user.email, source: 'datavault_bid' },
  });

  return json(200, { clientSecret: pi.client_secret, paymentIntentId: pi.id, amount });
});
