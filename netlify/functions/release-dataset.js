/* ============================================================
   Netlify Function: /release-dataset
   POST { datasetId, buyerEmail, buyerName }

   Called after payment is captured to deliver the dataset
   to the winning buyer via email (Resend API).

   Flow:
   1. Fetch dataset record from Netlify Blobs
   2. Build a time-limited signed download token
   3. Send email with download link + decryption key via Resend
   4. Mark dataset status as 'sold' (if not already)

   Migrated from Supabase → Netlify Blobs.
   ============================================================ */

const { getStore, connectBlobs } = require('./_blobs');

const HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }

  connectBlobs(event);

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // Must be called by an authenticated user (seller or system)
  const user = context.clientContext?.user;
  if (!user) {
    return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const { datasetId, buyerEmail, buyerName } = JSON.parse(event.body || '{}');

    if (!datasetId || !buyerEmail) {
      return json(400, { error: 'datasetId and buyerEmail are required' });
    }

    const resendApiKey = process.env.RESEND_API_KEY;

    // 1. Fetch dataset from Netlify Blobs
    const datasetsStore = getStore({ name: 'datasets', consistency: 'strong' });
    const dsRaw         = await datasetsStore.get(datasetId);
    if (!dsRaw) return json(404, { error: 'Dataset not found' });
    const dataset = JSON.parse(dsRaw);

    // 2. Generate a 48-hour download token (same format as upload-file.js)
    const expiresAt     = Date.now() + 48 * 3600 * 1000;
    const tokenPayload  = JSON.stringify({ key: dataset.file_path, exp: expiresAt, uid: buyerEmail });
    const downloadToken = Buffer.from(tokenPayload).toString('base64url');

    // Build the absolute download URL. Netlify Identity's site URL or a fallback.
    const siteUrl       = process.env.URL || 'https://datavault-marketplace.netlify.app';
    const downloadUrl   = `${siteUrl}/.netlify/functions/download?token=${downloadToken}`;

    // 3. Send delivery email via Resend
    if (resendApiKey) {
      const emailHtml = buildEmailHtml({
        buyerName:   buyerName || 'Valued Buyer',
        title:       dataset.title,
        downloadUrl,
        decryptKey:  dataset.encryption_key || '(no encryption key — plain file)',
      });

      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from:    'DataVault <noreply@datavault-marketplace.com>',
          to:      [buyerEmail],
          subject: `Your Dataset is Ready: ${dataset.title}`,
          html:    emailHtml,
        }),
      });

      if (!resendRes.ok) {
        const errText = await resendRes.text();
        console.error('[release-dataset] Resend error:', errText);
        // Don't throw — still mark sold and return success so seller isn't stuck
      }
    } else {
      console.warn('[release-dataset] RESEND_API_KEY not set — skipping email delivery');
    }

    // 4. Mark dataset as sold if not already
    if (dataset.status !== 'sold') {
      dataset.status = 'sold';
      await datasetsStore.set(datasetId, JSON.stringify(dataset));
    }

    return json(200, { success: true, downloadUrl });

  } catch (err) {
    console.error('[release-dataset]', err);
    return json(500, { error: err.message });
  }
};

/* ── Email template ─────────────────────────────────────────── */
function buildEmailHtml({ buyerName, title, downloadUrl, decryptKey }) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Dataset is Ready</title>
</head>
<body style="font-family: 'Segoe UI', Arial, sans-serif; background: #f0fdf4; margin: 0; padding: 40px 20px;">
  <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #0D9488, #059669); padding: 40px 40px 32px; text-align: center;">
      <div style="font-size: 40px; margin-bottom: 8px;">🔐</div>
      <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">DataVault</h1>
      <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">Your data purchase is confirmed</p>
    </div>
    
    <!-- Body -->
    <div style="padding: 40px;">
      <h2 style="color: #0f172a; font-size: 20px; margin: 0 0 16px;">Congratulations, ${escapeHtml(buyerName)}! 🎉</h2>
      <p style="color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
        You've successfully won the auction for <strong style="color: #0f172a;">${escapeHtml(title)}</strong>. 
        Your dataset is ready to download below.
      </p>
      
      <!-- Download Button -->
      <div style="text-align: center; margin: 32px 0;">
        <a href="${downloadUrl}" style="display: inline-block; background: linear-gradient(135deg, #0D9488, #059669); color: #ffffff; font-weight: 700; font-size: 16px; text-decoration: none; padding: 16px 40px; border-radius: 12px; box-shadow: 0 4px 12px rgba(13,148,136,0.35);">
          ⬇ Download Dataset
        </a>
      </div>
      
      <!-- Expiry Note -->
      <div style="background: #fef9c3; border: 1px solid #fde047; border-radius: 10px; padding: 16px 20px; margin: 0 0 28px;">
        <p style="color: #854d0e; font-size: 13px; margin: 0;">
          ⏰ <strong>Important:</strong> This download link expires in <strong>48 hours</strong>. 
          Please download and save the file before it expires.
        </p>
      </div>
      
      <!-- Decryption Key -->
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px;">
        <p style="color: #64748b; font-size: 13px; font-weight: 600; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.05em;">🔑 Decryption Key</p>
        <code style="display: block; background: #0f172a; color: #4ade80; font-size: 13px; padding: 12px 16px; border-radius: 8px; word-break: break-all; font-family: 'Courier New', monospace;">${escapeHtml(decryptKey)}</code>
        <p style="color: #94a3b8; font-size: 12px; margin: 10px 0 0;">Keep this key safe — it is required to decrypt and open the file.</p>
      </div>
    </div>
    
    <!-- Footer -->
    <div style="background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 24px 40px; text-align: center;">
      <p style="color: #94a3b8; font-size: 12px; margin: 0;">
        Thank you for using <strong>DataVault</strong>. Questions? Reply to this email or visit our <a href="https://datavault-marketplace.netlify.app/faq.html" style="color: #0D9488;">Help Center</a>.
      </p>
    </div>
    
  </div>
</body>
</html>
  `.trim();
}

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
