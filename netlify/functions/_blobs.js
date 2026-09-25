/* ============================================================
   Netlify Blobs Helper Module
   Ensures Lambda compatibility by connecting event context
   and supporting optional siteID/token fallback.
   ============================================================ */

const { getStore: rawGetStore, connectLambda } = require('@netlify/blobs');

/**
 * Connects Lambda event to Netlify Blobs runtime context.
 * Must be called in handler for Lambda-compatible functions.
 */
function connectBlobs(event) {
  if (event && event.blobs) {
    try {
      connectLambda(event);
      if (process.env.NETLIFY_BLOBS_CONTEXT) {
        try {
          const ctx = JSON.parse(Buffer.from(process.env.NETLIFY_BLOBS_CONTEXT, 'base64').toString('utf8'));
          if (ctx.edgeURL && !ctx.uncachedEdgeURL) {
            ctx.uncachedEdgeURL = ctx.uncached_url || ctx.edgeURL;
            process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify(ctx)).toString('base64');
          }
        } catch (_) {}
      }
    } catch (err) {
      console.warn('[blobs] connectLambda warning:', err.message);
    }
  }
}

const inMemoryStores = new Map();

class MemoryStore {
  constructor(name) {
    this.name = name;
    if (!inMemoryStores.has(name)) {
      inMemoryStores.set(name, new Map());
    }
    this.items = inMemoryStores.get(name);
  }

  async get(key, options = {}) {
    const val = this.items.get(key);
    if (val === undefined || val === null) return null;
    if (options.type === 'arrayBuffer') {
      if (Buffer.isBuffer(val)) {
        return val.buffer.slice(val.byteOffset, val.byteOffset + val.byteLength);
      }
      return Buffer.from(val).buffer;
    }
    if (Buffer.isBuffer(val)) {
      return val.toString('utf8');
    }
    return typeof val === 'string' ? val : JSON.stringify(val);
  }

  async set(key, value) {
    this.items.set(key, value);
  }

  async setJSON(key, value) {
    this.items.set(key, JSON.stringify(value));
  }

  async list() {
    const keys = Array.from(this.items.keys());
    return { blobs: keys.map(k => ({ key: k })) };
  }

  async delete(key) {
    this.items.delete(key);
  }
}

/**
 * Safely gets a Blobs store with strong consistency by default,
 * using either injected Lambda context or environment variables.
 */
function getStore(options) {
  const opts = typeof options === 'string' ? { name: options } : { ...options };
  if (!opts.consistency) {
    opts.consistency = 'strong';
  }

  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN;

  if (siteID && token && !opts.siteID && !opts.token) {
    opts.siteID = siteID;
    opts.token = token;
  }

  try {
    return rawGetStore(opts);
  } catch (err) {
    if (
      err.name === 'MissingBlobsEnvironmentError' ||
      err.message?.includes('environment has not been configured')
    ) {
      return new MemoryStore(opts.name);
    }
    throw err;
  }
}

module.exports = {
  getStore,
  connectBlobs,
  connectLambda,
  MemoryStore,
};

