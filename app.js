// UI for the UK-WHO centile calculator.

import {
  calculate, chronologicalDecimalAge, correctedDecimalAge, estimatedDateOfDelivery,
  describeAge, centileBand, centilePhrase, labelForAge, MEASUREMENTS, NINE_CENTILES,
  TWO_YEARS,
} from './lib/centile.js';
import { renderChart, defaultRangeForSpan, RANGES } from './lib/chart.js';
import { attachDatePicker, parseUKDate, formatUKDate } from './lib/datepicker.js';

const form = document.getElementById('form');
const errorBox = document.getElementById('errors');
const results = document.getElementById('results');
const ageSummary = document.getElementById('ageSummary');
const resultsTables = document.getElementById('resultsTables');
const obsRows = document.getElementById('obsRows');
const addRowBtn = document.getElementById('addRow');
const resultsNote = document.getElementById('resultsNote');
const chartKey = document.getElementById('chartKey');
const charts = document.getElementById('charts');
const measureTabs = document.getElementById('measureTabs');
const rangeTabs = document.getElementById('rangeTabs');
const copyBtn = document.getElementById('copyBtn');
const pdfBtn = document.getElementById('pdfBtn');
const printedOn = document.getElementById('printedOn');

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

attachDatePicker(document.getElementById('birthDate'), {
  minYearOffset: YEAR_BACK, maxYearOffset: 0,
});

// --- Observation rows ------------------------------------------------------

/**
 * Adds a measurement row. Rows are built here rather than sitting in the
 * markup so each new date field gets its own picker attached.
 */
function addObservationRow({ date, focus = false } = {}) {
  const row = document.createElement('tr');
  row.className = 'obs-row';
  row.innerHTML = `
    <td class="obs-date">
      <div class="date-field">
        <input type="text" data-obs="date" required inputmode="numeric"
          autocomplete="off" spellcheck="false" placeholder="dd/mm/yyyy"
          maxlength="10" aria-label="Date measured">
      </div>
    </td>
    <td class="num"><input type="number" data-obs="height" step="0.1" min="0"
      inputmode="decimal" placeholder="—" aria-label="Height or length in cm"></td>
    <td class="num"><input type="number" data-obs="weight" step="0.001" min="0"
      inputmode="decimal" placeholder="—" aria-label="Weight in kilograms"></td>
    <td class="num"><input type="number" data-obs="ofc" step="0.1" min="0"
      inputmode="decimal" placeholder="—" aria-label="Head circumference in cm"></td>
    <td class="obs-remove">
      <button type="button" class="row-remove" aria-label="Remove this date">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M6 6l12 12M18 6L6 18"/>
        </svg>
      </button>
    </td>`;

  obsRows.append(row);
  const dateInput = row.querySelector('[data-obs="date"]');
  if (date) dateInput.value = date;
  attachDatePicker(dateInput, { minYearOffset: YEAR_BACK, maxYearOffset: 0 });

  row.querySelector('.row-remove').addEventListener('click', () => {
    row.remove();
    if (!obsRows.children.length) addObservationRow({ date: formatUKDate(new Date()) });
    updateRowControls();
  });

  updateRowControls();
  if (focus) dateInput.focus();
  return row;
}

/** A single row has nothing to remove, so its control is hidden. */
function updateRowControls() {
  const rows = [...obsRows.children];
  for (const row of rows) {
    row.querySelector('.row-remove').hidden = rows.length < 2;
  }
}

function resetObservationRows() {
  obsRows.textContent = '';
  // Today is by far the commonest date for the first row.
  addObservationRow({ date: formatUKDate(new Date()) });
}

