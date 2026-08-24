// UI for the UK-WHO centile calculator.

import {
  calculate, chronologicalDecimalAge, correctedDecimalAge, estimatedDateOfDelivery,
  describeAge, centileBand, centilePhrase, labelForAge, MEASUREMENTS, NINE_CENTILES,
} from './lib/centile.js';
import { renderChart, defaultRange, RANGES } from './lib/chart.js';
import { attachDatePicker, parseUKDate, formatUKDate } from './lib/datepicker.js';

const form = document.getElementById('form');
const errorBox = document.getElementById('errors');
const results = document.getElementById('results');
const ageSummary = document.getElementById('ageSummary');
const resultsBody = document.getElementById('resultsBody');
const resultsNote = document.getElementById('resultsNote');
const chartKey = document.getElementById('chartKey');
const chartHolder = document.getElementById('chart');
const measureTabs = document.getElementById('measureTabs');
const rangeTabs = document.getElementById('rangeTabs');
const copyBtn = document.getElementById('copyBtn');

const state = {
  calculated: null,
  measurement: null,
  rangeKey: null,
};

// --- Theme -----------------------------------------------------------------

const THEME_KEY = 'growth-centiles-theme';

/**
 * Applies a theme choice. 'auto' removes the override so the CSS falls back to
 * the operating system's prefers-color-scheme, rather than us second-guessing
 * it in JavaScript.
 */
function applyTheme(choice) {
  if (choice === 'light' || choice === 'dark') {
    document.documentElement.setAttribute('data-theme', choice);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

function initTheme() {
  let stored = 'auto';
  try {
    stored = localStorage.getItem(THEME_KEY) || 'auto';
  } catch {
    // Storage unavailable; fall back to following the system.
  }
  if (!['auto', 'light', 'dark'].includes(stored)) stored = 'auto';

  const radios = [...document.querySelectorAll('input[name="theme"]')];
  const match = radios.find((r) => r.value === stored) || radios[0];
  if (match) match.checked = true;
  applyTheme(stored);

  for (const radio of radios) {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      applyTheme(radio.value);
      try {
        localStorage.setItem(THEME_KEY, radio.value);
      } catch {
        // Preference simply will not persist; the page still switches.
      }
      // The chart takes its colours from CSS, so it repaints on its own.
    });
  }
}

initTheme();

// UK-WHO covers birth to 20 years, so neither date needs to reach further back
// than that. The window also lets a two-digit typed year resolve unambiguously.
const YEAR_BACK = -21;
const yearWindow = () => {
  const year = new Date().getFullYear();
  return [year + YEAR_BACK, year];
};

// Default the measurement date to today; it is by far the commonest case.
document.getElementById('observationDate').value = formatUKDate(new Date());

attachDatePicker(document.getElementById('birthDate'), {
  minYearOffset: YEAR_BACK, maxYearOffset: 0,
});
attachDatePicker(document.getElementById('observationDate'), {
  minYearOffset: YEAR_BACK, maxYearOffset: 0,
});

const parseDateInput = (value) => parseUKDate(value, yearWindow());

function showErrors(messages) {
  if (!messages.length) {
    errorBox.hidden = true;
    errorBox.textContent = '';
    return false;
  }
  errorBox.hidden = false;
  errorBox.innerHTML = `<ul>${messages.map((m) => `<li>${m}</li>`).join('')}</ul>`;
  return true;
}

function readForm() {
  const data = new FormData(form);
  const sex = data.get('sex');
  const birthDate = parseDateInput(data.get('birthDate'));
  const observationDate = parseDateInput(data.get('observationDate'));
  const gestationWeeks = Number(data.get('gestationWeeks')) || 40;
  const gestationDays = Number(data.get('gestationDays')) || 0;

  const observations = {};
  for (const key of Object.keys(MEASUREMENTS)) {
    const raw = data.get(key);
    if (raw !== null && String(raw).trim() !== '') {
      const value = Number(raw);
      if (Number.isFinite(value) && value > 0) observations[key] = value;
    }
  }

  const errors = [];
  if (!sex) errors.push('Select the child’s sex.');
  // Distinguish a blank field from one that has been typed but cannot be read.
  if (!birthDate) {
    errors.push(String(data.get('birthDate') || '').trim()
      ? 'The date of birth could not be read. Use dd/mm/yyyy.'
      : 'Enter a date of birth.');
  }
  if (!observationDate) {
    errors.push(String(data.get('observationDate') || '').trim()
      ? 'The date measured could not be read. Use dd/mm/yyyy.'
      : 'Enter the date the measurements were taken.');
  }
  if (birthDate && observationDate && birthDate > observationDate) {
    errors.push('The date of birth is after the date measured.');
  }
  if (gestationWeeks < 23 || gestationWeeks > 44) {
    errors.push('Gestation at birth must be between 23 and 44 weeks.');
  }
  if (gestationDays < 0 || gestationDays > 6) {
    errors.push('Gestation days must be between 0 and 6.');
  }
  if (!Object.keys(observations).length) {
    errors.push('Enter at least one measurement.');
  }

  return {
    sex, birthDate, observationDate, gestationWeeks, gestationDays, observations, errors,
  };
}

