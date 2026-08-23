// A large, keyboard-accessible date picker.
//
// The native <input type="date"> popup is drawn as browser chrome outside the
// page, so its size cannot be changed from CSS. This replaces it with a panel
// the page owns and can therefore make properly legible, and adds month and
// year jumping — a native picker makes you step back month by month to reach a
// child's date of birth.
//
// The inputs stay type="date", so typing, validation and valueAsDate all keep
// working, and phones still get their own full-size native picker.

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const pad = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sameDay = (a, b) => a && b
  && a.getFullYear() === b.getFullYear()
  && a.getMonth() === b.getMonth()
  && a.getDate() === b.getDate();

function parseISO(value) {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Monday-first index, matching UK convention. */
const weekdayIndex = (date) => (date.getDay() + 6) % 7;

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

class DatePicker {
  constructor(input, options = {}) {
    this.input = input;
    this.minYearOffset = options.minYearOffset ?? -21;
    this.maxYearOffset = options.maxYearOffset ?? 1;
    this.panel = null;
    this.viewDate = null;
    this.focusDate = null;

    this.onDocPointerDown = this.onDocPointerDown.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);

    this.trigger = document.createElement('button');
    this.trigger.type = 'button';
    this.trigger.className = 'date-trigger';
    this.trigger.setAttribute('aria-haspopup', 'dialog');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.setAttribute('aria-label', `Choose ${options.label || 'date'}`);
    this.trigger.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="3" y="5" width="18" height="16" rx="2.5"></rect>
        <path d="M3 10h18M8 3v4M16 3v4"></path>
      </svg>`;
    this.trigger.addEventListener('click', () => this.toggle());

    input.after(this.trigger);
  }

  get min() {
    const today = new Date();
    return new Date(today.getFullYear() + this.minYearOffset, 0, 1);
  }

  get max() {
    const today = new Date();
    return new Date(today.getFullYear() + this.maxYearOffset, 11, 31);
  }

  toggle() {
    if (this.panel) this.close();
    else this.open();
  }

  open() {
    const selected = parseISO(this.input.value);
    const today = startOfDay(new Date());
    this.focusDate = selected || today;
    this.viewDate = new Date(this.focusDate.getFullYear(), this.focusDate.getMonth(), 1);

    this.panel = document.createElement('div');
    this.panel.className = 'datepicker';
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'false');
    this.panel.setAttribute('aria-label', 'Choose a date');
    this.panel.addEventListener('keydown', this.onKeyDown);

    this.input.parentElement.append(this.panel);
    this.render();
    this.position();

    this.trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', this.onDocPointerDown, true);
    window.addEventListener('resize', () => this.position(), { once: true });

    const focusCell = this.panel.querySelector('.dp-day[tabindex="0"]');
    if (focusCell) focusCell.focus();
  }

  close({ returnFocus = false } = {}) {
    if (!this.panel) return;
    this.panel.remove();
    this.panel = null;
    this.trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', this.onDocPointerDown, true);
    if (returnFocus) this.trigger.focus();
  }

  onDocPointerDown(event) {
    if (!this.panel) return;
    if (this.panel.contains(event.target) || this.trigger.contains(event.target)) return;
    this.close();
  }

  /** Flip the panel above the field when there is not room below it. */
  position() {
    if (!this.panel) return;
    this.panel.classList.remove('dp-above');
    const rect = this.panel.getBoundingClientRect();
    const anchor = this.input.getBoundingClientRect();
    if (rect.bottom > window.innerHeight && anchor.top > rect.height + 12) {
      this.panel.classList.add('dp-above');
    }
  }

  select(date) {
    this.input.value = toISO(date);
    this.input.dispatchEvent(new Event('input', { bubbles: true }));
    this.input.dispatchEvent(new Event('change', { bubbles: true }));
    this.close({ returnFocus: true });
  }

  moveFocus(days) {
    const next = new Date(this.focusDate);
    next.setDate(next.getDate() + days);
    if (next < this.min || next > this.max) return;
    this.focusDate = next;
    this.viewDate = new Date(next.getFullYear(), next.getMonth(), 1);
    this.render();
    const cell = this.panel.querySelector('.dp-day[tabindex="0"]');
    if (cell) cell.focus();
  }

  onKeyDown(event) {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        this.close({ returnFocus: true });
        break;
      case 'ArrowLeft': event.preventDefault(); this.moveFocus(-1); break;
      case 'ArrowRight': event.preventDefault(); this.moveFocus(1); break;
      case 'ArrowUp': event.preventDefault(); this.moveFocus(-7); break;
      case 'ArrowDown': event.preventDefault(); this.moveFocus(7); break;
      case 'PageUp': event.preventDefault(); this.shiftMonth(-1); break;
      case 'PageDown': event.preventDefault(); this.shiftMonth(1); break;
      case 'Enter':
      case ' ':
        if (event.target.classList.contains('dp-day')) {
          event.preventDefault();
          this.select(this.focusDate);
        }
        break;
      default:
        break;
    }
  }

  shiftMonth(delta) {
    const next = new Date(this.viewDate.getFullYear(), this.viewDate.getMonth() + delta, 1);
    const limitLow = new Date(this.min.getFullYear(), this.min.getMonth(), 1);
    const limitHigh = new Date(this.max.getFullYear(), this.max.getMonth(), 1);
    if (next < limitLow || next > limitHigh) return;
    this.viewDate = next;
    // Keep the focused day inside the month now on screen.
    const daysInMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    this.focusDate = new Date(
      next.getFullYear(), next.getMonth(),
      Math.min(this.focusDate.getDate(), daysInMonth),
    );
    this.render();
    const cell = this.panel.querySelector('.dp-day[tabindex="0"]');
    if (cell) cell.focus();
  }

  render() {
    const year = this.viewDate.getFullYear();
    const month = this.viewDate.getMonth();
    const selected = parseISO(this.input.value);
    const today = startOfDay(new Date());

    const firstOfMonth = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const lead = weekdayIndex(firstOfMonth);

    const yearOptions = [];
    for (let y = this.max.getFullYear(); y >= this.min.getFullYear(); y -= 1) {
      yearOptions.push(`<option value="${y}"${y === year ? ' selected' : ''}>${y}</option>`);
    }
    const monthOptions = MONTHS.map((name, i) => (
      `<option value="${i}"${i === month ? ' selected' : ''}>${name}</option>`
    )).join('');

    const cells = [];
    for (let i = 0; i < lead; i += 1) cells.push('<div class="dp-day dp-empty" aria-hidden="true"></div>');
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(year, month, day);
      const disabled = date < this.min || date > this.max;
      const classes = ['dp-day'];
      if (sameDay(date, selected)) classes.push('dp-selected');
      if (sameDay(date, today)) classes.push('dp-today');
      if (disabled) classes.push('dp-disabled');
      const isFocus = sameDay(date, this.focusDate);
      cells.push(`
        <button type="button" class="${classes.join(' ')}"
          data-day="${day}" tabindex="${isFocus ? 0 : -1}"
          ${disabled ? 'disabled' : ''}
          aria-label="${day} ${MONTHS[month]} ${year}"
          ${sameDay(date, selected) ? 'aria-current="date"' : ''}>${day}</button>`);
    }

    this.panel.innerHTML = `
      <div class="dp-head">
        <button type="button" class="dp-nav" data-nav="-1" aria-label="Previous month">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
        </button>
        <div class="dp-selects">
          <select class="dp-select" data-select="month" aria-label="Month">${monthOptions}</select>
          <select class="dp-select" data-select="year" aria-label="Year">${yearOptions.join('')}</select>
        </div>
        <button type="button" class="dp-nav" data-nav="1" aria-label="Next month">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
        </button>
      </div>
      <div class="dp-weekdays" aria-hidden="true">
        ${WEEKDAYS.map((d) => `<span>${d}</span>`).join('')}
      </div>
      <div class="dp-grid" role="grid">${cells.join('')}</div>
      <div class="dp-foot">
        <button type="button" class="dp-today-btn" data-today>Today</button>
        <button type="button" class="dp-close" data-close>Close</button>
      </div>`;

    this.panel.querySelectorAll('[data-nav]').forEach((b) => {
      b.addEventListener('click', () => this.shiftMonth(Number(b.dataset.nav)));
    });
    this.panel.querySelector('[data-select="month"]').addEventListener('change', (e) => {
      this.viewDate = new Date(year, Number(e.target.value), 1);
      this.syncFocusToView();
    });
    this.panel.querySelector('[data-select="year"]').addEventListener('change', (e) => {
      this.viewDate = new Date(Number(e.target.value), month, 1);
      this.syncFocusToView();
    });
    this.panel.querySelectorAll('.dp-day:not(.dp-empty)').forEach((b) => {
      b.addEventListener('click', () => {
        this.select(new Date(this.viewDate.getFullYear(), this.viewDate.getMonth(), Number(b.dataset.day)));
      });
    });
    this.panel.querySelector('[data-today]').addEventListener('click', () => this.select(today));
    this.panel.querySelector('[data-close]').addEventListener('click', () => this.close({ returnFocus: true }));
  }

  syncFocusToView() {
    const y = this.viewDate.getFullYear();
    const m = this.viewDate.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    this.focusDate = new Date(y, m, Math.min(this.focusDate.getDate(), daysInMonth));
    this.render();
    this.position();
  }
}

export function attachDatePicker(input, options) {
  return new DatePicker(input, options);
}
