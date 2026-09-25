/* ============================================================
   Netlify Function: /profile
   GET   ?user_id=xxx  → get profile
   POST  (body)        → create/upsert profile
   PATCH (body)        → update profile fields
   ============================================================ */

const { getStore, connectBlobs } = require('./_blobs');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
};

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  connectBlobs(event);

  try {
    const store = getStore({ name: 'profiles', consistency: 'strong' });
    const q = event.queryStringParameters || {};

    /* ── GET ── */
    if (event.httpMethod === 'GET') {
      const userId = q.user_id || context.clientContext?.user?.sub;
      if (!userId) return json(400, { error: 'user_id required' });

      const raw = await store.get(userId);
      const profile = raw ? JSON.parse(raw) : null;
      return json(200, { profile });
    }

    /* ── POST — Create/upsert ── */
    if (event.httpMethod === 'POST') {
      const user = context.clientContext?.user;
      if (!user) return json(401, { error: 'Unauthorized' });

      const body = JSON.parse(event.body || '{}');
      const raw  = await store.get(user.sub);
      const existing = raw ? JSON.parse(raw) : {};

      const profile = {
        id:                  user.sub,
        email:               user.email,
        full_name:           body.full_name      || existing.full_name    || '',
        role:                body.role            || existing.role         || 'buyer',
        business_name:       body.business_name  || existing.business_name || '',
        industry:            body.industry        || existing.industry      || '',
        city:                body.city            || existing.city          || '',
        state:               body.state           || existing.state         || '',
        country:             body.country         || existing.country       || '',
        verified:            existing.verified    || false,
        paypal_email:        body.paypal_email    || existing.paypal_email  || null,
        verification_doc_url: body.verification_doc_url || existing.verification_doc_url || null,
        stripe_connect_id:   existing.stripe_connect_id || null,
        created_at:          existing.created_at || new Date().toISOString(),
        updated_at:          new Date().toISOString(),
      };

      await store.set(user.sub, JSON.stringify(profile));
      return json(200, { profile });
    }

    /* ── PATCH — Update specific fields ── */
    if (event.httpMethod === 'PATCH') {
      const user = context.clientContext?.user;
      if (!user) return json(401, { error: 'Unauthorized' });

      const body = JSON.parse(event.body || '{}');
      const raw  = await store.get(user.sub);
      if (!raw) return json(404, { error: 'Profile not found' });

      const existing = JSON.parse(raw);
      const updated  = { ...existing, ...body, id: user.sub, updated_at: new Date().toISOString() };
      await store.set(user.sub, JSON.stringify(updated));
      return json(200, { profile: updated });
    }

    return json(405, { error: 'Method not allowed' });

  } catch (err) {
    console.error('[profile]', err);
    return json(500, { error: err.message });
  }
};

function json(status, body) {
  return { statusCode: status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