/**
 * SDS with an explicit sign. A value that rounds to zero gets no sign, so a
 * measurement sitting on the median reads "0.00" rather than "-0.00".
 */
function formatSDS(sds, minus = '\u2212') {
  const rounded = Number(sds.toFixed(2));
  if (rounded === 0) return '0.00';
  return `${rounded > 0 ? '+' : minus}${Math.abs(rounded).toFixed(2)}`;
}

function formatCentile(centile) {
  if (centile < 0.1) return '<0.1';
  if (centile > 99.9) return '>99.9';
  if (centile < 1 || centile > 99) return centile.toFixed(2);
  return centile.toFixed(1);
}

function runCalculation(input) {
  const { sex, birthDate, observationDate, gestationWeeks, gestationDays, observations } = input;

  const chronological = chronologicalDecimalAge(birthDate, observationDate);
  const corrected = correctedDecimalAge(birthDate, observationDate, gestationWeeks, gestationDays);
  const isCorrected = Math.abs(chronological - corrected) > 1e-9;

  const measurements = {};
  for (const [key, observation] of Object.entries(observations)) {
    measurements[key] = {
      observation,
      chronological: calculate({ age: chronological, measurement: key, sex, observation }),
      corrected: isCorrected
        ? calculate({ age: corrected, measurement: key, sex, observation })
        : null,
    };
  }

  return {
    sex,
    birthDate,
    observationDate,
    gestationWeeks,
    gestationDays,
    chronological,
    corrected,
    isCorrected,
    measurements,
    edd: estimatedDateOfDelivery(birthDate, gestationWeeks, gestationDays),
  };
}

const formatDate = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function renderAge(calc) {
  const parts = [];
  const chron = `${describeAge(calc.chronological)} <span class="muted">(${calc.chronological.toFixed(3)} y)</span>`;

  if (calc.isCorrected) {
    parts.push(`Corrected age <strong>${describeAge(calc.corrected)}</strong> <span class="muted">(${calc.corrected.toFixed(3)} y)</span>`);
    parts.push(`Chronological ${chron}`);
    parts.push(`Born ${calc.gestationWeeks}+${calc.gestationDays}${calc.gestationWeeks < 37 ? ' (preterm)' : ''}`);
    parts.push(`EDD ${formatDate(calc.edd)}`);
  } else {
    parts.push(`Chronological age <strong>${describeAge(calc.chronological)}</strong> <span class="muted">(${calc.chronological.toFixed(3)} y)</span>`);
    parts.push('Born 40+0, no correction applied');
  }

  ageSummary.innerHTML = parts.join('<span class="sep">·</span>');
}

function centileBarCell(sds, centile) {
  return `
    <div class="pos-bar" data-sds="${sds}" role="img" aria-label="${centilePhrase(centile)}">
      ${NINE_CENTILES.map((c) => `<span class="pos-tick${c.centile === 50 ? ' pos-tick-mid' : ''}" data-z="${c.z}"></span>`).join('')}
      <span class="pos-marker"></span>
    </div>`;
}

function renderResultRows(key, entry, calc) {
  const meta = MEASUREMENTS[key];
  const primaryAge = calc.isCorrected ? calc.corrected : calc.chronological;
  const label = labelForAge(key, primaryAge);
  const primary = calc.isCorrected ? entry.corrected : entry.chronological;
  const secondary = calc.isCorrected ? entry.chronological : null;
  const value = `${entry.observation} <span class="unit-inline">${meta.unit}</span>`;

  const issue = primary && (primary.error || primary.implausible);
  if (!primary || issue) {
    return `
      <tr class="row-issue">
        <th scope="row">${label}</th>
        <td class="num">${value}</td>
        <td colspan="3" class="issue">${issue || 'Not calculated.'}</td>
      </tr>`;
  }

  let rows = `
    <tr>
      <th scope="row">${label}</th>
      <td class="num">${value}</td>
      <td class="num strong">${formatCentile(primary.centile)}</td>
      <td class="num strong">${formatSDS(primary.sds)}</td>
      <td class="pos-col">${centileBarCell(primary.sds, primary.centile)}</td>
    </tr>`;

  if (secondary) {
    let cells;
    if (secondary.error || secondary.implausible) {
      // For a very preterm baby the uncorrected figure is not a data-entry
      // error, it is simply meaningless without correction.
      const text = secondary.error || 'Off the reference without correction for gestation.';
      cells = `<td colspan="3" class="issue-soft">${text}</td>`;
    } else {
      cells = `
        <td class="num">${formatCentile(secondary.centile)}</td>
        <td class="num">${formatSDS(secondary.sds)}</td>
        <td class="pos-col">${centileBarCell(secondary.sds, secondary.centile)}</td>`;
    }
    rows += `
      <tr class="row-sub">
        <th scope="row">Uncorrected</th>
        <td class="num"></td>
        ${cells}
      </tr>`;
  }

  return rows;
}

