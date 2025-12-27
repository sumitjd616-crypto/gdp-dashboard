import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';

const REST_BASE_URL = 'https://api.polygon.io';
const WS_OPTIONS_URL = process.env.MASSIVE_WS_OPTIONS_URL || 'wss://socket.polygon.io/options';

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

async function probeOptionsWsAuth(key, timeoutMs = 2500) {
  // Only checks auth_success vs auth_failed; does not subscribe.
  // Returns: true/false/null (null = timeout/error).
  return await new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      try {
        ws.close();
      } catch {
        // ignore
      }
      resolve(v);
    };

    const ws = new WebSocket(WS_OPTIONS_URL);
    const t = setTimeout(() => finish(null), timeoutMs);

    ws.on('open', () => {
      try {
        ws.send(JSON.stringify({ action: 'auth', params: key }));
      } catch {
        clearTimeout(t);
        finish(null);
      }
    });

    ws.on('message', (buf) => {
      const s = buf.toString();
      if (s.includes('auth_success')) {
        clearTimeout(t);
        finish(true);
      } else if (s.includes('auth_failed')) {
        clearTimeout(t);
        finish(false);
      }
    });

    ws.on('error', () => {
      clearTimeout(t);
      finish(null);
    });

    ws.on('close', () => {
      clearTimeout(t);
      finish(null);
    });
  });
}

async function probeKeyOnce(key) {
  const caps = {
    indicesPrev: false,
    optionsSpySnapshot: false,
    optionsQqqSnapshot: false,
    optionsSpxSnapshot: false,
    optionsSpxwSnapshot: false,
    optionsWsAuth: null,
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

  try {
    await fetchJson(`${REST_BASE_URL}/v3/snapshot/options/QQQ?limit=1&apiKey=${encodeURIComponent(key)}`);
    caps.optionsQqqSnapshot = true;
  } catch {
    caps.optionsQqqSnapshot = false;
  }

  try {
    await fetchJson(`${REST_BASE_URL}/v3/snapshot/options/SPX?limit=1&apiKey=${encodeURIComponent(key)}`);
    caps.optionsSpxSnapshot = true;
  } catch {
    caps.optionsSpxSnapshot = false;
  }

  try {
    await fetchJson(`${REST_BASE_URL}/v3/snapshot/options/SPXW?limit=1&apiKey=${encodeURIComponent(key)}`);
    caps.optionsSpxwSnapshot = true;
  } catch {
    caps.optionsSpxwSnapshot = false;
  }

  caps.optionsWsAuth = await probeOptionsWsAuth(key, 2500);

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

