// UK-WHO centile calculation.
//
// This is a JavaScript port of the calculation performed by the RCPCH
// `rcpchgrowth-python` package (AGPL-3.0), which is itself an implementation of
// Tim Cole's LMS method as used in LMSGrowth.
//
// The LMS method models a measurement distribution at each age with three
// parameters: L (Box-Cox power), M (median) and S (coefficient of variation).
// A measurement is converted to a z-score (SDS), and the z-score to a centile
// via the standard normal distribution.

import { REFERENCE_DATA } from './reference-data.js';

// --- Age thresholds -------------------------------------------------------
// Gestational ages are expressed as decimal ages relative to a 40-week term,
// so 23 weeks gestation is a negative decimal age.

const weeksGestationAsDecimalAge = (weeks) => ((weeks * 7) - (40 * 7)) / 365.25;

export const TWENTY_THREE_WEEKS = weeksGestationAsDecimalAge(23); // -0.32580
export const TWENTY_FIVE_WEEKS = weeksGestationAsDecimalAge(25);  // -0.28747
export const FORTY_TWO_WEEKS = weeksGestationAsDecimalAge(42);    // +0.03833
export const TWO_YEARS = 2.0;
export const FOUR_YEARS = 4.0;
export const SEVENTEEN_YEARS = 17.0;
export const EIGHTEEN_YEARS = 18.0;
export const TWENTY_YEARS = 20.0;

export const TERM_PREGNANCY_LENGTH_DAYS = 40 * 7;

// The nine centiles used on UK-WHO charts, spaced two-thirds of an SD apart.
export const NINE_CENTILES = [
  { centile: 0.4, z: -8 / 3 },
  { centile: 2, z: -2 },
  { centile: 9, z: -4 / 3 },
  { centile: 25, z: -2 / 3 },
  { centile: 50, z: 0 },
  { centile: 75, z: 2 / 3 },
  { centile: 91, z: 4 / 3 },
  { centile: 98, z: 2 },
  { centile: 99.6, z: 8 / 3 },
];

// Beyond this many SDs a measurement is treated as a data-entry error rather
// than a real observation. This matches the guard in the RCPCH package.
export const IMPLAUSIBLE_SDS = 8;

export const MEASUREMENTS = {
  height: { label: 'Height / length', unit: 'cm', decimals: 1 },
  weight: { label: 'Weight', unit: 'kg', decimals: 3 },
  ofc: { label: 'Head circumference', unit: 'cm', decimals: 1 },
};

/**
 * The term a clinician would use at this age. UK-WHO measures infants lying
 * down and children standing up, switching at 2 years, and the reference data
 * switches with it.
 */
export function labelForAge(measurement, age) {
  if (measurement !== 'height') return MEASUREMENTS[measurement].label;
  return age < TWO_YEARS ? 'Length' : 'Height';
}

// --- Reference selection --------------------------------------------------

/**
 * Chooses which of the four reference tables applies at a given decimal age.
 *
 * UK-WHO is a composite standard:
 *   UK90 preterm   23 weeks gestation to 42 weeks (i.e. 2 weeks post term)
 *   WHO 2006       2 weeks to 2 years   (measured lying down)
 *   WHO 2006       2 years to 4 years   (measured standing up)
 *   UK90           4 years to 20 years
 */
export function selectReference(age) {
  if (age < TWENTY_THREE_WEEKS) return null;
  if (age < FORTY_TWO_WEEKS) return { key: 'uk90Preterm', name: 'UK90 preterm' };
  if (age < TWO_YEARS) return { key: 'whoInfants', name: 'WHO 2006 (lying)' };
  if (age < FOUR_YEARS) return { key: 'whoChildren', name: 'WHO 2006 (standing)' };
  if (age <= TWENTY_YEARS) return { key: 'uk90Child', name: 'UK90' };
  return null;
}

/**
 * UK-WHO reference data is not complete for every age, sex and measurement.
 * Returns an error string when a calculation is not possible, else null.
 */
export function referenceDataAbsent(age, measurement, sex) {
  if (age < TWENTY_THREE_WEEKS) {
    return 'UK-WHO reference data does not exist below 23 weeks gestation.';
  }
  if (age > TWENTY_YEARS) {
    return 'UK-WHO reference data does not exist above 20 years.';
  }
  if (measurement === 'height' && age < TWENTY_FIVE_WEEKS) {
    return 'UK-WHO length data does not exist below 25 weeks gestation.';
  }
  if (measurement === 'ofc') {
    if (sex === 'male' && age > EIGHTEEN_YEARS) {
      return 'UK-WHO head circumference data does not exist in boys over 18 years.';
    }
    if (sex === 'female' && age > SEVENTEEN_YEARS) {
      return 'UK-WHO head circumference data does not exist in girls over 17 years.';
    }
  }
  return null;
}

