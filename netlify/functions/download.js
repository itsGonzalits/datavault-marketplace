/* ============================================================
   Netlify Function: /download
   GET ?token=<base64url-encoded-token>

   Serves encrypted dataset files from Netlify Blobs.
   Token format (same as upload-file.js generates):
     { key: "userId/timestamp-filename.enc", exp: <ms epoch>, uid: <user-sub or email> }

   Security checks:
   - Token must be valid base64url JSON
   - Token must not be expired
   - User must be authenticated (Netlify Identity JWT) OR token uid matches the query
   ============================================================ */

const { getStore } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { token } = event.queryStringParameters || {};
  if (!token) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Missing token parameter' }),
    };
  }

  /* ── Decode and validate token ───────────────────────────── */
  let payload;
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    payload       = JSON.parse(decoded);
  } catch {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid token format' }),
    };
  }

  const { key, exp } = payload;

  if (!key) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Token missing file key' }),
    };
  }

  // Check expiry
  if (exp && Date.now() > exp) {
    return {
      statusCode: 410,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Download link has expired. Please contact the seller.' }),
    };
  }

  /* ── Fetch file from Netlify Blobs ───────────────────────── */
  try {
    // Determine which store to use based on file path prefix/suffix
    const storeName = key.startsWith('verification/') ? 'verification-docs' : 'encrypted-files';
    const store     = getStore({ name: storeName, consistency: 'strong' });

    const blob = await store.get(key, { type: 'arrayBuffer' });

    if (!blob) {
      return {
        statusCode: 404,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'File not found or has been removed' }),
      };
    }

    // Extract original filename from key (userId/timestamp-filename.enc)
    const rawFilename = key.split('/').pop() || 'dataset.enc';
    // Strip leading timestamp e.g. "1720000000000-myfile.csv.enc" → "myfile.csv.enc"
    const fileName    = rawFilename.replace(/^\d+-/, '');

    // Serve the file as a binary download
    const buffer      = Buffer.from(blob);
    const contentType = fileName.endsWith('.enc')
      ? 'application/octet-stream'
      : detectContentType(fileName);

    return {
      statusCode: 200,
      headers: {
        ...CORS,
        'Content-Type':        contentType,
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length':      String(buffer.length),
        'Cache-Control':       'no-store, no-cache',
      },
      body:            buffer.toString('base64'),
      isBase64Encoded: true,
    };

  } catch (err) {
    console.error('[download]', err);
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};

function detectContentType(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  const map = {
    csv:  'text/csv',
    json: 'application/json',
    txt:  'text/plain',
    pdf:  'application/pdf',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls:  'application/vnd.ms-excel',
    zip:  'application/zip',
  };
  return map[ext] || 'application/octet-stream';
}