resetObservationRows();
addRowBtn.addEventListener('click', () => addObservationRow({ focus: true }));

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
  const gestationWeeks = Number(data.get('gestationWeeks')) || 40;
  const gestationDays = Number(data.get('gestationDays')) || 0;

  const errors = [];
  const observations = [];
  const rows = [...obsRows.children];

  rows.forEach((row, index) => {
    const rawDate = row.querySelector('[data-obs="date"]').value.trim();
    const values = {};
    for (const key of Object.keys(MEASUREMENTS)) {
      const raw = row.querySelector(`[data-obs="${key}"]`).value.trim();
      if (raw === '') continue;
      const value = Number(raw);
      if (Number.isFinite(value) && value > 0) values[key] = value;
    }

    const hasValues = Object.keys(values).length > 0;
    // A row left entirely blank is simply ignored, so an unused spare row
    // does not block the calculation.
    if (!rawDate && !hasValues) return;

    const where = rows.length > 1 ? ` in row ${index + 1}` : '';
    const date = parseDateInput(rawDate);
    if (!date) {
      errors.push(rawDate
        ? `The date${where} could not be read. Use dd/mm/yyyy.`
        : `Enter the date${where}.`);
      return;
    }
    if (!hasValues) {
      errors.push(`Enter at least one measurement for ${formatDate(date)}.`);
      return;
    }
    if (birthDate && date < birthDate) {
      errors.push(`${formatDate(date)} is before the date of birth.`);
      return;
    }
    observations.push({ date, values });
  });

  if (!sex) errors.push('Select the child’s sex.');
  // Distinguish a blank field from one that has been typed but cannot be read.
  if (!birthDate) {
    errors.push(String(data.get('birthDate') || '').trim()
      ? 'The date of birth could not be read. Use dd/mm/yyyy.'
      : 'Enter a date of birth.');
  }
  if (gestationWeeks < 23 || gestationWeeks > 44) {
    errors.push('Gestation at birth must be between 23 and 44 weeks.');
  }
  if (gestationDays < 0 || gestationDays > 6) {
    errors.push('Gestation days must be between 0 and 6.');
  }
  if (!observations.length && !errors.length) {
    errors.push('Enter at least one measurement.');
  }

  const seen = new Set();
  for (const o of observations) {
    const stamp = o.date.getTime();
    if (seen.has(stamp)) errors.push(`${formatDate(o.date)} appears more than once.`);
    seen.add(stamp);
  }

  observations.sort((a, b) => a.date - b.date);

  return { sex, birthDate, gestationWeeks, gestationDays, observations, errors };
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
  const { sex, birthDate, gestationWeeks, gestationDays, observations } = input;

  // Correction depends only on gestation, so it is the same at every visit.
  const isCorrected = gestationWeeks !== 40 || gestationDays !== 0;

  const computed = observations.map(({ date, values }) => {
    const chronological = chronologicalDecimalAge(birthDate, date);
    const corrected = correctedDecimalAge(birthDate, date, gestationWeeks, gestationDays);
    const results = {};
    for (const [key, observation] of Object.entries(values)) {
      results[key] = {
        observation,
        chronological: calculate({ age: chronological, measurement: key, sex, observation }),
        corrected: isCorrected
          ? calculate({ age: corrected, measurement: key, sex, observation })
          : null,
      };
    }
    return { date, chronological, corrected, results };
  });

  const primaryAges = computed.map((o) => (isCorrected ? o.corrected : o.chronological));

  return {
    sex,
    birthDate,
    gestationWeeks,
    gestationDays,
    isCorrected,
    observations: computed,
    minAge: Math.min(...primaryAges),
    maxAge: Math.max(...primaryAges),
    edd: estimatedDateOfDelivery(birthDate, gestationWeeks, gestationDays),
  };
}

/** Measurement keys with at least one value recorded across all visits. */
function measurementsPresent(calc) {
  return Object.keys(MEASUREMENTS)
    .filter((key) => calc.observations.some((o) => o.results[key]));
}

/** The result to lead with: corrected where a correction applies. */
const primaryOf = (entry, calc) => (calc.isCorrected ? entry.corrected : entry.chronological);

/**
 * Names a measurement across a whole series. UK-WHO switches from lying to
 * standing at 2 years, so a run of visits that straddles that boundary is
 * neither purely length nor purely height.
 */
function seriesLabel(key, calc) {
  if (key === 'height' && calc.minAge < TWO_YEARS && calc.maxAge >= TWO_YEARS) {
    return 'Height / length';
  }
  return labelForAge(key, calc.maxAge);
}

