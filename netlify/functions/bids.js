/* ============================================================
   Netlify Function: /bids
   GET  ?dataset_id=xxx → bid history for a listing (anonymous)
   GET  ?mine=true      → the signed-in buyer's bids
   POST { dataset_id, payment_intent_id }
        → record a bid. The amount comes from the Stripe card hold,
          which must already be authorized for this buyer + listing.
   ============================================================ */

const { getStore, connectBlobs, getJSON, setJSON, listJSON } = require('../lib/blobs');
const { json, parseBody, getUser, cleanText, generateId, handler, httpError } = require('../lib/http');
const { stripe, minNextBid, isOpenForBids, publicBids, publicDataset, releaseHold, notifyOutbid, round2 } = require('../lib/market');

exports.handler = handler(async (event, context) => {
  connectBlobs(event);
  const bidsStore     = getStore('bids');
  const datasetsStore = getStore('datasets');
  const user = getUser(context);
  const q = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    if (q.dataset_id) {
      const bids = (await getJSON(bidsStore, q.dataset_id)) || [];
      return json(200, { bids: publicBids(bids, user?.sub) });
    }

    if (q.mine) {
      if (!user) throw httpError(401, 'Please sign in.');
      const { blobs } = await bidsStore.list();
      const mine = [];
      for (const b of blobs) {
        const list = (await getJSON(bidsStore, b.key)) || [];
        const own = list.filter(bid => bid.buyer_id === user.sub && bid.status !== 'replaced');
        if (!own.length) continue;
        const ds = await getJSON(datasetsStore, b.key);
        const pub = ds ? publicDataset(ds, user.sub) : null;
        for (const bid of own) {
          mine.push({
            id:              bid.id,
            dataset_id:      bid.dataset_id,
            amount:          bid.amount,
            status:          bid.status,
            created_at:      bid.created_at,
            dataset_title:   pub?.title || 'Listing removed',
            dataset_status:  pub?.status || 'ended',
            current_top_bid: pub?.current_top_bid || 0,
            min_next_bid:    pub?.min_next_bid || 0,
            auction_end:     pub?.auction_end || null,
          });
        }
      }
      mine.sort((a, b) => b.created_at.localeCompare(a.created_at));
      return json(200, { bids: mine });
    }

    throw httpError(400, 'dataset_id or mine is required');
  }

  if (event.httpMethod === 'POST') {
    if (!user) throw httpError(401, 'Please sign in to bid.');
    const body = parseBody(event);
    const datasetId       = cleanText(body.dataset_id, 64);
    const paymentIntentId = cleanText(body.payment_intent_id, 100);
    if (!datasetId || !paymentIntentId) throw httpError(400, 'dataset_id and payment_intent_id are required');

    const ds = await getJSON(datasetsStore, datasetId);
    if (!ds) throw httpError(404, 'This listing could not be found.');

    const bids = (await getJSON(bidsStore, datasetId)) || [];
    if (bids.some(b => b.payment_intent_id === paymentIntentId)) {
      return json(200, { bid: bids.find(b => b.payment_intent_id === paymentIntentId), dataset: publicDataset(ds, user.sub) });
    }

    // The card hold is the source of truth for who is bidding and how much
    const pi = await stripe().paymentIntents.retrieve(paymentIntentId).catch(() => null);
    const amount = round2((pi?.amount || 0) / 100);
    const piOk = pi && pi.status === 'requires_capture'
      && pi.metadata?.datasetId === datasetId
      && pi.metadata?.buyerId === user.sub;
    if (!piOk) throw httpError(400, 'We could not confirm the hold on your card. Please try again.');

    const reject = async (msg) => { await releaseHold(pi.id); throw httpError(400, msg); };
    if (!isOpenForBids(ds))           await reject('Sorry — this auction has already ended. Your card was not charged.');
    if (ds.seller_id === user.sub)    await reject('You can\'t bid on your own listing.');
    if (amount < minNextBid(ds))      await reject(`Someone just bid higher. The new minimum is $${minNextBid(ds).toFixed(2)} — your card was not charged.`);

    const previous = bids.filter(b => b.status === 'active');
    const bid = {
      id:                generateId(),
      dataset_id:        datasetId,
      buyer_id:          user.sub,
      buyer_email:       user.email,
      amount,
      payment_intent_id: pi.id,
      status:            'active',
      created_at:        new Date().toISOString(),
    };
    for (const p of previous) p.status = p.buyer_id === user.sub ? 'replaced' : 'outbid';
    bids.push(bid);
    await setJSON(bidsStore, datasetId, bids);

    ds.current_top_bid = amount;
    ds.bid_count = bids.filter(b => b.status !== 'replaced').length;
    // Anti-sniping: a bid in the last 5 minutes extends the auction by 5 minutes
    const msLeft = new Date(ds.auction_end).getTime() - Date.now();
    if (msLeft < 5 * 60000) ds.auction_end = new Date(Date.now() + 5 * 60000).toISOString();
    await setJSON(datasetsStore, datasetId, ds);

    // Release the holds of everyone who is no longer on top
    for (const p of previous) {
      await releaseHold(p.payment_intent_id);
      if (p.status === 'outbid') await notifyOutbid(ds, p);
    }

    return json(201, { bid: publicBids([bid], user.sub)[0], dataset: publicDataset(ds, user.sub) });
  }

  return json(405, { error: 'Method not allowed' });
});
