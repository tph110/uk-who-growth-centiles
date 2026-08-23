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
function centileSegments(z, measurement, sex, from, to, samples = 320) {
  const segments = [];
  let current = null;
  let currentRef = null;

  for (let i = 0; i <= samples; i += 1) {
    const age = from + ((to - from) * i) / samples;
    const reference = selectReference(age);

    if (!reference || referenceDataAbsent(age, measurement, sex)) {
      current = null;
      continue;
    }

    const tables = REFERENCE_DATA[reference.key][measurement];
    const rows = tables && tables[sex];
    if (!rows || !rows.length || age > rows[rows.length - 1][0] || age < rows[0][0]) {
      current = null;
      continue;
    }

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
 * `points` is a list of { age, value, kind, label } to plot — typically the
 * chronological and corrected age positions for the same measurement.
 */
export function renderChart(container, { measurement, sex, rangeKey, points, age }) {
  container.textContent = '';

  const range = RANGES[rangeKey];
  const meta = MEASUREMENTS[measurement];
  // Use the same age-appropriate wording as the result cards.
  const label = age === undefined ? meta.label : labelForAge(measurement, age);

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
  const visiblePoints = (points || []).filter(
    (p) => p.age >= range.from && p.age <= range.to && Number.isFinite(p.value),
  );
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
  for (const p of visiblePoints) {
    const cx = xScale(p.age);
    const cy = yScale(p.value);
    const cls = p.kind === 'corrected' ? 'point point-corrected' : 'point';
    if (p.kind === 'corrected') {
      // Corrected age is drawn as an open circle, matching how a paper chart
      // distinguishes it from the chronological plot.
      pointGroup.append(el('circle', { cx, cy, r: 6, class: `${cls} point-open` }));
    } else {
      pointGroup.append(el('circle', { cx, cy, r: 5.5, class: cls }));
    }
    pointGroup.append(el('title', {}, `${p.label}: ${p.value} ${meta.unit}`));
  }
  svg.append(pointGroup);

  container.append(svg);

  // A plotted point can fall outside the chosen window - most often the
  // chronological point for a preterm baby, which sits past the preterm chart.
  const hidden = (points || []).filter((p) => !visiblePoints.includes(p));
  if (hidden.length) {
    const note = document.createElement('p');
    note.className = 'chart-note';
    const names = hidden.map((p) => p.label.toLowerCase()).join(' and ');
    note.textContent = `Not shown on this range: ${names}. Choose a wider age range to see it.`;
    container.append(note);
  }
}
