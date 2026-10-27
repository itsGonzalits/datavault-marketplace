/* ============================================================
   Netlify Function: /profile
   GET   → the signed-in user's own profile
   GET   ?user_id=xxx → someone's PUBLIC profile (name, area, verified)
   POST  → create or update your own profile
   PATCH → same as POST (kept for older pages)

   Users can only edit safe fields. "verified" is only ever set by
   the document check in upload-file.js.
   ============================================================ */

const { getStore, connectBlobs, getJSON, setJSON } = require('../lib/blobs');
const { json, parseBody, getUser, cleanText, handler, httpError } = require('../lib/http');

const EDITABLE = {
  full_name: 100, business_name: 100, industry: 60,
  city: 60, state: 60, country: 60, payout_email: 120, payout_details: 300,
};

exports.handler = handler(async (event, context) => {
  connectBlobs(event);
  const store = getStore('profiles');
  const user  = getUser(context);
  const q     = event.queryStringParameters || {};

  if (event.httpMethod === 'GET') {
    if (q.user_id && q.user_id !== user?.sub) {
      const p = await getJSON(store, q.user_id);
      return json(200, { profile: p ? publicProfile(p) : null });
    }
    if (!user) throw httpError(401, 'Please sign in.');
    return json(200, { profile: await getJSON(store, user.sub) });
  }

  if (event.httpMethod === 'POST' || event.httpMethod === 'PATCH') {
    if (!user) throw httpError(401, 'Please sign in.');
    const body = parseBody(event);
    const existing = (await getJSON(store, user.sub)) || {};

    const profile = {
      ...existing,
      id:         user.sub,
      email:      user.email,
      role:       'both', // every account can buy and sell
      verified:   existing.verified === true,
      created_at: existing.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    // Older pages sent paypal_email
    if (body.paypal_email !== undefined && body.payout_email === undefined) body.payout_email = body.paypal_email;
    for (const [field, max] of Object.entries(EDITABLE)) {
      if (body[field] !== undefined) profile[field] = cleanText(body[field], max);
    }
    if (profile.payout_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.payout_email)) {
      throw httpError(400, 'Please enter a valid payout email address.');
    }
    if (!profile.business_name && !profile.full_name) throw httpError(400, 'Please enter your name or business name.');

    await setJSON(store, user.sub, profile);
    return json(200, { profile });
  }

  return json(405, { error: 'Method not allowed' });
});

function publicProfile(p) {
  return {
    id: p.id, business_name: p.business_name, industry: p.industry,
    city: p.city, state: p.state, country: p.country, verified: p.verified === true,
  };
}
