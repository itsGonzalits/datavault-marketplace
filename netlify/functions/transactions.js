/* ============================================================
   Netlify Function: /transactions   (signed in, read-only)
   GET ?role=buyer  → things you bought
   GET ?role=seller → things you sold (your earnings)
   Transactions are only ever created by closing an auction.
   ============================================================ */

const { getStore, connectBlobs, listJSON } = require('../lib/blobs');
const { json, getUser, handler, httpError } = require('../lib/http');

exports.handler = handler(async (event, context) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  connectBlobs(event);

  const user = getUser(context);
  if (!user) throw httpError(401, 'Please sign in.');

  const role = (event.queryStringParameters || {}).role;
  const all  = await listJSON(getStore('transactions'));
  const mine = all.filter(t =>
    role === 'buyer'  ? t.buyer_id === user.sub :
    role === 'seller' ? t.seller_id === user.sub :
    t.buyer_id === user.sub || t.seller_id === user.sub);

  const transactions = mine
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(t => ({
      id:            t.id,
      dataset_id:    t.dataset_id,
      dataset_title: t.dataset_title,
      amount:        t.amount,
      platform_fee:  t.seller_id === user.sub ? t.platform_fee : undefined,
      seller_payout: t.seller_id === user.sub ? t.seller_payout : undefined,
      payout_status: t.seller_id === user.sub ? (t.payout_status || 'pending') : undefined,
      role:          t.seller_id === user.sub ? 'seller' : 'buyer',
      status:        t.status,
      created_at:    t.created_at,
    }));

  return json(200, { transactions });
});
