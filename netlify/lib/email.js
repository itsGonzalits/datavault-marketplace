/* ============================================================
   Transactional email via Resend.
   Every send is best-effort: a failed email never blocks a sale.
   Env: RESEND_API_KEY, RESEND_FROM (a sender on a domain you
   verified in Resend), ADMIN_EMAIL (gets a copy of every sale so
   you know which seller to pay out).
   ============================================================ */

function siteUrl() {
  return (process.env.URL || 'https://datavault-marketplace.netlify.app').replace(/\/$/, '');
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function money(n) {
  return '$' + Number(n || 0).toFixed(2);
}

/* One simple, friendly layout for every email */
function layout({ heading, paragraphs = [], button }) {
  const body = paragraphs.map(p => `<p style="color:#44403c;font-size:16px;line-height:1.6;margin:0 0 16px;">${p}</p>`).join('');
  const btn = button
    ? `<p style="text-align:center;margin:28px 0;"><a href="${escapeHtml(button.url)}" style="display:inline-block;background:#F97316;color:#fff;font-weight:700;font-size:16px;text-decoration:none;padding:14px 32px;border-radius:999px;">${escapeHtml(button.label)}</a></p>`
    : '';
  return `<!DOCTYPE html><html><body style="margin:0;padding:32px 16px;background:#FFFBF5;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;border:1px solid #E7E5E4;overflow:hidden;">
    <div style="background:#0D9488;padding:20px 28px;color:#fff;font-size:20px;font-weight:700;">🔐 DataVault</div>
    <div style="padding:28px;">
      <h1 style="font-size:22px;color:#1C1917;margin:0 0 16px;">${heading}</h1>
      ${body}${btn}
    </div>
    <div style="padding:16px 28px;border-top:1px solid #E7E5E4;color:#78716C;font-size:13px;">
      Questions? Just reply to this email or visit <a href="${siteUrl()}/faq.html" style="color:#0D9488;">our Help Center</a>.
    </div>
  </div></body></html>`;
}

async function sendEmail({ to, subject, heading, paragraphs, button }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !to) {
    if (!apiKey) console.warn('[email] RESEND_API_KEY not set — skipped:', subject);
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'DataVault <noreply@datavault-marketplace.com>',
        to: Array.isArray(to) ? to : [to],
        subject,
        html: layout({ heading, paragraphs, button }),
      }),
    });
    if (!res.ok) console.error('[email] Resend error:', res.status, await res.text());
    return res.ok;
  } catch (err) {
    console.error('[email] send failed:', err.message);
    return false;
  }
}

module.exports = { sendEmail, escapeHtml, money, siteUrl };
