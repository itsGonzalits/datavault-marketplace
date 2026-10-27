/* ============================================================
   Scheduled Function (every 15 minutes, see netlify.toml)
   Closes every auction whose timer has run out: charges the
   winner if the secret minimum was met, otherwise releases all
   holds. Also retries any close that was interrupted.
   ============================================================ */

const { getStore, connectBlobs, listJSON, setJSON } = require('../lib/blobs');
const { closeAuction } = require('../lib/market');

exports.handler = async (event) => {
  connectBlobs(event);
  const store = getStore('datasets');
  const all = await listJSON(store);
  const now = Date.now();
  let closed = 0;

  for (const ds of all) {
    try {
      // A close that crashed midway: put it back and try again
      if (ds.status === 'closing' && now - new Date(ds.closing_started_at || 0).getTime() > 10 * 60000) {
        ds.status = 'active';
        await setJSON(store, ds.id, ds);
      }
      if (ds.status === 'active' && new Date(ds.auction_end).getTime() <= now) {
        await closeAuction(ds.id);
        closed++;
      }
    } catch (err) {
      console.error('[close-expired-auctions] failed for', ds.id, err.message);
    }
  }

  console.log(`[close-expired-auctions] closed ${closed} auction(s)`);
  return { statusCode: 200, body: JSON.stringify({ closed }) };
};
