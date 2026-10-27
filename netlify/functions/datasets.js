/* ============================================================
   Netlify Function: /datasets
   GET  ?id=xxx      → one listing (public view)
   GET  ?mine=true   → the signed-in seller's listings
   GET  (filters)    → live auctions: search, category (comma list),
                       country, sort = ending | newest | top-bid | most-bids
   POST (body)       → create a listing (signed in)
   ============================================================ */

const { getStore, connectBlobs, getJSON, setJSON, listJSON } = require('../lib/blobs');
const { json, parseBody, getUser, cleanText, cleanMultiline, generateId, handler, httpError } = require('../lib/http');
const { publicDataset, isOpenForBids, MAX_AUCTION_DAYS, MIN_AUCTION_DAYS, round2 } = require('../lib/market');

exports.handler = handler(async (event, context) => {
  connectBlobs(event);
  const store = getStore('datasets');
  const user  = getUser(context);

  if (event.httpMethod === 'GET') {
    const q = event.queryStringParameters || {};

    if (q.id) {
      const ds = await getJSON(store, q.id);
      if (!ds) return json(404, { error: 'This listing could not be found.' });
      return json(200, { dataset: publicDataset(ds, user?.sub) });
    }

    let datasets = await listJSON(store);

    if (q.mine) {
      if (!user) throw httpError(401, 'Please sign in.');
      datasets = datasets
        .filter(d => d.seller_id === user.sub)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map(d => publicDataset(d, user.sub));
      return json(200, { datasets, count: datasets.length });
    }

    datasets = datasets.filter(isOpenForBids);

    if (q.search) {
      const term = q.search.toLowerCase();
      datasets = datasets.filter(d =>
        [d.title, d.description, d.category, d.location, d.country]
          .some(v => v && String(v).toLowerCase().includes(term)));
    }
    if (q.country) {
      const c = q.country.toLowerCase();
      datasets = datasets.filter(d =>
        (d.country || '').toLowerCase() === c || (d.location || '').toLowerCase().includes(c));
    }
    if (q.category) {
      const cats = q.category.split(',').map(s => s.trim()).filter(Boolean);
      if (cats.length) datasets = datasets.filter(d => cats.includes(d.category));
    }

    switch (q.sort) {
      case 'top-bid':   datasets.sort((a, b) => (b.current_top_bid || 0) - (a.current_top_bid || 0)); break;
      case 'most-bids': datasets.sort((a, b) => (b.bid_count || 0) - (a.bid_count || 0)); break;
      case 'newest':    datasets.sort((a, b) => b.created_at.localeCompare(a.created_at)); break;
      default:          datasets.sort((a, b) => a.auction_end.localeCompare(b.auction_end));
    }

    const limit  = Math.min(Math.max(parseInt(q.limit || '24', 10) || 24, 1), 100);
    const offset = Math.max(parseInt(q.offset || '0', 10) || 0, 0);
    const total  = datasets.length;
    return json(200, {
      datasets: datasets.slice(offset, offset + limit).map(d => publicDataset(d, user?.sub)),
      count: total,
    });
  }

  if (event.httpMethod === 'POST') {
    if (!user) throw httpError(401, 'Please sign in to list your data.');
    const body = parseBody(event);

    const title       = cleanText(body.title, 120);
    const description = cleanMultiline(body.description, 4000);
    const category    = cleanText(body.category, 60);
    const startingBid = round2(body.starting_bid);
    const reserve     = round2(body.reserve_price || body.starting_bid);
    const days        = Math.min(Math.max(parseInt(body.auction_days, 10) || 5, MIN_AUCTION_DAYS), MAX_AUCTION_DAYS);

    if (!title)       throw httpError(400, 'Please give your listing a title.');
    if (!description) throw httpError(400, 'Please add a short description.');
    if (!category)    throw httpError(400, 'Please choose a category.');
    if (!(startingBid >= 10))   throw httpError(400, 'The starting price must be at least $10.');
    if (startingBid > 1000000)  throw httpError(400, 'The starting price is too high.');
    if (!(reserve >= startingBid)) throw httpError(400, 'Your secret minimum must be at least the starting price.');

    // The uploaded file must belong to this seller
    const filePath = cleanText(body.file_path, 300);
    if (!filePath || !filePath.startsWith(`${user.sub}/`)) throw httpError(400, 'Please upload your file first.');
    const file = await getJSON(getStore('file-index'), filePath);
    if (!file) throw httpError(400, 'We could not find your uploaded file. Please upload it again.');

    // Seller details come from their profile, not from the browser
    const profile = (await getJSON(getStore('profiles'), user.sub)) || {};

    const id = generateId();
    const dataset = {
      id,
      seller_id:        user.sub,
      seller_email:     user.email,
      title,
      description,
      category,
      location:         cleanText(body.location, 120) || null,
      country:          cleanText(body.country, 60) || null,
      row_count:        parseInt(body.row_count, 10) > 0 ? parseInt(body.row_count, 10) : null,
      date_range_start: cleanText(body.date_range_start, 10) || null,
      date_range_end:   cleanText(body.date_range_end, 10) || null,
      starting_bid:     startingBid,
      reserve_price:    reserve,
      current_top_bid:  0,
      bid_count:        0,
      auction_end:      new Date(Date.now() + days * 86400000).toISOString(),
      status:           'active',
      file_path:        filePath,
      file_name:        file.original_name,
      file_type:        (file.original_name.split('.').pop() || '').toUpperCase().slice(0, 6) || null,
      ai_analysis:      sanitizeAnalysis(body.ai_analysis),
      seller: {
        business_name: profile.business_name || 'Local business',
        industry:      profile.industry || null,
        verified:      profile.verified === true,
      },
      created_at:       new Date().toISOString(),
    };

    await setJSON(store, id, dataset);
    return json(201, { dataset: publicDataset(dataset, user.sub) });
  }

  return json(405, { error: 'Method not allowed' });
});

/* Keep only the shape the listing page renders, as plain capped strings */
function sanitizeAnalysis(a) {
  if (!a || typeof a !== 'object') return null;
  const highlights = Array.isArray(a.highlights) ? a.highlights.slice(0, 6).map(h => cleanText(h, 240)).filter(Boolean) : [];
  const columns = Array.isArray(a.columns) ? a.columns.slice(0, 40).map(c => ({
    name:        cleanText(c?.name, 60),
    type:        cleanText(c?.type, 30),
    description: cleanText(c?.description, 160),
    sample:      cleanText(c?.sample, 60),
  })).filter(c => c.name) : [];
  if (!highlights.length && !columns.length) return null;
  return { highlights, columns };
}
