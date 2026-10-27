/* ============================================================
   Netlify Function: /stats
   GET → real platform numbers for the homepage
   ============================================================ */

const { getStore, connectBlobs, listJSON } = require('../lib/blobs');
const { json, handler } = require('../lib/http');

exports.handler = handler(async (event) => {
  connectBlobs(event);
  const [datasets, txs] = await Promise.all([
    listJSON(getStore('datasets')),
    listJSON(getStore('transactions')),
  ]);
  const completed = txs.filter(t => t.status === 'completed');
  return json(200, {
    stats: {
      total_datasets:  datasets.length,
      live_auctions:   datasets.filter(d => d.status === 'active' && new Date(d.auction_end) > new Date()).length,
      total_sales:     completed.length,
      total_paid_out:  completed.reduce((s, t) => s + (t.seller_payout || 0), 0),
    },
  });
});