// --- Interpolation --------------------------------------------------------

/**
 * Returns the index of an exact age match, or of the closest age below.
 * Mirrors the reference implementation, which compares ages rounded to 4dp.
 */
function nearestLowestIndex(rows, age) {
  let lowest = 0;
  for (let i = 0; i < rows.length; i += 1) {
    if (round(rows[i][0], 4) === round(age, 4)) return i;
    if (rows[i][0] < age) lowest = i;
  }
  return lowest;
}

function round(value, dp) {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

/**
 * Four-point Lagrange cubic interpolation, as used by Tim Cole in LMSGrowth.
 * Interpolating L, M and S separately across age is what allows a continuous
 * reference to be built from a table of discrete ages.
 */
function cubicInterpolation(age, ageTwoBelow, ageOneBelow, ageOneAbove, ageTwoAbove, pTwoBelow, pOneBelow, pOneAbove, pTwoAbove) {
  const tt0 = age - ageTwoBelow;
  const tt1 = age - ageOneBelow;
  const tt2 = age - ageOneAbove;
  const tt3 = age - ageTwoAbove;

  const t01 = ageTwoBelow - ageOneBelow;
  const t02 = ageTwoBelow - ageOneAbove;
  const t03 = ageTwoBelow - ageTwoAbove;
  const t12 = ageOneBelow - ageOneAbove;
  const t13 = ageOneBelow - ageTwoAbove;
  const t23 = ageOneAbove - ageTwoAbove;

  return (
    (pTwoBelow * tt1 * tt2 * tt3) / t01 / t02 / t03
    - (pOneBelow * tt0 * tt2 * tt3) / t01 / t12 / t13
    + (pOneAbove * tt0 * tt1 * tt3) / t02 / t12 / t23
    - (pTwoAbove * tt0 * tt1 * tt2) / t03 / t13 / t23
  );
}

function linearInterpolation(age, ageBelow, ageAbove, pBelow, pAbove) {
  if (ageAbove === ageBelow) return pBelow;
  return pBelow + ((pAbove - pBelow) * (age - ageBelow)) / (ageAbove - ageBelow);
}

/**
 * Returns { l, m, s } for a given age, interpolating where the age falls
 * between tabulated points. Cubic interpolation is used wherever there are two
 * points either side; at the fringes of a reference only linear is possible.
 */
export function fetchLMS(age, rows) {
  const i = nearestLowestIndex(rows, age);

  if (round(rows[i][0], 4) === round(age, 4)) {
    return { l: rows[i][1], m: rows[i][2], s: rows[i][3] };
  }

  const ageOneBelow = rows[i][0];
  const ageOneAbove = rows[i + 1][0];
  const below = rows[i];
  const above = rows[i + 1];

  if (i >= 1 && i < rows.length - 2) {
    const ageTwoBelow = rows[i - 1][0];
    const ageTwoAbove = rows[i + 2][0];
    const twoBelow = rows[i - 1];
    const twoAbove = rows[i + 2];
    const interp = (idx) => cubicInterpolation(
      age, ageTwoBelow, ageOneBelow, ageOneAbove, ageTwoAbove,
      twoBelow[idx], below[idx], above[idx], twoAbove[idx],
    );
    return { l: interp(1), m: interp(2), s: interp(3) };
  }

  const interp = (idx) => linearInterpolation(age, ageOneBelow, ageOneAbove, below[idx], above[idx]);
  return { l: interp(1), m: interp(2), s: interp(3) };
}

// --- LMS maths ------------------------------------------------------------

/** Converts a measurement to a z-score (SDS) given L, M and S. */
export function zScore(l, m, s, observation) {
  if (l !== 0) return (((observation / m) ** l) - 1) / (l * s);
  return Math.log(observation / m) / s;
}

/** Converts a z-score back to a measurement. Used to draw centile curves. */
export function measurementForZ(z, l, m, s) {
  if (l !== 0) {
    const base = 1 + l * s * z;
    if (base < 0) return null;
    return (base ** (1 / l)) * m;
  }
  return Math.exp(s * z) * m;
}

/**
 * Standard normal cumulative distribution function.
 *
 * Hart's algorithm (as given by Graeme West), accurate to roughly 1e-15 across
 * the whole range. The naive Abramowitz-Stegun approximations are only good to
 * about 1e-7, which is not enough at the tails where the extreme centiles that
 * matter clinically (0.4th, 99.6th) live.
 */
export function normalCDF(x) {
  const xabs = Math.abs(x);
  let cumnorm;

  if (xabs > 37) {
    cumnorm = 0;
  } else {
    const e = Math.exp((-xabs * xabs) / 2);
    if (xabs < 7.07106781186547) {
      let build = 3.52624965998911e-2 * xabs + 0.700383064443688;
      build = build * xabs + 6.37396220353165;
      build = build * xabs + 33.912866078383;
      build = build * xabs + 112.079291497871;
      build = build * xabs + 221.213596169931;
      build = build * xabs + 220.206867912376;
      cumnorm = e * build;
      build = 8.83883476483184e-2 * xabs + 1.75566716318264;
      build = build * xabs + 16.064177579207;
      build = build * xabs + 86.7807322029461;
      build = build * xabs + 296.564248779674;
      build = build * xabs + 637.333633378831;
      build = build * xabs + 793.826512519948;
      build = build * xabs + 440.413735824752;
      cumnorm /= build;
    } else {
      let build = xabs + 0.65;
      build = xabs + 4 / build;
      build = xabs + 3 / build;
      build = xabs + 2 / build;
      build = xabs + 1 / build;
      cumnorm = e / build / 2.506628274631;
    }
  }

  return x > 0 ? 1 - cumnorm : cumnorm;
}

/** Converts a z-score to a centile as a percentage. */
export function centileFromZ(z) {
  return normalCDF(z) * 100;
}

// --- Ages -----------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole days between two dates, ignoring time of day. */
export function daysBetween(from, to) {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / MS_PER_DAY);
}

