import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

/**
 * Replay backtester (real captured data only)
 *
 * Input: JSONL produced by server recorder (RECORD_PATH).
 * Evaluates MOVE_15PT alerts using subsequent SPX minute bars:
 * - Target: +15 points in alert direction
 * - Stop:  -8 points (default) or can be tuned
 * - Horizon: 60 minutes
 *
 * Outputs:
 * - Win rate, avg time to target, MFE/MAE stats
 * - Quality grading from a trader POV (A/B/C) based on score + dealer agreement + gamma regime
 */

const file = process.argv[2] || process.env.RECORD_PATH;
if (!file) {
  // eslint-disable-next-line no-console
  console.error('Usage: node server/backtest/replay.js <path-to-jsonl>  (or set RECORD_PATH env)');
  process.exit(1);
}

function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function gradeAlert(a) {
  const score = Number(a.score || 0);
  const agreement = Number(a.dealer?.sync?.agreement || 0);
  const netGEX = Number(a.dealer?.spx?.netGEX || 0);
  const gammaRegime = netGEX < 0 ? 'NEG' : 'POS';

  // Human-ish grading: high score + confirmation + negative gamma is best for 15pt moves.
  if (score >= 80 && agreement >= 75 && gammaRegime === 'NEG') return 'A+';
  if (score >= 75 && agreement >= 65) return 'A';
  if (score >= 65) return 'B';
  return 'C';
}

function evaluateAlert(alert, barsByTs, opts) {
  const entry = Number(alert.spot);
  const dir = alert.direction === 'DOWN' ? -1 : 1;

  const target = entry + dir * opts.targetPts;
  const stop = entry - dir * opts.stopPts;

  // collect bars after alert ts within horizon
  const start = Number(alert.ts);
  const end = start + opts.horizonMin * 60_000;

  const bars = [];
  for (const [ts, bar] of barsByTs) {
    if (ts <= start) continue;
    if (ts > end) break;
    bars.push(bar);
  }

  if (bars.length === 0) {
    return { outcome: 'NO_DATA', grade: gradeAlert(alert) };
  }

  let hit = null;
  let hitTs = null;
  let mfe = 0;
  let mae = 0;

  for (const b of bars) {
    const hi = Number(b.high);
    const lo = Number(b.low);
    const ts = Number(b.timestamp);

    // favorable/adverse excursions in points
    const fav = dir === 1 ? hi - entry : entry - lo;
    const adv = dir === 1 ? entry - lo : hi - entry;
    mfe = Math.max(mfe, fav);
    mae = Math.max(mae, adv);

    // stop before target (conservative)
    const stopHit = dir === 1 ? lo <= stop : hi >= stop;
    if (stopHit) {
      hit = 'STOP';
      hitTs = ts;
      break;
    }

    const targetHit = dir === 1 ? hi >= target : lo <= target;
    if (targetHit) {
      hit = 'TARGET';
      hitTs = ts;
      break;
    }
  }

  const grade = gradeAlert(alert);
  const dtMin = hitTs ? Math.round((hitTs - start) / 60_000) : null;

  return {
    outcome: hit || 'OPEN',
    grade,
    entry,
    target,
    stop,
    mfe,
    mae,
    minutesToOutcome: dtMin,
  };
}

async function run() {
  const opts = {
    targetPts: Number(process.env.TARGET_PTS || 15),
    stopPts: Number(process.env.STOP_PTS || 8),
    horizonMin: Number(process.env.HORIZON_MIN || 60),
  };

  const alerts = [];
  const spxBars = [];

  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const e = parseLine(line);
    if (!e) continue;
    if (e.type !== 'broadcast') continue;
    const p = e.payload;
    if (!p?.type) continue;

    if (p.type === 'SPX_BAR' && p.data) spxBars.push(p.data);
    if (p.type === 'ALERT' && p.data?.type === 'MOVE_15PT') alerts.push(p.data);
  }

  // Sort bars by timestamp ascending for evaluation
  spxBars.sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
  const barsByTs = new Map();
  for (const b of spxBars) barsByTs.set(Number(b.timestamp), b);

  const results = alerts.map((a) => ({ alert: a, eval: evaluateAlert(a, barsByTs, opts) }));

  const completed = results.filter((r) => r.eval.outcome === 'TARGET' || r.eval.outcome === 'STOP');
  const wins = completed.filter((r) => r.eval.outcome === 'TARGET');
  const losses = completed.filter((r) => r.eval.outcome === 'STOP');

  const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  const winRate = completed.length ? (wins.length / completed.length) * 100 : 0;
  const avgMfe = avg(completed.map((r) => r.eval.mfe || 0));
  const avgMae = avg(completed.map((r) => r.eval.mae || 0));
  const avgTimeWin = avg(wins.map((r) => r.eval.minutesToOutcome || 0));

  const gradeCounts = {};
  for (const r of results) gradeCounts[r.eval.grade] = (gradeCounts[r.eval.grade] || 0) + 1;

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        file: path.resolve(file),
        opts,
        counts: { alerts: alerts.length, bars: spxBars.length, completed: completed.length, wins: wins.length, losses: losses.length },
        winRate: Number(winRate.toFixed(2)),
        avgMfe: Number(avgMfe.toFixed(2)),
        avgMae: Number(avgMae.toFixed(2)),
        avgMinutesToWin: Number(avgTimeWin.toFixed(2)),
        grades: gradeCounts,
      },
      null,
      2
    )
  );
}

run().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(String(e?.stack || e?.message || e));
  process.exit(1);
});

