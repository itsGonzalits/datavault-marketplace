/* ============================================================
   Netlify Function: /upload-file   (signed in)
   POST multipart/form-data:
     - file            the file (datasets arrive already encrypted)
     - name            original filename
     - type            'dataset' | 'verification'
     - encryption_key  (datasets) the AES key, kept server-side and
                       used only to hand the winning buyer a normal file
     - doc_type        (verification) kind of business document
   Returns: { path } for datasets, { verified, status, note } for documents
   ============================================================ */

const { getStore, connectBlobs, getJSON, setJSON } = require('../lib/blobs');
const { json, getUser, cleanText, handler, httpError } = require('../lib/http');
const { sendEmail, escapeHtml } = require('../lib/email');

// Netlify functions accept request bodies up to ~6 MB
const MAX_BYTES = 5.5 * 1024 * 1024;

exports.handler = handler(async (event, context) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  connectBlobs(event);

  const user = getUser(context);
  if (!user) throw httpError(401, 'Please sign in first.');

  const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!contentType.includes('multipart/form-data') || !boundaryMatch) throw httpError(400, 'Expected a file upload.');

  const bodyBuffer = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : Buffer.from(event.body || '', 'binary');
  const fields = {};
  let fileBuffer = null;
  let fileName = 'file';
  for (const part of parseMultipart(bodyBuffer, boundaryMatch[1] || boundaryMatch[2])) {
    if (part.name === 'file') { fileBuffer = part.data; fileName = part.filename || fileName; }
    else fields[part.name] = part.data.toString('utf8');
  }
  if (!fileBuffer || !fileBuffer.length) throw httpError(400, 'No file was received. Please try again.');
  if (fileBuffer.length > MAX_BYTES) throw httpError(413, 'That file is too large. Please keep files under 5 MB.');

  fileName = safeFileName(fields.name || fileName);
  const uploadType = fields.type === 'verification' ? 'verification' : 'dataset';
  const fileKey = `${user.sub}/${Date.now()}-${fileName}`;

  /* ── Dataset file ── */
  if (uploadType === 'dataset') {
    const encryptionKey = cleanText(fields.encryption_key, 100);
    if (!/^[A-Za-z0-9+/=]{40,64}$/.test(encryptionKey)) throw httpError(400, 'The file could not be secured. Please try again.');
    await getStore('encrypted-files').set(fileKey, fileBuffer);
    await setJSON(getStore('file-index'), fileKey, {
      key:            fileKey,
      owner_id:       user.sub,
      original_name:  fileName,
      size:           fileBuffer.length,
      encryption_key: encryptionKey,
      uploaded_at:    new Date().toISOString(),
    });
    return json(200, { path: fileKey });
  }

  /* ── Business verification document ── */
  await getStore('verification-docs').set(fileKey, fileBuffer);
  const docType = cleanText(fields.doc_type, 40);
  const check = await verifyDocumentWithAI(fileBuffer, fileName, docType, user);

  const profiles = getStore('profiles');
  const profile = (await getJSON(profiles, user.sub)) || { id: user.sub, email: user.email, role: 'both', created_at: new Date().toISOString() };
  profile.verified             = check.verified;
  profile.verification_status  = check.verified ? 'verified' : 'pending_review';
  profile.verification_doc     = fileKey;
  profile.verification_details = check.details;
  profile.verified_at          = check.verified ? new Date().toISOString() : null;
  profile.updated_at           = new Date().toISOString();
  await setJSON(profiles, user.sub, profile);

  if (!check.verified && process.env.ADMIN_EMAIL) {
    await sendEmail({
      to: process.env.ADMIN_EMAIL,
      subject: `[DataVault] Verification needs review: ${user.email}`,
      heading: 'A seller document needs a manual look',
      paragraphs: [
        `Seller: ${escapeHtml(user.email)} (${escapeHtml(user.sub)})`,
        `Document: ${escapeHtml(fileKey)} in the "verification-docs" blob store.`,
        `Automatic check: ${escapeHtml(check.note)}`,
      ],
    });
  }

  return json(200, { verified: check.verified, status: profile.verification_status, note: check.note });
});