export function chronologicalDecimalAge(birthDate, observationDate) {
  return daysBetween(birthDate, observationDate) / 365.25;
}

/**
 * Decimal age corrected for gestation at birth.
 *
 * UK-WHO corrects for gestation at every gestation, not only preterm: a baby
 * born at 41 weeks is plotted a week "older" than their birth date implies.
 * Correction is done by shifting the birth date to the estimated date of
 * delivery, so a baby born at 28 weeks has a negative corrected age until term.
 */
export function correctedDecimalAge(birthDate, observationDate, gestationWeeks, gestationDays) {
  const weeks = gestationWeeks || 40;
  const days = gestationWeeks ? (gestationDays || 0) : 0;
  const pregnancyLengthDays = weeks * 7 + days;
  const correctionDays = TERM_PREGNANCY_LENGTH_DAYS - pregnancyLengthDays;
  const edd = new Date(birthDate.getTime());
  edd.setDate(edd.getDate() + correctionDays);
  return chronologicalDecimalAge(edd, observationDate);
}

export function estimatedDateOfDelivery(birthDate, gestationWeeks, gestationDays) {
  const weeks = gestationWeeks || 40;
  const days = gestationWeeks ? (gestationDays || 0) : 0;
  const correctionDays = TERM_PREGNANCY_LENGTH_DAYS - (weeks * 7 + days);
  const edd = new Date(birthDate.getTime());
  edd.setDate(edd.getDate() + correctionDays);
  return edd;
}

/** Renders a decimal age as a readable clinical age string. */
export function describeAge(decimalAge) {
  if (decimalAge < 0) {
    const weeksGestation = 40 + (decimalAge * 365.25) / 7;
    const w = Math.floor(weeksGestation);
    const d = Math.round((weeksGestation - w) * 7);
    return `${w}+${d} weeks gestation`;
  }
  const totalDays = Math.round(decimalAge * 365.25);
  if (totalDays < 14) return totalDays === 1 ? '1 day' : `${totalDays} days`;
  if (totalDays < 91) {
    const weeks = Math.floor(totalDays / 7);
    const days = totalDays - weeks * 7;
    return days ? `${weeks} weeks, ${days} ${days === 1 ? 'day' : 'days'}` : `${weeks} weeks`;
  }
  const years = Math.floor(decimalAge);
  const months = Math.floor((decimalAge - years) * 12);
  if (years === 0) return `${months} ${months === 1 ? 'month' : 'months'}`;
  const yearPart = `${years} ${years === 1 ? 'year' : 'years'}`;
  if (months === 0) return yearPart;
  return `${yearPart}, ${months} ${months === 1 ? 'month' : 'months'}`;
}