const formatDate = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function renderAge(calc) {
  const parts = [`Born <strong>${formatDate(calc.birthDate)}</strong>`];

  if (calc.isCorrected) {
    parts.push(`${calc.gestationWeeks}+${calc.gestationDays} weeks${calc.gestationWeeks < 37 ? ' (preterm)' : ''}`);
    parts.push(`EDD ${formatDate(calc.edd)}`);
  } else {
    parts.push('40+0 weeks, no correction applied');
  }

  const ageWord = calc.isCorrected ? 'Corrected age' : 'Age';
  if (calc.observations.length === 1) {
    const o = calc.observations[0];
    const age = calc.isCorrected ? o.corrected : o.chronological;
    parts.push(`${ageWord} <strong>${describeAge(age)}</strong> <span class="muted">(${age.toFixed(3)} y)</span>`);
  } else {
    parts.push(`<strong>${calc.observations.length} visits</strong>`);
    parts.push(`${ageWord} ${describeAge(calc.minAge)} to ${describeAge(calc.maxAge)}`);
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

/** The centile, SDS and position cells shared by both table layouts. */
function resultCells(result) {
  return `
    <td class="num strong">${formatCentile(result.centile)}</td>
    <td class="num strong">${formatSDS(result.sds)}</td>
    <td class="pos-col">${centileBarCell(result.sds, result.centile)}</td>`;
}

function issueCells(text, colspan) {
  return `<td colspan="${colspan}" class="issue">${text}</td>`;
}

/**
 * The muted second row carrying the uncorrected figures. Shown only where a
 * gestational correction applies, so the two can be compared at a glance.
 */
function uncorrectedRow(entry, leadingBlanks) {
  const secondary = entry.chronological;
  let cells;
  if (!secondary || secondary.error || secondary.implausible) {
    // For a very preterm baby the uncorrected figure is not a data-entry
    // error, it is simply meaningless without correction.
    const text = (secondary && secondary.error) || 'Off the reference without correction for gestation.';
    cells = `<td colspan="3" class="issue-soft">${text}</td>`;
  } else {
    cells = resultCells(secondary);
  }
  return `
    <tr class="row-sub">
      <th scope="row">Uncorrected</th>
      ${'<td></td>'.repeat(leadingBlanks)}
      ${cells}
    </tr>`;
}

/** Single visit: one row per measurement. */
function renderSingleVisit(calc) {
  const observation = calc.observations[0];
  const primaryAge = calc.isCorrected ? observation.corrected : observation.chronological;

  const body = measurementsPresent(calc).map((key) => {
    const entry = observation.results[key];
    const meta = MEASUREMENTS[key];
    const label = labelForAge(key, primaryAge);
    const value = `${entry.observation} <span class="unit-inline">${meta.unit}</span>`;
    const primary = primaryOf(entry, calc);
    const issue = primary && (primary.error || primary.implausible);

    if (!primary || issue) {
      return `<tr class="row-issue"><th scope="row">${label}</th><td class="num">${value}</td>${issueCells(issue || 'Not calculated.', 3)}</tr>`;
    }
    let rows = `<tr><th scope="row">${label}</th><td class="num">${value}</td>${resultCells(primary)}</tr>`;
    if (calc.isCorrected) rows += uncorrectedRow(entry, 1);
    return rows;
  }).join('');

  return `
    <div class="table-wrap">
      <table class="results-table">
        <thead>
          <tr>
            <th scope="col">Measurement</th>
            <th scope="col" class="num">Value</th>
            <th scope="col" class="num">Centile</th>
            <th scope="col" class="num">SDS</th>
            <th scope="col" class="pos-col">Position on reference</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

/**
 * Several visits: one table per measurement, a row per date. The varying
 * dimension goes in the rows either way, so a trajectory reads down a column.
 */
function renderSeries(calc) {
  return measurementsPresent(calc).map((key) => {
    const meta = MEASUREMENTS[key];
    const label = seriesLabel(key, calc);

    const body = calc.observations.map((observation) => {
      const entry = observation.results[key];
      if (!entry) return '';
      const age = calc.isCorrected ? observation.corrected : observation.chronological;
      const value = `${entry.observation} <span class="unit-inline">${meta.unit}</span>`;
      const primary = primaryOf(entry, calc);
      const issue = primary && (primary.error || primary.implausible);
      const lead = `<th scope="row">${formatDate(observation.date)}</th><td class="age-cell">${describeAge(age)}</td><td class="num">${value}</td>`;

      if (!primary || issue) {
        return `<tr class="row-issue">${lead}${issueCells(issue || 'Not calculated.', 3)}</tr>`;
      }
      let rows = `<tr>${lead}${resultCells(primary)}</tr>`;
      if (calc.isCorrected) rows += uncorrectedRow(entry, 2);
      return rows;
    }).join('');

    return `
      <div class="series">
        <h3 class="series-title">${label}</h3>
        <div class="table-wrap">
          <table class="results-table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Age</th>
                <th scope="col" class="num">Value</th>
                <th scope="col" class="num">Centile</th>
                <th scope="col" class="num">SDS</th>
                <th scope="col" class="pos-col">Position on reference</th>
              </tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </div>`;
  }).join('');
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
  for (const bar of resultsTables.querySelectorAll('.pos-bar')) {
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
  resultsTables.innerHTML = calc.observations.length === 1
    ? renderSingleVisit(calc)
    : renderSeries(calc);
  positionCentileBars();

  // The reference is normally the same for every measurement, so state it once
  // beneath the table rather than repeating it on each row.
  const references = [...new Set(
    calc.observations.flatMap((o) => Object.values(o.results))
      .map((e) => primaryOf(e, calc))
      .filter((r) => r && !r.error && r.reference)
      .map((r) => r.reference),
  )];
  const ageType = calc.isCorrected ? 'corrected age' : 'chronological age';
  resultsNote.textContent = references.length
    ? `Plotted at ${ageType} against the ${references.join(', ')} reference${references.length > 1 ? 's' : ''}.`
    : '';
}

function renderTabs() {
  const calc = state.calculated;
  const available = measurementsPresent(calc);

  measureTabs.innerHTML = available.map((key) => `
    <button type="button" role="tab" data-measure="${key}"
      aria-selected="${key === state.measurement}"
      class="tab${key === state.measurement ? ' tab-active' : ''}">${seriesLabel(key, calc)}</button>
  `).join('');

  rangeTabs.innerHTML = Object.entries(RANGES).map(([key, r]) => `
    <button type="button" role="tab" data-range="${key}"
      aria-selected="${key === state.rangeKey}"
      class="tab${key === state.rangeKey ? ' tab-active' : ''}">${r.label}</button>
  `).join('');
}

/**
 * Renders a chart for every measurement, not just the one on screen.
 *
 * The tabs then only toggle which is visible, which also means switching is
 * instant. Printing shows them all: a record with one of the three charts in
 * it is not much of a record.
 */
function drawCharts() {
  const calc = state.calculated;
  charts.textContent = '';

  for (const key of measurementsPresent(calc)) {
    const figure = document.createElement('figure');
    figure.className = 'chart-figure';
    figure.dataset.measure = key;
    figure.hidden = key !== state.measurement;

    const caption = document.createElement('figcaption');
    caption.className = 'chart-caption';
    caption.textContent = seriesLabel(key, calc);
    figure.append(caption);

    const holder = document.createElement('div');
    holder.className = 'chart-holder';
    figure.append(holder);
    charts.append(figure);

    const collect = (ageOf) => calc.observations
      .filter((o) => o.results[key])
      .map((o) => ({ age: ageOf(o), value: o.results[key].observation }));

    // The primary series is the age the results are reported at.
    const series = [{
      kind: 'primary',
      label: calc.isCorrected ? 'Corrected age' : 'Chronological age',
      points: collect((o) => (calc.isCorrected ? o.corrected : o.chronological)),
    }];
    if (calc.isCorrected) {
      series.push({
        kind: 'secondary',
        label: 'Chronological age (uncorrected)',
        points: collect((o) => o.chronological),
      });
    }

    renderChart(holder, {
      measurement: key,
      sex: calc.sex,
      rangeKey: state.rangeKey,
      series,
      age: calc.maxAge,
    });
  }

  chartKey.innerHTML = [
    `<span class="key-item"><span class="key-dot"></span> ${calc.isCorrected ? 'Corrected age' : 'Chronological age'}</span>`,
    calc.isCorrected
      ? '<span class="key-item"><span class="key-dot key-dot-open"></span> Uncorrected</span>'
      : '',
    '<span class="key-item">Curves 0.4 · 2 · 9 · 25 · 50 · 75 · 91 · 98 · 99.6</span>',
  ].filter(Boolean).join('');
}

/** Switching measurement is only a visibility change; nothing is redrawn. */
function showSelectedChart() {
  for (const figure of charts.children) {
    figure.hidden = figure.dataset.measure !== state.measurement;
  }
}

function buildNote(calc) {
  const lines = [];
  const sexLabel = calc.sex === 'male' ? 'Male' : 'Female';
  lines.push(`UK-WHO growth centiles — ${sexLabel}, born ${formatDate(calc.birthDate)}`);
  if (calc.isCorrected) {
    lines.push(`Born at ${calc.gestationWeeks}+${calc.gestationDays} weeks; ages below are corrected for gestation.`);
  }

  for (const observation of calc.observations) {
    const age = calc.isCorrected ? observation.corrected : observation.chronological;
    lines.push('');
    lines.push(`${formatDate(observation.date)} — ${describeAge(age)}${calc.isCorrected ? ' corrected' : ''}`);

    for (const key of Object.keys(MEASUREMENTS)) {
      const entry = observation.results[key];
      if (!entry) continue;
      const meta = MEASUREMENTS[key];
      const label = labelForAge(key, age);
      const primary = primaryOf(entry, calc);
      if (!primary || primary.error || primary.implausible) {
        const reason = primary ? (primary.error || primary.implausible) : 'not calculated';
        lines.push(`  ${label}: ${entry.observation} ${meta.unit} — ${reason}`);
        continue;
      }
      lines.push(`  ${label}: ${entry.observation} ${meta.unit} — ${centilePhrase(primary.centile)}, SDS ${formatSDS(primary.sds, '-')}`);
      const secondary = entry.chronological;
      if (calc.isCorrected && secondary && !secondary.error && !secondary.implausible) {
        lines.push(`    uncorrected: ${centilePhrase(secondary.centile)}, SDS ${formatSDS(secondary.sds, '-')}`);
      }
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

  const available = measurementsPresent(calc);
  if (!available.includes(state.measurement)) state.measurement = available[0];
  state.rangeKey = defaultRangeForSpan(calc.minAge, calc.maxAge);

  results.hidden = false;
  renderResults(calc);
  renderTabs();
  drawCharts();
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

form.addEventListener('reset', () => {
  results.hidden = true;
  showErrors([]);
  state.calculated = null;
  // Deferred so it runs after the browser's own reset has cleared the fields,
  // which would otherwise blank the date this puts back. A timeout rather than
  // requestAnimationFrame: rAF is throttled while the page is not visible, so
  // a reset in a background tab would leave the rows half cleared.
  setTimeout(resetObservationRows, 0);
});

measureTabs.addEventListener('click', (event) => {
  const button = event.target.closest('[data-measure]');
  if (!button) return;
  state.measurement = button.dataset.measure;
  renderTabs();
  showSelectedChart();
});

rangeTabs.addEventListener('click', (event) => {
  const button = event.target.closest('[data-range]');
  if (!button) return;
  state.rangeKey = button.dataset.range;
  renderTabs();
  drawCharts();
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

// --- Printing / PDF --------------------------------------------------------

const BASE_TITLE = document.title;

/**
 * Prepares the page for print. Browsers use document.title as the suggested
 * filename in their Save as PDF dialog, so it is worth making it identify the
 * record rather than the app.
 */
function preparePrint() {
  const now = new Date();
  printedOn.textContent = `Printed ${formatDate(now)}.`;

  const calc = state.calculated;
  if (!calc) return;
  const sexLabel = calc.sex === 'male' ? 'male' : 'female';
  document.title = `CentileTrack growth centiles — ${sexLabel} born ${formatDate(calc.birthDate)}`;
}

function restoreAfterPrint() {
  document.title = BASE_TITLE;
}

window.addEventListener('beforeprint', preparePrint);
window.addEventListener('afterprint', restoreAfterPrint);

pdfBtn.addEventListener('click', () => {
  // Also prepared here rather than relying only on beforeprint, which not
  // every browser fires dependably.
  preparePrint();
  window.print();
});

