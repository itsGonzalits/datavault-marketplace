/* ============================================================
   Netlify Function: /close-auction   (seller only)
   POST { datasetId, acceptBelowMinimum? }

   "Sell now": ends the auction and charges the top bidder.
   If the top bid is under the secret minimum, the seller must
   confirm with acceptBelowMinimum: true — otherwise nothing sells
   and every bidder's hold is released.
   ============================================================ */

const { getStore, connectBlobs, getJSON } = require('../lib/blobs');
const { json, parseBody, getUser, cleanText, handler, httpError } = require('../lib/http');
const { closeAuction, publicDataset } = require('../lib/market');

exports.handler = handler(async (event, context) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  connectBlobs(event);

  const user = getUser(context);
  if (!user) throw httpError(401, 'Please sign in.');

  const body = parseBody(event);
  const datasetId = cleanText(body.datasetId, 64);
  const ds = datasetId ? await getJSON(getStore('datasets'), datasetId) : null;
  if (!ds) throw httpError(404, 'This listing could not be found.');
  if (ds.seller_id !== user.sub) throw httpError(403, 'Only the seller can end this auction.');
  if (ds.status !== 'active') throw httpError(400, 'This auction has already ended.');

  const result = await closeAuction(datasetId, { acceptBelowMinimum: body.acceptBelowMinimum === true });
  return json(200, {
    outcome: result.outcome,
    reason:  result.reason || null,
    dataset: publicDataset(result.dataset, user.sub),
    sold_price: result.transaction?.amount,
    payout:     result.transaction?.seller_payout,
  });
});