function safeFileName(name) {
  const base = String(name).split(/[\\/]/).pop().replace(/[^A-Za-z0-9._ -]/g, '_').replace(/\s+/g, ' ').trim();
  return (base || 'file').slice(0, 100);
}

/* ── Automated AI Document Verification ── */
async function verifyDocumentWithAI(fileBuffer, fileName, docType, user) {
  const apiKey = process.env.GEMINI_API_KEY;
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  let mimeType = 'application/pdf';
  if (['jpg', 'jpeg'].includes(ext)) mimeType = 'image/jpeg';
  else if (ext === 'png') mimeType = 'image/png';
  else if (ext === 'webp') mimeType = 'image/webp';

  // Without a confident automatic check, a person reviews the document
  const pending = (note) => ({ verified: false, note, details: { method: 'manual_review' } });
  if (!apiKey) return pending('Received — our team will review it within 1 business day.');
  if (!(['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(ext))) return pending('Received — our team will review it within 1 business day.');

  {
    try {
      const base64Data = fileBuffer.toString('base64');
      const prompt = `You are an automated KYC compliance auditor for DataVault Marketplace.
Analyze this official business document (such as an EIN confirmation letter, business registration certificate, license, tax document, or utility bill).
Document type reported: ${docType || 'Business Document'}.
Set is_valid to false and confidence low if the image is not a business document, is unreadable, or looks edited.

Verify whether this looks like an authentic business or tax document.
Respond ONLY with a valid JSON object matching this schema:
{
  "is_valid": true,
  "confidence": 0.95,
  "detected_business_name": "Name on document or empty string if not detected",
  "doc_type": "EIN Letter | Business License | Tax Document | Utility Bill | Other",
  "note": "A concise 1-sentence verification summary"
}`;

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Data
                }
              }
            ]
          }],
          generationConfig: {
            response_mime_type: 'application/json'
          }
        })
      });

      if (res.ok) {
        const jsonRes = await res.json();
        const text = jsonRes.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          const parsed = JSON.parse(text);
          const ok = parsed.is_valid === true && Number(parsed.confidence) >= 0.75;
          return {
            verified: ok,
            note: ok ? 'Your business document was verified.' : 'We couldn\'t confirm this automatically, so our team will review it within 1 business day.',
            details: { method: 'gemini', doc_type: cleanText(parsed.doc_type, 60), confidence: Number(parsed.confidence) || 0, detected_business_name: cleanText(parsed.detected_business_name, 100) },
          };
        }
      } else {
        console.warn('[upload-file] Gemini API status:', res.status);
      }
    } catch (aiErr) {
      console.warn('[upload-file] Gemini AI verification error, falling back to rule engine:', aiErr.message);
    }
  }

  return pending('Received — our team will review it within 1 business day.');
}

/* ── Minimal multipart parser ── */
function parseMultipart(buffer, boundary) {
  const parts  = [];
  const sep    = Buffer.from('--' + boundary);
  const end    = Buffer.from('--' + boundary + '--');
  let   offset = 0;

  while (offset < buffer.length) {
    const start = indexOf(buffer, sep, offset);
    if (start === -1) break;
    offset = start + sep.length + 2; // skip \r\n

    if (buffer.slice(start, start + end.length).equals(end)) break;

    // Find headers end (\r\n\r\n)
    const headersEnd = indexOf(buffer, Buffer.from('\r\n\r\n'), offset);
    if (headersEnd === -1) break;

    const headersRaw = buffer.slice(offset, headersEnd).toString();
    offset = headersEnd + 4;

    // Find next boundary
    const nextBound = indexOf(buffer, sep, offset);
    const dataEnd   = nextBound === -1 ? buffer.length : nextBound - 2; // -2 for \r\n

    const data = buffer.slice(offset, dataEnd);

    // Parse headers
    const dispositionMatch = headersRaw.match(/Content-Disposition:.*?name="([^"]+)"(?:.*?filename="([^"]+)")?/is);
    if (dispositionMatch) {
      parts.push({
        name:     dispositionMatch[1],
        filename: dispositionMatch[2] || null,
        data,
      });
    }

    offset = nextBound === -1 ? buffer.length : nextBound;
  }

  return parts;
}

function indexOf(buf, search, start = 0) {
  return buf.indexOf(search, start);
}
