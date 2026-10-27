/* ============================================================
   Netlify Function: /download?dataset_id=xxx   (signed in)

   Gives the winning buyer (or the listing's seller) the ORIGINAL
   file — decrypted here, so it opens like any normal spreadsheet.
   Nobody else can download, and the key never leaves the server.
   ============================================================ */

const crypto = require('crypto');
const { getStore, connectBlobs, getJSON } = require('../lib/blobs');
const { json, getUser, cleanText, handler, httpError } = require('../lib/http');

const SALT_BYTES = 16;
const IV_BYTES   = 12;
const TAG_BYTES  = 16;

exports.handler = handler(async (event, context) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  connectBlobs(event);

  const user = getUser(context);
  if (!user) throw httpError(401, 'Please sign in to download.');

  const datasetId = cleanText((event.queryStringParameters || {}).dataset_id, 64);
  if (!datasetId) throw httpError(400, 'dataset_id is required');

  const ds = await getJSON(getStore('datasets'), datasetId);
  if (!ds) throw httpError(404, 'This listing could not be found.');

  const isSeller = ds.seller_id === user.sub;
  const isWinner = ds.status === 'sold' && ds.winner_id === user.sub;
  if (!isSeller && !isWinner) throw httpError(403, 'Only the buyer who won this auction can download it.');

  const file = ds.file_path ? await getJSON(getStore('file-index'), ds.file_path) : null;
  const blob = file ? await getStore('encrypted-files').get(ds.file_path, { type: 'arrayBuffer' }) : null;
  if (!file || !blob) throw httpError(404, 'The file is missing. Please contact support and we will sort it out.');

  const data = Buffer.from(blob);
  let plain;
  try {
    const key        = Buffer.from(file.encryption_key, 'base64');
    const iv         = data.subarray(SALT_BYTES, SALT_BYTES + IV_BYTES);
    const tag        = data.subarray(data.length - TAG_BYTES);
    const ciphertext = data.subarray(SALT_BYTES + IV_BYTES, data.length - TAG_BYTES);
    const decipher   = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (err) {
    console.error('[download] decrypt failed for', datasetId, err.message);
    throw httpError(500, 'The file could not be opened. Please contact support.');
  }

  const fileName = (file.original_name || 'dataset').replace(/["\r\n]/g, '');
  return {
    statusCode: 200,
    headers: {
      'Content-Type':        contentTypeFor(fileName),
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control':       'no-store',
    },
    body: plain.toString('base64'),
    isBase64Encoded: true,
  };
});

function contentTypeFor(name) {
  const ext = name.split('.').pop()?.toLowerCase();
  return {
    csv: 'text/csv', json: 'application/json', txt: 'text/plain', pdf: 'application/pdf',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel', zip: 'application/zip', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  }[ext] || 'application/octet-stream';
}
