/* ============================================================
   Netlify Blobs helper
   Connects the Lambda event to the Blobs runtime and returns
   strongly-consistent stores.

   An in-memory store is used ONLY when DV_ALLOW_MEMORY_STORE=1
   (local tests). In production a missing Blobs environment is a
   hard error — silently writing listings, bids and payments to
   memory would lose real customer data.
   ============================================================ */

const { getStore: rawGetStore, connectLambda } = require('@netlify/blobs');

function connectBlobs(event) {
  if (!event || !event.blobs) return;
  try {
    connectLambda(event);
  } catch (err) {
    console.warn('[blobs] connectLambda warning:', err.message);
  }
}

const inMemoryStores = new Map();

class MemoryStore {
  constructor(name) {
    if (!inMemoryStores.has(name)) inMemoryStores.set(name, new Map());
    this.items = inMemoryStores.get(name);
  }
  async get(key, options = {}) {
    const val = this.items.get(key);
    if (val === undefined || val === null) return null;
    if (options.type === 'arrayBuffer') {
      const buf = Buffer.isBuffer(val) ? val : Buffer.from(val);
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }
    return Buffer.isBuffer(val) ? val.toString('utf8') : val;
  }
  async set(key, value) {
    this.items.set(key, Buffer.isBuffer(value) ? Buffer.from(value) : value);
  }
  async list(options = {}) {
    const keys = Array.from(this.items.keys()).filter(k => !options.prefix || k.startsWith(options.prefix));
    return { blobs: keys.map(key => ({ key })) };
  }
  async delete(key) {
    this.items.delete(key);
  }
}

function getStore(name) {
  const opts = { name, consistency: 'strong' };
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token  = process.env.NETLIFY_BLOBS_TOKEN;
  if (siteID && token) {
    opts.siteID = siteID;
    opts.token  = token;
  }

  if (process.env.DV_ALLOW_MEMORY_STORE === '1') return new MemoryStore(name);
  return rawGetStore(opts);
}

/* Read a JSON blob, or null */
async function getJSON(store, key) {
  const raw = await store.get(key);
  return raw ? JSON.parse(raw) : null;
}

async function setJSON(store, key, value) {
  await store.set(key, JSON.stringify(value));
}

/* Read every JSON blob in a store */
async function listJSON(store) {
  const { blobs } = await store.list();
  const items = await Promise.all(blobs.map(b => getJSON(store, b.key).catch(() => null)));
  return items.filter(Boolean);
}

module.exports = { getStore, connectBlobs, getJSON, setJSON, listJSON, MemoryStore };
