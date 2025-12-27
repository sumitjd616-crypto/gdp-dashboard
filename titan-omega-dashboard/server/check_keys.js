import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const REST_BASE_URL = 'https://api.polygon.io';

function parseKeyRing() {
  const raw = process.env.MASSIVE_API_KEYS || process.env.POLYGON_API_KEYS || process.env.MASSIVE_API_KEY || process.env.POLYGON_API_KEY || '';
  const keys = String(raw)
    .split(/[\n,\s]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
  return Array.from(new Set(keys));
}

function maskKey(k) {
  const s = String(k || '');
  if (!s) return null;
  return `****${s.slice(-4)}`;
}

function parseKeysFromDotEnvFile() {
  // Fallback to support users pasting multiple raw keys on separate lines in .env
  // e.g.
  // MASSIVE_API_KEYS=key1
  // key2
  // key3
  try {
    const p = path.join(process.cwd(), '.env');
    const raw = fs.readFileSync(p, 'utf8');
    const lines = raw.split(/\r?\n/);
    const out = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (trimmed.includes('=')) {
        const [k, v] = trimmed.split('=', 2);
        if (k === 'MASSIVE_API_KEYS' || k === 'POLYGON_API_KEYS') {
          out.push(
            ...String(v || '')
              .split(/[\n,\s]+/g)
              .map((s) => s.trim())
              .filter(Boolean)
          );
        } else if (k === 'MASSIVE_API_KEY' || k === 'POLYGON_API_KEY') {
          if (v) out.push(String(v).trim());
        }
        continue;
      }
      // Bare token line (likely pasted key)
      if (/^[A-Za-z0-9_]{20,}$/.test(trimmed)) out.push(trimmed);
    }
    return Array.from(new Set(out));
  } catch {
    return [];
  }
}

async function fetchJson(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.status === 'ERROR') {
    const msg = data?.error || data?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function probeKeyOnce(key) {
  const caps = {
    indicesPrev: false,
    optionsSpySnapshot: false,
  };

  try {
    await fetchJson(`${REST_BASE_URL}/v2/aggs/ticker/I:SPX/prev?apiKey=${encodeURIComponent(key)}`);
    caps.indicesPrev = true;
  } catch {
    caps.indicesPrev = false;
  }

  try {
    await fetchJson(`${REST_BASE_URL}/v3/snapshot/options/SPY?limit=1&apiKey=${encodeURIComponent(key)}`);
    caps.optionsSpySnapshot = true;
  } catch {
    caps.optionsSpySnapshot = false;
  }

  const ok = Boolean(caps.indicesPrev && caps.optionsSpySnapshot);
  return { ok, caps };
}

async function main() {
  const keys = (() => {
    const fromEnv = parseKeyRing();
    if (fromEnv.length >= 2) return fromEnv;
    const fromFile = parseKeysFromDotEnvFile();
    return fromFile.length ? fromFile : fromEnv;
  })();
  if (!keys.length) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: false, error: 'No keys found in MASSIVE_API_KEYS/MASSIVE_API_KEY' }, null, 2));
    process.exit(1);
  }

  const results = [];
  for (const k of keys) {
    const r = await probeKeyOnce(k);
    results.push({
      key: maskKey(k),
      ok: r.ok,
      capabilities: r.caps,
    });
  }

  const chosen = results.find((r) => r.ok)?.key || null;
  const out = { ok: Boolean(chosen), chosen, results };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(out, null, 2));
  process.exit(chosen ? 0 : 2);
}

main();

