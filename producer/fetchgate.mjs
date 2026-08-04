// producer/fetchgate.mjs — the shared "did this provider already fetch today?" gate.
//
// WHY THIS EXISTS AS A SHARED HELPER: every once/day fetcher (av-fetch, extfund-fetch, flow-fetch)
// originally gated on a `.fetched` marker file inside producer/raw/. That directory is gitignored and
// EMPTY on every scheduled run (the producer runs from a fresh clone), so the marker never survived and
// the gate never tripped — each fetcher re-spent its full provider budget on all ~13 runs of the day
// instead of one. For extfund that was ~70 FMP calls per run against a ~250/day free cap, i.e. the
// budget was exhausted within the first few runs and supplementary fundamentals silently went missing
// for the rest of the day.
//
// The standing rule in CLAUDE.md: **any once/day gating must derive from the committed data.json, not a
// raw/ marker file.** build-data.mjs stamps `data.fetchDays = { av, extfund }` (and the flow layer
// carries `data.flow.asOf`), carrying each forward on runs where that provider didn't fetch — so the
// stamp survives the clone wipe and the day boundary is real.
//
// Best-effort by design: no snapshot, no passphrase, a plaintext dev snapshot or a decrypt failure all
// return false → the caller fetches. Failing OPEN is right here; the cost of an extra fetch is a few
// API calls, while failing closed would silently starve the snapshot of data.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decryptEnvelope } from './emit.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Decrypt (or read) the committed snapshot. Returns null when unavailable for any reason.
export async function readSnapshot() {
  try {
    const f = join(__dirname, '..', 'data.json');
    if (!existsSync(f)) return null;
    const env = JSON.parse(readFileSync(f, 'utf8'));
    if (!env || !env.enc) return env || null;              // plaintext dev snapshot
    const pass = process.env.PF_PASSPHRASE;
    if (!pass) return null;
    return await decryptEnvelope(env, pass);
  } catch { return null; }
}

// True when the committed snapshot says `key` already landed data on `todayET`.
// `key` is a field of data.fetchDays ('av' | 'extfund'), or 'flow' which reads data.flow.asOf.
export async function fetchedToday(key, todayET, snap) {
  const prior = snap !== undefined ? snap : await readSnapshot();
  if (!prior) return false;
  if (key === 'flow') return !!(prior.flow && prior.flow.asOf === todayET);
  return !!(prior.fetchDays && prior.fetchDays[key] === todayET);
}

// Convenience for the fetchers: combines the committed-snapshot gate with the local raw/ marker (kept
// only so repeated LOCAL runs in one working tree don't re-spend calls; it is worthless on a scheduler).
export async function alreadyFetchedToday(key, todayET, markerFile) {
  try {
    if (markerFile && existsSync(markerFile) && readFileSync(markerFile, 'utf8').trim() === todayET) return true;
  } catch { /* fall through to the snapshot gate */ }
  return fetchedToday(key, todayET);
}
