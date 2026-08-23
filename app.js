// UI for the UK-WHO centile calculator.

import {
  calculate, chronologicalDecimalAge, correctedDecimalAge, estimatedDateOfDelivery,
  describeAge, centileBand, centilePhrase, labelForAge, MEASUREMENTS,
} from './lib/centile.js';
import { renderChart, defaultRange, RANGES } from './lib/chart.js';

const form = document.getElementById('form');
const errorBox = document.getElementById('errors');
const results = document.getElementById('results');
const ageSummary = document.getElementById('ageSummary');
const resultCards = document.getElementById('resultCards');
const chartHolder = document.getElementById('chart');
const measureTabs = document.getElementById('measureTabs');
const rangeTabs = document.getElementById('rangeTabs');
const copyBtn = document.getElementById('copyBtn');

const state = {
  calculated: null,
  measurement: null,
  rangeKey: null,
};

// Default the measurement date to today; it is by far the commonest case.
document.getElementById('observationDate').valueAsDate = new Date();

function parseDateInput(value) {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

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
  if (!birthDate) errors.push('Enter a date of birth.');
  if (!observationDate) errors.push('Enter the date the measurements were taken.');
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
  const preterm = calc.gestationWeeks < 37;
  const rows = [
    `<div><dt>Chronological age</dt><dd>${describeAge(calc.chronological)}<span class="muted"> · ${calc.chronological.toFixed(3)} y</span></dd></div>`,
  ];

  if (calc.isCorrected) {
    rows.push(`<div><dt>Corrected age</dt><dd>${describeAge(calc.corrected)}<span class="muted"> · ${calc.corrected.toFixed(3)} y</span></dd></div>`);
    rows.push(`<div><dt>Gestation at birth</dt><dd>${calc.gestationWeeks}+${calc.gestationDays} weeks${preterm ? ' <span class="tag">preterm</span>' : ''}</dd></div>`);
    rows.push(`<div><dt>Estimated date of delivery</dt><dd>${formatDate(calc.edd)}</dd></div>`);
  } else {
    rows.push(`<div><dt>Gestation at birth</dt><dd>40+0 weeks · no correction applied</dd></div>`);
  }

  ageSummary.innerHTML = `<dl>${rows.join('')}</dl>`;
}

function renderResultCard(key, entry, calc) {
  const meta = MEASUREMENTS[key];
  const primaryAge = calc.isCorrected ? calc.corrected : calc.chronological;
  const label = labelForAge(key, primaryAge);
  const primary = calc.isCorrected ? entry.corrected : entry.chronological;
  const secondary = calc.isCorrected ? entry.chronological : null;

  const value = `${entry.observation} ${meta.unit}`;
  let body;

  if (primary && primary.error) {
    body = `<p class="card-error">${primary.error}</p>`;
  } else if (primary && primary.implausible) {
    body = `<p class="card-error">${primary.implausible}</p>`;
  } else if (primary) {
    const bandText = centileBand(primary.centile, label);
    body = `
      <div class="card-figures">
        <div class="figure">
          <span class="figure-value">${formatCentile(primary.centile)}</span>
          <span class="figure-label">centile</span>
        </div>
        <div class="figure">
          <span class="figure-value">${formatSDS(primary.sds)}</span>
          <span class="figure-label">SDS</span>
        </div>
      </div>
      <p class="card-band">${bandText}</p>
      <p class="card-meta">
        ${calc.isCorrected ? 'Corrected age' : 'Chronological age'} · ${primary.reference} reference
      </p>`;

    if (secondary) {
      let secText;
      if (secondary.error) {
        secText = secondary.error;
      } else if (secondary.implausible) {
        // For a very preterm baby the uncorrected figure is not a data-entry
        // error, it is simply meaningless without correction. Say that
        // instead of prompting for a units check.
        secText = 'Off the reference without correction for gestation.';
      } else {
        secText = `${centilePhrase(secondary.centile)} · SDS ${formatSDS(secondary.sds)}`;
      }
      body += `<p class="card-secondary"><span>Uncorrected (chronological age)</span> ${secText}</p>`;
    }
  }

  return `
    <article class="card">
      <header>
        <h3>${label}</h3>
        <span class="card-value">${value}</span>
      </header>
      ${body}
    </article>`;
}

function renderResults(calc) {
  renderAge(calc);
  resultCards.innerHTML = Object.entries(calc.measurements)
    .map(([key, entry]) => renderResultCard(key, entry, calc))
    .join('');
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

  const points = [{
    age: calc.chronological,
    value: entry.observation,
    kind: 'chronological',
    label: 'Chronological age',
  }];
  if (calc.isCorrected) {
    points.push({
      age: calc.corrected,
      value: entry.observation,
      kind: 'corrected',
      label: 'Corrected age',
    });
  }

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
    document.getElementById('observationDate').valueAsDate = new Date();
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
    resultCards.after(block);
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
