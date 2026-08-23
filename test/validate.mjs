// Validates this implementation against the RCPCH / LMSGrowth reference dataset.
//
// `lmsgrowth-validation.json` is taken from the RCPCH rcpchgrowth-python test
// suite. Each case carries an expected SDS produced by Tim Cole's LMSGrowth,
// which is the gold standard the UK-WHO charts are built on.
//
//   node test/validate.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  calculate,
  chronologicalDecimalAge,
  correctedDecimalAge,
} from '../lib/centile.js';

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(join(here, 'lmsgrowth-validation.json'), 'utf8'));

// Parse dd/mm/yyyy as a local date.
function parseDate(s) {
  const [d, m, y] = s.split('/').map(Number);
  return new Date(y, m - 1, d);
}

// RCPCH set the acceptance tolerance for this dataset at 1e-3 absolute. Their
// note on it: "owing to variations in statistical calculations it's impossible
// to get exact agreement between R and Python, so our statistician feels we can
// set a tolerance within which we will accept a result as correct."
// The expected values originate from Cole's LMSGrowth, so neither this
// implementation nor RCPCH's own package reproduces them bit-for-bit.
const TOLERANCE = 1e-3;

const stats = {
  total: 0,
  passed: 0,
  skipped: 0,
  failures: [],
  maxAbsDiff: 0,
  byMeasurement: {},
  diffs: [],
};

// This app calculates height, weight and head circumference. BMI cases in the
// reference dataset are outside its scope and are not checked.
const IN_SCOPE = new Set(['height', 'weight', 'ofc']);

for (const c of cases) {
  if (!IN_SCOPE.has(c.measurement_method)) continue;
  for (const kind of ['chronological', 'corrected']) {
    const expected = c[`${kind}_sds`];
    if (expected === null || expected === undefined) continue;

    const birthDate = parseDate(c.birth_date);
    const observationDate = parseDate(c.observation_date);
    const age = kind === 'chronological'
      ? chronologicalDecimalAge(birthDate, observationDate)
      : correctedDecimalAge(birthDate, observationDate, c.gestation_weeks, c.gestation_days);

    const result = calculate({
      age,
      measurement: c.measurement_method,
      sex: c.sex,
      observation: c.observation_value,
    });

    stats.total += 1;
    const m = c.measurement_method;
    stats.byMeasurement[m] ??= { n: 0, pass: 0, maxDiff: 0 };
    stats.byMeasurement[m].n += 1;

    if (result.error) {
      stats.skipped += 1;
      if (stats.failures.length < 15) {
        stats.failures.push({ case: c, kind, age, reason: result.error });
      }
      continue;
    }

    const diff = Math.abs(result.sds - expected);
    stats.maxAbsDiff = Math.max(stats.maxAbsDiff, diff);
    stats.diffs.push(diff);
    stats.byMeasurement[m].maxDiff = Math.max(stats.byMeasurement[m].maxDiff, diff);

    if (diff <= TOLERANCE) {
      stats.passed += 1;
      stats.byMeasurement[m].pass += 1;
    } else if (stats.failures.length < 15) {
      stats.failures.push({
        case: c, kind, age, expected, actual: result.sds, diff,
      });
    }
  }
}

console.log(`UK-WHO SDS validation against LMSGrowth reference values`);
console.log(`tolerance: ${TOLERANCE}\n`);
console.log(`  total checks : ${stats.total}`);
console.log(`  passed       : ${stats.passed}`);
console.log(`  failed       : ${stats.total - stats.passed - stats.skipped}`);
console.log(`  skipped      : ${stats.skipped}  (no reference data at that age)`);
console.log(`  max abs diff : ${stats.maxAbsDiff.toExponential(3)}`);

const sorted = [...stats.diffs].sort((a, b) => a - b);
const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
console.log(`  median diff  : ${q(0.5).toExponential(3)}`);
console.log(`  99th pct     : ${q(0.99).toExponential(3)}\n`);

for (const [m, s] of Object.entries(stats.byMeasurement)) {
  console.log(`  ${m.padEnd(8)} ${String(s.pass).padStart(5)}/${String(s.n).padEnd(5)} max diff ${s.maxDiff.toExponential(3)}`);
}

if (stats.failures.length) {
  console.log(`\nfirst ${stats.failures.length} discrepancies:`);
  for (const f of stats.failures) {
    if (f.reason) {
      console.log(`  SKIP ${f.case.measurement_method} ${f.kind} age=${f.age.toFixed(6)} :: ${f.reason}`);
    } else {
      console.log(`  FAIL ${f.case.measurement_method} ${f.case.sex} ${f.kind} age=${f.age.toFixed(9)} obs=${f.case.observation_value} expected=${f.expected} actual=${f.actual.toFixed(9)} diff=${f.diff.toExponential(3)}`);
    }
  }
}

const failed = stats.total - stats.passed - stats.skipped;
process.exit(failed === 0 ? 0 : 1);