/**
 * The bar is scaled by SDS rather than by centile, because that is how the
 * printed centile lines are spaced: the nine of them sit two-thirds of an SD
 * apart, so they land at even intervals. Scaling by centile would crowd
 * everything into the middle.
 *
 * Positions are applied through the CSSOM rather than written into the markup:
 * the site ships style-src 'self' with no 'unsafe-inline', which blocks style
 * attributes parsed from HTML.
 */
const SDS_BAR_LIMIT = 3;
const sdsToPercent = (z) => ((Math.max(-SDS_BAR_LIMIT, Math.min(SDS_BAR_LIMIT, z)) + SDS_BAR_LIMIT) / (SDS_BAR_LIMIT * 2)) * 100;

function positionCentileBars() {
  for (const bar of resultsBody.querySelectorAll('.pos-bar')) {
    for (const tick of bar.querySelectorAll('.pos-tick')) {
      tick.style.left = `${sdsToPercent(Number(tick.dataset.z))}%`;
    }
    const marker = bar.querySelector('.pos-marker');
    const sds = Number(bar.dataset.sds);
    marker.style.left = `${sdsToPercent(sds)}%`;
    if (Math.abs(sds) > SDS_BAR_LIMIT) marker.classList.add('off-scale');
  }
}

function renderResults(calc) {
  renderAge(calc);
  resultsBody.innerHTML = Object.entries(calc.measurements)
    .map(([key, entry]) => renderResultRows(key, entry, calc))
    .join('');
  positionCentileBars();

  // The reference is normally the same for every measurement, so state it once
  // beneath the table rather than repeating it on each row.
  const references = [...new Set(
    Object.values(calc.measurements)
      .map((e) => (calc.isCorrected ? e.corrected : e.chronological))
      .filter((r) => r && !r.error && r.reference)
      .map((r) => r.reference),
  )];
  const ageType = calc.isCorrected ? 'corrected age' : 'chronological age';
  resultsNote.textContent = references.length
    ? `Plotted at ${ageType} against the ${references.join(' and ')} reference.`
    : '';
}

function renderTabs() {
  const calc = state.calculated;
  const available = Object.keys(calc.measurements);

  measureTabs.innerHTML = available.map((key) => `
    <button type="button" role="tab" data-measure="${key}"
      aria-selected="${key === state.measurement}"
      class="tab${key === state.measurement ? ' tab-active' : ''}">${labelForAge(key, calc.isCorrected ? calc.corrected : calc.chronological)}</button>
  `).join('');

  rangeTabs.innerHTML = Object.entries(RANGES).map(([key, r]) => `
    <button type="button" role="tab" data-range="${key}"
      aria-selected="${key === state.rangeKey}"
      class="tab${key === state.rangeKey ? ' tab-active' : ''}">${r.label}</button>
  `).join('');
}

function drawChart() {
  const calc = state.calculated;
  const key = state.measurement;
  const entry = calc.measurements[key];

  // The primary point is the age the result is reported at: corrected where a
  // correction applies, chronological otherwise.
  const points = [{
    age: calc.isCorrected ? calc.corrected : calc.chronological,
    value: entry.observation,
    kind: 'primary',
    label: calc.isCorrected ? 'Corrected age' : 'Chronological age',
  }];
  if (calc.isCorrected) {
    points.push({
      age: calc.chronological,
      value: entry.observation,
      kind: 'secondary',
      label: 'Chronological age (uncorrected)',
    });
  }

  chartKey.innerHTML = [
    `<span class="key-item"><span class="key-dot"></span> ${calc.isCorrected ? 'Corrected age' : 'Chronological age'}</span>`,
    calc.isCorrected
      ? '<span class="key-item"><span class="key-dot key-dot-open"></span> Uncorrected</span>'
      : '',
    '<span class="key-item">Curves 0.4 · 2 · 9 · 25 · 50 · 75 · 91 · 98 · 99.6</span>',
  ].filter(Boolean).join('');

  renderChart(chartHolder, {
    measurement: key,
    sex: calc.sex,
    rangeKey: state.rangeKey,
    points,
    age: calc.isCorrected ? calc.corrected : calc.chronological,
  });
}

