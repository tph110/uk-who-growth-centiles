// A large, keyboard-accessible date picker.
//
// The fields are plain text inputs, not <input type="date">. A native date
// input opens the browser's own small calendar wherever you click in it, and
// there is no way to suppress that while keeping the input type — so the two
// pickers ended up fighting each other. Owning the field outright means one
// calendar, opened the same way however the field is clicked.
//
// The cost is that typing has to be handled here: parsing, light masking and
// normalising on blur. Dates are read and written as dd/mm/yyyy.

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const pad = (n) => String(n).padStart(2, '0');

/** Renders a date as dd/mm/yyyy. */
export function formatUKDate(date) {
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/**
 * Parses a typed date. Accepts dd/mm/yyyy and the shorthands people actually
 * use in a hurry: d/m/yy, 14-5-2023, 14.5.2023, and bare digits (14052023 or
 * 140523).
 *
 * A two-digit year is resolved into `yearWindow`, a [min, max] span. The app
 * only covers birth to 20 years, so that span is short enough for two digits
 * to be unambiguous.
 *
 * Returns a Date, or null if the value is not a real calendar date.
 */
export function parseUKDate(value, yearWindow) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;

  let day; let month; let year;
  const separated = text.match(/^(\d{1,2})[^\d]+(\d{1,2})[^\d]+(\d{2}|\d{4})$/);

  if (separated) {
    [, day, month, year] = separated;
  } else {
    const digits = text.replace(/\D/g, '');
    if (digits.length !== text.length) return null;
    if (digits.length === 8) {
      [day, month, year] = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)];
    } else if (digits.length === 6) {
      [day, month, year] = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)];
    } else {
      return null;
    }
  }

  day = Number(day);
  month = Number(month);
  year = Number(year);

  if (String(year).length <= 2 && yearWindow) {
    const [minYear, maxYear] = yearWindow;
    const century = Math.floor(maxYear / 100) * 100;
    year = century + year;
    if (year > maxYear) year -= 100;
    if (year < minYear) return null;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(year, month - 1, day);
  // Rejects dates that rolled over, such as 31 February.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

const sameDay = (a, b) => a && b
  && a.getFullYear() === b.getFullYear()
  && a.getMonth() === b.getMonth()
  && a.getDate() === b.getDate();

/** Monday-first index, matching UK convention. */
const weekdayIndex = (date) => (date.getDay() + 6) % 7;

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Every scrollable ancestor of an element. The panel is positioned in viewport
 * coordinates, so it has to be told when any of these move — and a scroll event
 * on an element does not bubble, nor does it reliably reach a capture listener
 * on window, so each one is listened to directly.
 */
function scrollParents(el) {
  const found = [];
  let node = el.parentElement;
  while (node && node !== document.body) {
    const cs = getComputedStyle(node);
    if (/(auto|scroll)/.test(cs.overflow + cs.overflowX + cs.overflowY)) found.push(node);
    node = node.parentElement;
  }
  return found;
}

class DatePicker {
  constructor(input, options = {}) {
    this.input = input;
    this.minYearOffset = options.minYearOffset ?? -21;
    this.maxYearOffset = options.maxYearOffset ?? 1;
    this.panel = null;
    this.viewDate = null;
    this.focusDate = null;

    this.onDocPointerDown = this.onDocPointerDown.bind(this);
    this.onPanelKeyDown = this.onPanelKeyDown.bind(this);
    this.reposition = this.reposition.bind(this);

    this.trigger = document.createElement('button');
    this.trigger.type = 'button';
    this.trigger.className = 'date-trigger';
    this.trigger.tabIndex = -1;
    this.trigger.setAttribute('aria-hidden', 'true');
    this.trigger.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="3" y="5" width="18" height="16" rx="2.5"></rect>
        <path d="M3 10h18M8 3v4M16 3v4"></path>
      </svg>`;

    input.after(this.trigger);

    // Anywhere in the field opens the calendar — the icon is decoration, not
    // the only way in. Focus stays in the input so the date can still be typed.
    this.trigger.addEventListener('mousedown', (event) => {
      event.preventDefault();
      this.input.focus();
      this.toggle();
    });
    input.addEventListener('focus', () => this.open());
    input.addEventListener('click', () => this.open());
    input.addEventListener('input', () => this.onType());
    input.addEventListener('blur', () => this.normalise());
    input.addEventListener('keydown', (event) => this.onInputKeyDown(event));
  }

  get yearWindow() {
    const year = new Date().getFullYear();
    return [year + this.minYearOffset, year + this.maxYearOffset];
  }

  get min() {
    return new Date(this.yearWindow[0], 0, 1);
  }

  get max() {
    return new Date(this.yearWindow[1], 11, 31);
  }

  get value() {
    return parseUKDate(this.input.value, this.yearWindow);
  }

  toggle() {
    if (this.panel) this.close();
    else this.open();
  }

  /** Light masking: insert the slashes as digits are typed at the end. */
  onType() {
    const el = this.input;
    const atEnd = el.selectionStart === el.value.length;
    if (atEnd && /^[\d/]*$/.test(el.value)) {
      const digits = el.value.replace(/\D/g, '').slice(0, 8);
      let masked = digits;
      if (digits.length > 4) masked = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
      else if (digits.length > 2) masked = `${digits.slice(0, 2)}/${digits.slice(2)}`;
      // Only rewrite when a separator is actually being added, so backspacing
      // through a slash does not immediately put it back.
      if (masked.length > el.value.length) {
        el.value = masked;
        el.setSelectionRange(masked.length, masked.length);
      }
    }

    const parsed = this.value;
    if (parsed && this.panel) {
      this.focusDate = parsed;
      this.viewDate = new Date(parsed.getFullYear(), parsed.getMonth(), 1);
      this.render();
    }
  }

  /** On leaving the field, rewrite anything parseable in the canonical form. */
  normalise() {
    const parsed = this.value;
    if (parsed) {
      const formatted = formatUKDate(parsed);
      if (this.input.value !== formatted) {
        this.input.value = formatted;
        this.input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }

  onInputKeyDown(event) {
    if (event.key === 'Escape' && this.panel) {
      event.preventDefault();
      this.close();
    } else if (event.key === 'ArrowDown' && event.altKey === false) {
      // Step from the field into the grid, the way a combobox behaves.
      event.preventDefault();
      if (!this.panel) this.open();
      const cell = this.panel.querySelector('.dp-day[tabindex="0"]');
      if (cell) cell.focus();
    } else if (event.key === 'Enter' && this.panel) {
      this.close();
    }
  }

  open() {
    if (this.panel) return;

    const selected = this.value;
    const today = startOfDay(new Date());
    this.focusDate = selected || today;
    this.viewDate = new Date(this.focusDate.getFullYear(), this.focusDate.getMonth(), 1);

    this.panel = document.createElement('div');
    this.panel.className = 'datepicker';
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', 'Choose a date');
    this.panel.addEventListener('keydown', this.onPanelKeyDown);
    // Keep focus in the field when a day is clicked with the mouse.
    this.panel.addEventListener('mousedown', (event) => event.preventDefault());

    // Appended to the body, not next to the field. The measurement rows sit in
    // a horizontally scrollable table, and any scrolling ancestor clips an
    // absolutely positioned descendant — the panel was being cut off to the
    // height of the table wrapper. Positioning is done in reposition().
    document.body.append(this.panel);
    this.render();
    this.reposition();

    document.addEventListener('pointerdown', this.onDocPointerDown, true);
    this.scrollTargets = [window, ...scrollParents(this.input)];
    for (const target of this.scrollTargets) {
      target.addEventListener('scroll', this.reposition, { passive: true });
    }
    window.addEventListener('resize', this.reposition);
  }

  close({ returnFocus = false } = {}) {
    if (!this.panel) return;
    this.panel.remove();
    this.panel = null;
    document.removeEventListener('pointerdown', this.onDocPointerDown, true);
    for (const target of this.scrollTargets || []) {
      target.removeEventListener('scroll', this.reposition);
    }
    this.scrollTargets = [];
    window.removeEventListener('resize', this.reposition);
    if (returnFocus) this.input.focus();
  }

  onDocPointerDown(event) {
    if (!this.panel) return;
    if (this.panel.contains(event.target)
      || this.trigger.contains(event.target)
      || event.target === this.input) return;
    this.close();
  }

  /**
   * Places the panel against its field in viewport coordinates. Below by
   * default, flipped above when there is not room, and clamped so it can never
   * hang off an edge.
   */
  reposition() {
    if (!this.panel) return;
    const gap = 5;
    const margin = 8;
    const anchor = this.input.getBoundingClientRect();

    // If the field has been scrolled out of sight there is nothing to anchor
    // to, and a panel floating on its own is just confusing.
    if (anchor.bottom < 0 || anchor.top > window.innerHeight
      || anchor.right < 0 || anchor.left > window.innerWidth) {
      this.close();
      return;
    }

    const { width, height } = this.panel.getBoundingClientRect();

    let top = anchor.bottom + gap;
    const roomBelow = window.innerHeight - anchor.bottom - gap - margin;
    if (height > roomBelow && anchor.top - gap - margin > height) {
      top = anchor.top - height - gap;
    }
    top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));

    let left = anchor.left;
    left = Math.min(left, window.innerWidth - width - margin);
    left = Math.max(margin, left);

    this.panel.style.top = `${Math.round(top)}px`;
    this.panel.style.left = `${Math.round(left)}px`;
  }

  select(date) {
    this.input.value = formatUKDate(date);
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

  onPanelKeyDown(event) {
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
    if (cell && document.activeElement !== this.input) cell.focus();
  }

  render() {
    const year = this.viewDate.getFullYear();
    const month = this.viewDate.getMonth();
    const selected = this.value;
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
    // The selects need focus to operate, so let mousedown through on them.
    this.panel.querySelectorAll('.dp-select').forEach((sel) => {
      sel.addEventListener('mousedown', (event) => event.stopPropagation());
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
    this.reposition();
  }
}

export function attachDatePicker(input, options) {
  return new DatePicker(input, options);
}
