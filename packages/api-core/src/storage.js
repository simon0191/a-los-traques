import fs from 'node:fs';
import path from 'node:path';

const BUNDLE_TTL_DAYS = 7;

/**
 * Validate storage path components to prevent path traversal.
 */
function validatePathComponent(value, name) {
  const str = String(value);
  if (str.includes('..') || str.includes('/') || str.includes('\\')) {
    throw new Error(`Invalid ${name}: ${str}`);
  }
  return str;
}

/**
 * Build storage key for a debug bundle.
 */
function buildKey(fightId, slot, round) {
  const safeFightId = validatePathComponent(fightId, 'fightId');
  const safeSlot = validatePathComponent(slot, 'slot');
  const safeRound = validatePathComponent(round, 'round');
  return `${safeFightId}/p${safeSlot}_round${safeRound}.json`;
}

// ---------------------------------------------------------------------------
// Local filesystem backend
// ---------------------------------------------------------------------------

const LOCAL_BASE = path.join(process.cwd(), 'tmp', 'debug-bundles');

const localBackend = {
  async uploadBundle(fightId, slot, round, jsonString) {
    const key = buildKey(fightId, slot, round);
    const filePath = path.join(LOCAL_BASE, key);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, jsonString, 'utf-8');
  },

  async downloadBundle(fightId, slot, round) {
    const key = buildKey(fightId, slot, round);
    const filePath = path.join(LOCAL_BASE, key);
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }
  },

  async deleteBundles(fightId) {
    const safeFightId = validatePathComponent(fightId, 'fightId');
    const dirPath = path.join(LOCAL_BASE, safeFightId);
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
    } catch {
      // Directory may not exist
    }
  },

  async listBundles(fightId) {
    const safeFightId = validatePathComponent(fightId, 'fightId');
    const dirPath = path.join(LOCAL_BASE, safeFightId);
    try {
      const files = fs.readdirSync(dirPath);
      return files
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          const match = f.match(/^p(\d+)_round(\d+)\.json$/);
          if (!match) return null;
          return {
            slot: Number.parseInt(match[1], 10),
            round: Number.parseInt(match[2], 10),
            key: `${safeFightId}/${f}`,
          };
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  },
};

// ---------------------------------------------------------------------------
// Supabase Storage backend
// ---------------------------------------------------------------------------

let supabaseClient;

function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for supabase storage');
  }

  // Dynamic import would be cleaner but we need sync access
  // eslint-disable-next-line
  const { createClient } = require('@supabase/supabase-js');
  supabaseClient = createClient(url, serviceKey);
  return supabaseClient;
}

const BUCKET = 'debug-bundles';

const supabaseBackend = {
  async uploadBundle(fightId, slot, round, jsonString) {
    const key = buildKey(fightId, slot, round);
    const client = getSupabaseClient();
    const { error } = await client.storage.from(BUCKET).upload(key, jsonString, {
      contentType: 'application/json',
      upsert: true,
    });
    if (error) throw new Error(`Supabase upload failed: ${error.message}`);
  },

  async downloadBundle(fightId, slot, round) {
    const key = buildKey(fightId, slot, round);
    const client = getSupabaseClient();
    const { data, error } = await client.storage.from(BUCKET).download(key);
    if (error) return null;
    return await data.text();
  },

  async deleteBundles(fightId) {
    const safeFightId = validatePathComponent(fightId, 'fightId');
    const client = getSupabaseClient();
    const { data: files } = await client.storage.from(BUCKET).list(safeFightId);
    if (files && files.length > 0) {
      const paths = files.map((f) => `${safeFightId}/${f.name}`);
      await client.storage.from(BUCKET).remove(paths);
    }
  },

  async listBundles(fightId) {
    const safeFightId = validatePathComponent(fightId, 'fightId');
    const client = getSupabaseClient();
    const { data: files } = await client.storage.from(BUCKET).list(safeFightId);
    if (!files) return [];
    return files
      .filter((f) => f.name.endsWith('.json'))
      .map((f) => {
        const match = f.name.match(/^p(\d+)_round(\d+)\.json$/);
        if (!match) return null;
        return {
          slot: Number.parseInt(match[1], 10),
          round: Number.parseInt(match[2], 10),
          key: `${safeFightId}/${f.name}`,
        };
      })
      .filter(Boolean);
  },
};

// ---------------------------------------------------------------------------
// Export the active backend
// ---------------------------------------------------------------------------

function getBackend() {
  const backend = process.env.STORAGE_BACKEND || 'local';
  if (backend === 'supabase') return supabaseBackend;
  return localBackend;
}

export const storage = {
  uploadBundle: (...args) => getBackend().uploadBundle(...args),
  downloadBundle: (...args) => getBackend().downloadBundle(...args),
  deleteBundles: (...args) => getBackend().deleteBundles(...args),
  listBundles: (...args) => getBackend().listBundles(...args),
};

export { BUNDLE_TTL_DAYS, validatePathComponent };