function buildNote(calc) {
  const lines = [];
  const sexLabel = calc.sex === 'male' ? 'Male' : 'Female';
  lines.push(`UK-WHO growth centiles — ${sexLabel}, measured ${formatDate(calc.observationDate)}`);
  lines.push(`Age: ${describeAge(calc.chronological)} (chronological)`);
  if (calc.isCorrected) {
    lines.push(`Corrected age: ${describeAge(calc.corrected)} (born ${calc.gestationWeeks}+${calc.gestationDays} weeks)`);
  }
  lines.push('');

  const primaryAge = calc.isCorrected ? calc.corrected : calc.chronological;
  for (const [key, entry] of Object.entries(calc.measurements)) {
    const meta = MEASUREMENTS[key];
    const label = labelForAge(key, primaryAge);
    const primary = calc.isCorrected ? entry.corrected : entry.chronological;
    if (!primary || primary.error || primary.implausible) {
      const reason = primary ? (primary.error || primary.implausible) : 'not calculated';
      lines.push(`${label}: ${entry.observation} ${meta.unit} — ${reason}`);
      continue;
    }
    const ageType = calc.isCorrected ? 'corrected age' : 'chronological age';
    lines.push(`${label}: ${entry.observation} ${meta.unit} — ${centilePhrase(primary.centile)}, SDS ${formatSDS(primary.sds, '-')} (${ageType})`);
    if (calc.isCorrected && entry.chronological && !entry.chronological.error && !entry.chronological.implausible) {
      lines.push(`  uncorrected: ${centilePhrase(entry.chronological.centile)}, SDS ${formatSDS(entry.chronological.sds, '-')}`);
    }
  }

  lines.push('');
  lines.push('Calculated against the UK-WHO growth reference (UK90 / WHO 2006).');
  return lines.join('\n');
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const input = readForm();
  if (showErrors(input.errors)) {
    results.hidden = true;
    return;
  }

  const calc = runCalculation(input);
  state.calculated = calc;

  const available = Object.keys(calc.measurements);
  if (!available.includes(state.measurement)) state.measurement = available[0];
  state.rangeKey = defaultRange(calc.isCorrected ? calc.corrected : calc.chronological);

  results.hidden = false;
  renderResults(calc);
  renderTabs();
  drawChart();
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

form.addEventListener('reset', () => {
  results.hidden = true;
  showErrors([]);
  state.calculated = null;
  requestAnimationFrame(() => {
    document.getElementById('observationDate').value = formatUKDate(new Date());
  });
});

measureTabs.addEventListener('click', (event) => {
  const button = event.target.closest('[data-measure]');
  if (!button) return;
  state.measurement = button.dataset.measure;
  renderTabs();
  drawChart();
});

rangeTabs.addEventListener('click', (event) => {
  const button = event.target.closest('[data-range]');
  if (!button) return;
  state.rangeKey = button.dataset.range;
  renderTabs();
  drawChart();
});

/**
 * Copies text without depending on the async clipboard API, which browsers
 * block in plenty of ordinary situations (no secure context, no user-gesture
 * attribution, permissions policy). Falls back to the legacy path, then to
 * simply showing the text for manual copying — never to a blocking prompt.
 */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fall through
  }

  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

function showNoteFallback(text) {
  let block = document.getElementById('noteFallback');
  if (!block) {
    block = document.createElement('div');
    block.id = 'noteFallback';
    block.className = 'note-fallback';
    block.innerHTML = '<p>Copying was blocked by the browser. Select the text below and copy it manually.</p><textarea readonly rows="10"></textarea>';
    resultsNote.after(block);
  }
  const area = block.querySelector('textarea');
  area.value = text;
  block.hidden = false;
  area.focus();
  area.select();
}

copyBtn.addEventListener('click', async () => {
  if (!state.calculated) return;
  const text = buildNote(state.calculated);

  if (await copyText(text)) {
    const fallback = document.getElementById('noteFallback');
    if (fallback) fallback.hidden = true;
    copyBtn.textContent = 'Copied';
    setTimeout(() => { copyBtn.textContent = 'Copy for notes'; }, 1800);
    return;
  }

  showNoteFallback(text);
});

window.addEventListener('resize', () => {
  if (state.calculated) drawChart();
});
