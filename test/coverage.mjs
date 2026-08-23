// Checks that every age a real child can actually have resolves to a
// calculation, except at the documented limits of the UK-WHO reference.
//
// Decimal ages always come from a whole number of days divided by 365.25, so
// the set of reachable ages is enumerable. This catches off-by-a-float gaps at
// reference boundaries, where a tabulated age stored rounded can otherwise sit
// a fraction outside its own reference.
//
//   node test/coverage.mjs

import { calculate } from '../lib/centile.js';

const FIRST_DAY = -119; // 23 weeks gestation
const LAST_DAY = 7305;  // 20 years

// The reference genuinely stops here; these are expected, not failures.
const EXPECTED_LIMITS = [
  { measurement: 'height', from: -119, to: -106, match: /below 25 weeks gestation/ },
  { measurement: 'ofc', sex: 'female', from: 6210, to: LAST_DAY, match: /girls over 17 years/ },
  { measurement: 'ofc', sex: 'male', from: 6575, to: LAST_DAY, match: /boys over 18 years/ },
];

const isExpected = (measurement, sex, days, error) => EXPECTED_LIMITS.some((l) => (
  l.measurement === measurement
  && (!l.sex || l.sex === sex)
  && days >= l.from && days <= l.to
  && l.match.test(error)
));

let checked = 0;
const unexpected = [];

for (let days = FIRST_DAY; days <= LAST_DAY; days += 1) {
  const age = days / 365.25;
  for (const measurement of ['height', 'weight', 'ofc']) {
    for (const sex of ['male', 'female']) {
      const observation = measurement === 'weight' ? 10 : 60;
      const result = calculate({ age, measurement, sex, observation });
      checked += 1;
      if (result.error && !isExpected(measurement, sex, days, result.error)) {
        unexpected.push({ days, age, measurement, sex, error: result.error });
      }
      if (!result.error && !Number.isFinite(result.sds)) {
        unexpected.push({ days, age, measurement, sex, error: 'non-finite SDS' });
      }
    }
  }
}

console.log('UK-WHO age coverage');
console.log(`  reachable ages checked : ${checked}`);
console.log(`  unexpected gaps        : ${unexpected.length}`);

if (unexpected.length) {
  for (const u of unexpected.slice(0, 20)) {
    console.log(`  GAP day ${u.days} (${u.age.toFixed(4)}y) ${u.measurement}/${u.sex} :: ${u.error}`);
  }
}

process.exit(unexpected.length === 0 ? 0 : 1);
