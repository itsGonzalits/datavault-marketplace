/* ============================================================
   Shared HTTP helpers for Netlify Functions
   ============================================================ */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
};

function json(status, body) {
  return {
    statusCode: status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function preflight(event) {
  return event.httpMethod === 'OPTIONS' ? { statusCode: 204, headers: CORS, body: '' } : null;
}

/* Parse a JSON request body; returns {} for empty and throws a 400-able error for junk */
function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error('Invalid JSON body');
    err.status = 400;
    throw err;
  }
}

/* Netlify Identity user verified by Netlify from the Bearer JWT */
function getUser(context) {
  return context?.clientContext?.user || null;
}

/* Trim + cap a user-supplied string */
function cleanText(value, max = 200) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);
}

function cleanMultiline(value, max = 5000) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ').trim().slice(0, max);
}

function generateId() {
  return Date.now().toString(36) + require('crypto').randomBytes(5).toString('hex');
}

/* Wrap a handler with OPTIONS handling + uniform error responses */
function handler(fn) {
  return async (event, context) => {
    const pre = preflight(event);
    if (pre) return pre;
    try {
      return await fn(event, context);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[function error]', err);
      return json(status, { error: status >= 500 ? 'Something went wrong on our side. Please try again.' : err.message });
    }
  };
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = { CORS, json, preflight, parseBody, getUser, cleanText, cleanMultiline, generateId, handler, httpError };
