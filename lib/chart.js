// Renders a UK-WHO centile chart as inline SVG.
//
// The chart is drawn from the same LMS tables used for the calculation, so the
// plotted point and the curves can never disagree.

import {
  NINE_CENTILES, MEASUREMENTS, labelForAge, selectReference, fetchLMS,
  measurementForZ, referenceDataAbsent, TWENTY_THREE_WEEKS, FORTY_TWO_WEEKS,
  TWENTY_YEARS,
} from './centile.js';
import { REFERENCE_DATA } from './reference-data.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Plain HTML element, as distinct from the SVG helper below. */
const el2 = (name) => document.createElement(name);

export const RANGES = {
  preterm: { label: 'Preterm', from: TWENTY_THREE_WEEKS, to: FORTY_TWO_WEEKS },
  infant: { label: 'Birth–1y', from: 0, to: 1 },
  early: { label: 'Birth–4y', from: 0, to: 4 },
  child: { label: '4–20y', from: 4, to: TWENTY_YEARS },
};

/** Picks the chart range a clinician would reach for at this age. */
export function defaultRange(age) {
  if (age < FORTY_TWO_WEEKS) return 'preterm';
  if (age < 1) return 'infant';
  if (age < 4) return 'early';
  return 'child';
}

/**
 * Picks the narrowest range that holds a whole series of measurements, so a
 * trajectory is not silently cropped. Falls back to the range for the latest
 * age when no single window covers the span — a run of measurements crossing
 * from preterm to school age has no chart that shows both.
 */
export function defaultRangeForSpan(minAge, maxAge) {
  const holdsAll = Object.entries(RANGES)
    .filter(([, r]) => minAge >= r.from && maxAge <= r.to)
    .sort((a, b) => (a[1].to - a[1].from) - (b[1].to - b[1].from));
  if (holdsAll.length) return holdsAll[0][0];
  return defaultRange(maxAge);
}

function el(name, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Samples one centile curve across an age window.
 *
 * Returns an array of segments rather than one continuous line. UK-WHO is a
 * composite of three references and the curves genuinely step at the joins
 * (2 weeks, 2 years, 4 years) — drawing through those steps would invent a
 * continuity the reference data does not have.
 */
function bandSegments(zLow, zHigh, measurement, sex, from, to, samples = 320) {
  const segments = [];
  let current = null;
  let currentRef = null;

  for (let i = 0; i <= samples; i += 1) {
    const age = from + ((to - from) * i) / samples;
    const rows = rowsFor(age, measurement, sex);
    if (!rows) { current = null; currentRef = null; continue; }

    const reference = selectReference(age);
    if (reference.key !== currentRef) {
      current = [];
      segments.push(current);
      currentRef = reference.key;
    }

    const { l, m, s } = fetchLMS(age, rows);
    const low = measurementForZ(zLow, l, m, s);
    const high = measurementForZ(zHigh, l, m, s);
    if (low === null || high === null || !Number.isFinite(low) || !Number.isFinite(high)) {
      current = null;
      currentRef = null;
      continue;
    }
    if (!current) {
      current = [];
      segments.push(current);
      currentRef = reference.key;
    }
    current.push([age, low, high]);
  }

  return segments.filter((seg) => seg && seg.length > 1);
}

/** Shared guard: the LMS rows usable at this age, or null. */
function rowsFor(age, measurement, sex) {
  const reference = selectReference(age);
  if (!reference || referenceDataAbsent(age, measurement, sex)) return null;
  const tables = REFERENCE_DATA[reference.key][measurement];
  const rows = tables && tables[sex];
  if (!rows || !rows.length) return null;
  if (age > rows[rows.length - 1][0] || age < rows[0][0]) return null;
  return rows;
}

function centileSegments(z, measurement, sex, from, to, samples = 320) {
  const segments = [];
  let current = null;
  let currentRef = null;

  for (let i = 0; i <= samples; i += 1) {
    const age = from + ((to - from) * i) / samples;
    const rows = rowsFor(age, measurement, sex);
    if (!rows) {
      current = null;
      continue;
    }
    const reference = selectReference(age);

    if (reference.key !== currentRef) {
      current = [];
      segments.push(current);
      currentRef = reference.key;
    }

    const { l, m, s } = fetchLMS(age, rows);
    const value = measurementForZ(z, l, m, s);
    if (value === null || !Number.isFinite(value)) {
      current = null;
      continue;
    }
    if (!current) {
      current = [];
      segments.push(current);
    }
    current.push([age, value]);
  }

  return segments.filter((seg) => seg && seg.length > 1);
}

function niceTicks(min, max, target = 6) {
  const span = max - min;
  if (span <= 0) return [min];
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step * 1e-9; t += step) {
    ticks.push(Number(t.toFixed(10)));
  }
  return ticks;
}

