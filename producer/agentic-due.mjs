// Weekly gate for the agentic-account research refresh — the deterministic "is the deep research due?"
// check the producer runs (post-publish, best-effort) before re-running the agentic-research workflow.
// Keyed off the committed producer/agentic-target.json `asOf` (the only state that survives the
// producer's fresh-clone runs), so it fires ~once a week regardless of which run lands on it and
// self-heals if a run is missed. Mirrors preflight.mjs's exit-code convention.
//
//   exit 0  → AGENTIC_DUE      (target missing or ≥ REFRESH_DAYS old → run the research this run)
//   exit 20 → AGENTIC_NOT_DUE  (target refreshed < REFRESH_DAYS ago → skip; ~zero cost)
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { etDate } from './market.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REFRESH_DAYS = 7;
const tf = join(__dirname, 'agentic-target.json');

let due = true, asOf = null, ageDays = null;
try {
  if (existsSync(tf)) {
    const t = JSON.parse(readFileSync(tf, 'utf8'));
    asOf = (t && t.asOf) || null;
    if (asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      ageDays = Math.floor((Date.parse(etDate() + 'T00:00:00Z') - Date.parse(asOf + 'T00:00:00Z')) / 86400000);
      due = ageDays >= REFRESH_DAYS;
    }
  }
} catch { due = true; }

console.log(due
  ? `AGENTIC_DUE (target asOf ${asOf || 'none'}${ageDays != null ? `, ${ageDays}d old` : ''} ≥ ${REFRESH_DAYS}d → refresh the research target)`
  : `AGENTIC_NOT_DUE (target asOf ${asOf}, ${ageDays}d old < ${REFRESH_DAYS}d → skip)`);
process.exit(due ? 0 : 20);