// --- Interpretation -------------------------------------------------------

/**
 * Plain clinical description of where a measurement sits, phrased against the
 * nine printed centile lines rather than the exact centile, which is how
 * growth charts are read in practice.
 */
export function centileBand(centile, measurementLabel) {
  const lines = [0.4, 2, 9, 25, 50, 75, 91, 98, 99.6];
  const noun = measurementLabel.toLowerCase();

  if (centile < 0.4) {
    return `This ${noun} is below the 0.4th centile. This is unusual and may need review.`;
  }
  if (centile > 99.6) {
    return `This ${noun} is above the 99.6th centile. This is unusual and may need review.`;
  }

  // Within 0.1 of a printed line, describe it as being on that line.
  for (const line of lines) {
    if (Math.abs(centile - line) < 0.1) {
      return `This ${noun} is on the ${ordinal(line)} centile.`;
    }
  }

  for (let i = 0; i < lines.length - 1; i += 1) {
    if (centile > lines[i] && centile < lines[i + 1]) {
      return `This ${noun} is between the ${ordinal(lines[i])} and ${ordinal(lines[i + 1])} centiles.`;
    }
  }
  return `This ${noun} is on the ${centile.toFixed(1)}th centile.`;
}

/** English ordinal suffix. Non-integers always take "th" ("0.4th", "99.6th"). */
export function ordinalSuffix(n) {
  if (!Number.isInteger(n)) return 'th';
  const mod100 = Math.abs(n) % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'th';
  switch (Math.abs(n) % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

function ordinal(n) {
  return `${n}${ordinalSuffix(n)}`;
}

/**
 * Names a centile the way it would be written in a note: rounded to a whole
 * number in the middle of the range, and to one decimal at the tails where
 * the difference between 99.5 and 99.9 actually matters.
 */
export function centilePhrase(centile) {
  if (centile < 0.1) return 'below the 0.1st centile';
  if (centile > 99.9) return 'above the 99.9th centile';
  const n = (centile < 1 || centile > 99) ? Number(centile.toFixed(1)) : Math.round(centile);
  return `${ordinal(n)} centile`;
}

// --- Top level ------------------------------------------------------------

/**
 * Calculates centile and SDS for one measurement at one age.
 * Returns { error } if the reference cannot support the calculation.
 */
export function calculate({ age, measurement, sex, observation }) {
  const absent = referenceDataAbsent(age, measurement, sex);
  if (absent) return { error: absent };

  const reference = selectReference(age);
  if (!reference) return { error: 'No UK-WHO reference data for this age.' };

  const tables = REFERENCE_DATA[reference.key][measurement];
  const rows = tables && tables[sex];
  if (!rows || rows.length === 0) {
    return { error: 'No UK-WHO reference data for this measurement at this age.' };
  }

  // A reference can run out before its nominal upper age: UK90 head
  // circumference stops at 17y in girls and 18y in boys.
  if (age > rows[rows.length - 1][0]) {
    return { error: 'No UK-WHO reference data for this measurement at this age.' };
  }

  const { l, m, s } = fetchLMS(age, rows);
  const sds = zScore(l, m, s, observation);
  const centile = centileFromZ(sds);

  return {
    sds,
    centile,
    l,
    m,
    s,
    reference: reference.name,
    referenceKey: reference.key,
    implausible: implausibilityWarning(measurement, observation, sds),
  };
}

/**
 * Returns a warning when a result is too extreme to be a real measurement,
 * or null. Values beyond +/-8 SD are almost always a wrong unit, a wrong date
 * or a typo, and the commonest mistakes have specific hints.
 */
function implausibilityWarning(measurement, observation, sds) {
  if (!Number.isFinite(sds)) {
    return 'This measurement could not be converted to a centile. Check the value.';
  }
  if (Math.abs(sds) <= IMPLAUSIBLE_SDS) return null;

  const direction = sds > 0 ? 'above +8 SD' : 'below −8 SD';
  const base = `This is ${direction}, which is outside the plausible range and usually means a data-entry error.`;

  if (measurement === 'weight' && sds > IMPLAUSIBLE_SDS) {
    return `${base} Check the weight is in kilograms, not grams.`;
  }
  if (measurement === 'height' && sds < -IMPLAUSIBLE_SDS) {
    return `${base} Check the height is in centimetres, not metres, and check the dates.`;
  }
  return `${base} Check the measurement, the dates and the gestation at birth.`;
}