/** Formats an age in years for the x axis, in the units a clinician expects. */
function formatAgeTick(age, span) {
  if (age < 0) return `${Math.round(40 + (age * 365.25) / 7)}w`;
  if (span <= 0.4) return `${Math.round((age * 365.25) / 7)}w`;
  if (span <= 1.2) {
    const months = (age * 12);
    return `${Math.round(months)}m`;
  }
  return `${Number(age.toFixed(1))}`;
}

/**
 * Draws the chart.
 *
 * `series` is a list of { kind, label, points: [{ age, value }] }. Each series
 * is drawn as a connected trajectory, which is the point of plotting serial
 * measurements at all: the trend across visits carries far more than any one
 * point on it.
 */
export function renderChart(container, { measurement, sex, rangeKey, series, age }) {
  container.textContent = '';

  const range = RANGES[rangeKey];
  const meta = MEASUREMENTS[measurement];
  // Use the same age-appropriate wording as the results table. A series that
  // straddles the 2-year lying-to-standing switch is neither one nor the other.
  const spansSwitch = measurement === 'height' && range.from < 2 && range.to >= 2;
  const label = spansSwitch ? meta.label
    : (age === undefined ? meta.label : labelForAge(measurement, age));

  const width = 760;
  const height = 520;
  const pad = { top: 20, right: 54, bottom: 44, left: 52 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const svg = el('svg', {
    viewBox: `0 0 ${width} ${height}`,
    class: 'chart',
    role: 'img',
    'aria-label': `UK-WHO ${label} centile chart`,
    preserveAspectRatio: 'xMidYMid meet',
  });

  // Build all nine curves first so the y scale can be fitted to them.
  const curves = NINE_CENTILES.map((c) => ({
    ...c,
    segments: centileSegments(c.z, measurement, sex, range.from, range.to),
  }));

  const allValues = curves.flatMap((c) => c.segments.flat().map((p) => p[1]));
  const drawnSeries = (series || []).map((s) => ({
    ...s,
    points: s.points
      .filter((p) => p.age >= range.from && p.age <= range.to && Number.isFinite(p.value))
      .sort((a, b) => a.age - b.age),
  }));
  const visiblePoints = drawnSeries.flatMap((s) => s.points);
  for (const p of visiblePoints) allValues.push(p.value);

  if (!allValues.length) {
    container.append(Object.assign(document.createElement('p'), {
      className: 'chart-empty',
      textContent: 'No reference data to chart for this measurement and age range.',
    }));
    return;
  }

  let yMin = Math.min(...allValues);
  let yMax = Math.max(...allValues);
  const yPad = (yMax - yMin) * 0.06 || 1;
  yMin -= yPad;
  yMax += yPad;

  const xScale = (age) => pad.left + ((age - range.from) / (range.to - range.from)) * plotW;
  const yScale = (v) => pad.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  // Grid and axes
  const xTicks = niceTicks(range.from, range.to, range.to - range.from > 10 ? 8 : 6);
  const yTicks = niceTicks(yMin, yMax, 7);
  const span = range.to - range.from;

  // Plot surface, then the shaded reference bands beneath everything else.
  svg.append(el('rect', {
    x: pad.left, y: pad.top, width: plotW, height: plotH,
    class: 'chart-plot',
  }));

  const bandGroup = el('g', { class: 'chart-bands' });
  const bandSpecs = [
    { low: NINE_CENTILES[0].z, high: NINE_CENTILES[8].z, cls: 'chart-band-outer' },
    { low: NINE_CENTILES[1].z, high: NINE_CENTILES[7].z, cls: 'chart-band' },
  ];
  for (const spec of bandSpecs) {
    for (const seg of bandSegments(spec.low, spec.high, measurement, sex, range.from, range.to)) {
      const forward = seg.map(([a, lo], i) => `${i ? 'L' : 'M'}${xScale(a).toFixed(2)},${yScale(lo).toFixed(2)}`).join('');
      const back = [...seg].reverse().map(([a, , hi]) => `L${xScale(a).toFixed(2)},${yScale(hi).toFixed(2)}`).join('');
      bandGroup.append(el('path', { d: `${forward}${back}Z`, class: spec.cls }));
    }
  }
  svg.append(bandGroup);

  const grid = el('g', { class: 'chart-grid' });
  for (const t of xTicks) {
    if (t < range.from || t > range.to) continue;
    grid.append(el('line', { x1: xScale(t), y1: pad.top, x2: xScale(t), y2: pad.top + plotH }));
  }
  for (const t of yTicks) {
    if (t < yMin || t > yMax) continue;
    grid.append(el('line', { x1: pad.left, y1: yScale(t), x2: pad.left + plotW, y2: yScale(t) }));
  }
  svg.append(grid);

  const axes = el('g', { class: 'chart-axis' });
  axes.append(el('line', { x1: pad.left, y1: pad.top + plotH, x2: pad.left + plotW, y2: pad.top + plotH }));
  axes.append(el('line', { x1: pad.left, y1: pad.top, x2: pad.left, y2: pad.top + plotH }));
  for (const t of xTicks) {
    if (t < range.from || t > range.to) continue;
    axes.append(el('text', {
      x: xScale(t), y: pad.top + plotH + 16, 'text-anchor': 'middle', class: 'tick',
    }, formatAgeTick(t, span)));
  }
  for (const t of yTicks) {
    if (t < yMin || t > yMax) continue;
    axes.append(el('text', {
      x: pad.left - 8, y: yScale(t) + 4, 'text-anchor': 'end', class: 'tick',
    }, String(Number(t.toFixed(2)))));
  }
  axes.append(el('text', {
    x: pad.left + plotW / 2, y: height - 6, 'text-anchor': 'middle', class: 'axis-label',
  }, span > 1.2 ? 'Age (years)' : 'Age'));
  axes.append(el('text', {
    x: 14, y: pad.top + plotH / 2, 'text-anchor': 'middle', class: 'axis-label',
    transform: `rotate(-90 14 ${pad.top + plotH / 2})`,
  }, `${label} (${meta.unit})`));
  svg.append(axes);

  // Centile curves
  const curveGroup = el('g', { class: 'chart-curves' });
  for (const c of curves) {
    const isMedian = c.centile === 50;
    const isOuter = c.centile === 0.4 || c.centile === 99.6;
    for (const seg of c.segments) {
      const d = seg.map(([a, v], i) => `${i ? 'L' : 'M'}${xScale(a).toFixed(2)},${yScale(v).toFixed(2)}`).join('');
      curveGroup.append(el('path', {
        d,
        class: `curve${isMedian ? ' curve-median' : ''}${isOuter ? ' curve-outer' : ''}`,
      }));
    }
    // Label each curve at the right-hand end of its last segment.
    const last = c.segments[c.segments.length - 1];
    if (last) {
      const [a, v] = last[last.length - 1];
      curveGroup.append(el('text', {
        x: xScale(a) + 5, y: yScale(v) + 3, class: 'curve-label',
      }, String(c.centile)));
    }
  }
  svg.append(curveGroup);

  // Plotted measurements
  const pointGroup = el('g', { class: 'chart-points' });

  for (const s of drawnSeries) {
    if (!s.points.length) continue;
    const isSecondary = s.kind === 'secondary';

    // Guides to each axis, the way a value is read off a paper chart. Drawn
    // for a lone measurement only: across a series they would be a thicket.
    if (visiblePoints.length === 1) {
      const [p] = s.points;
      const cx = xScale(p.age);
      const cy = yScale(p.value);
      pointGroup.append(el('line', { x1: pad.left, y1: cy, x2: cx, y2: cy, class: 'point-guide' }));
      pointGroup.append(el('line', { x1: cx, y1: cy, x2: cx, y2: pad.top + plotH, class: 'point-guide' }));
    }

    if (s.points.length > 1) {
      const d = s.points
        .map((p, i) => `${i ? 'L' : 'M'}${xScale(p.age).toFixed(2)},${yScale(p.value).toFixed(2)}`)
        .join('');
      pointGroup.append(el('path', {
        d, class: `track${isSecondary ? ' track-secondary' : ''}`,
      }));
    }

    for (const p of s.points) {
      const cx = xScale(p.age);
      const cy = yScale(p.value);
      // Filled is the age the result is reported at; open is the other one.
      // The position bars in the results table use the same convention.
      const marker = el('circle', {
        cx, cy, r: isSecondary ? 4.5 : 4, class: isSecondary ? 'point point-open' : 'point',
      });
      marker.append(el('title', {}, `${s.label}: ${p.value} ${meta.unit}`));
      pointGroup.append(marker);
    }
  }
  svg.append(pointGroup);

  container.append(svg);

  // A plotted point can fall outside the chosen window - most often the
  // chronological point for a preterm baby, which sits past the preterm chart.
  const total = (series || []).reduce((n, s) => n + s.points.length, 0);
  const hidden = total - visiblePoints.length;
  if (hidden > 0) {
    const note = document.createElement('p');
    note.className = 'chart-note';
    // The first sentence prints: a record must not silently omit a point. The
    // hint about the range control is screen-only, being meaningless on paper.
    note.textContent = hidden === 1
      ? '1 measurement falls outside this age range and is not plotted.'
      : `${hidden} measurements fall outside this age range and are not plotted.`;
    const hint = el2('span');
    hint.className = 'chart-note-hint';
    hint.textContent = hidden === 1
      ? ' Choose a wider range to include it.'
      : ' Choose a wider range to include them.';
    note.append(hint);
    container.append(note);
  }
}
