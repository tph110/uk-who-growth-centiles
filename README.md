# CentileTrack

A browser-based calculator that converts a child's height/length, weight and
head circumference into centiles and SDS (z-scores) against the **UK-WHO growth
reference**, and plots the result on a centile chart.

Built as a static site — there is no server, no database and no analytics.
Every calculation runs in the browser and **no patient data leaves the device**.

## What it does

- Centile and SDS for height/length, weight and head circumference
- Serial measurements: add a row per visit and the trajectory is tabulated and
  plotted as a connected track across the centile curves
- Correction for gestation at birth, reported alongside the uncorrected figure
- Plotted on the nine standard UK-WHO centile curves
  (0.4 · 2 · 9 · 25 · 50 · 75 · 91 · 98 · 99.6)
- A large date picker with month and year jumping — the native `<input type="date">`
  popup is browser chrome that CSS cannot resize, and it makes you step back a
  month at a time to reach a date of birth
- Light / dark / auto theme toggle, remembered between visits
- A per-measurement position bar, scaled by SDS so the nine printed centile
  lines fall at even intervals — scaling by centile would crowd the middle
- A "copy for notes" summary in plain text
- Save as PDF for the record, with a ruled box at the top for the patient's
  name and hospital number to be written in by hand. Printing goes through the
  browser rather than a bundled PDF library: the text stays selectable, the
  chart stays vector, and nothing is added to the page weight
- Rejects implausible values (beyond ±8 SD) with a hint at the likely cause,
  such as weight entered in grams or height in metres

## The reference

UK-WHO is a composite standard, and the app switches between its parts exactly
as the reference specifies:

| Age | Reference |
| --- | --- |
| 23 weeks gestation → 42 weeks (2 weeks post term) | UK90 preterm |
| 2 weeks → 2 years | WHO 2006 (measured lying down) |
| 2 years → 4 years | WHO 2006 (measured standing up) |
| 4 years → 20 years | UK90 |

Curves genuinely step at those joins. The chart draws each reference as a
separate segment rather than smoothing across a discontinuity that is not in
the data.

Gestational correction is applied at **every** gestation, not only preterm —
this is what UK-WHO specifies, so a baby born at 41+2 is plotted slightly older
than their birth date implies.

Reference data is not complete everywhere, and the app says so rather than
guessing: no length below 25 weeks gestation, no head circumference above 17
years in girls or 18 years in boys, and nothing outside 23 weeks to 20 years.

## Method

Centiles are calculated by Cole's LMS method. For measurement `x` at an age
with parameters L, M and S:

```
z = ((x/M)^L − 1) / (L·S)      for L ≠ 0
z = ln(x/M) / S                for L = 0
```

L, M and S are interpolated across age with the four-point Lagrange cubic
interpolation used in LMSGrowth, falling back to linear interpolation at the
fringes of each reference where there are not two points either side. The
z-score is converted to a centile with Hart's algorithm for the normal CDF,
which is accurate to ~1e-15 — the cruder Abramowitz–Stegun approximations lose
precision exactly at the tails where the 0.4th and 99.6th centiles live.

## Validation

```bash
npm test
```

Checks all 5,724 height, weight and head circumference cases in the RCPCH
validation dataset, whose expected values come from Tim Cole's LMSGrowth.

```
total checks : 5724
passed       : 5724
failed       : 0
max abs diff : 9.458e-4
median diff  : 6.160e-5
```

The tolerance is 1×10⁻³ absolute, which is the threshold RCPCH's own statistician
set for this dataset: exact agreement between implementations is not achievable,
and RCPCH's own Python package does not reproduce these values bit-for-bit either.

## Development

```bash
npm run dev
```

Serves the site at <http://localhost:3000>. There is no build step — the app is
plain ES modules, so what you edit is what ships.

To regenerate `lib/reference-data.js` from the upstream RCPCH tables:

```bash
python3 scripts/extract-reference-data.py
```

## Deploying

The repository is a static site with no build. Deploy to Vercel with:

```bash
npx vercel --prod
```

## Typography

Inter is self-hosted from `fonts/` (latin subset, 48KB) rather than loaded from
a font CDN. The page tells the reader that nothing they type leaves the device;
a webfont request would hand a third party a record of every visit, which would
make that claim untrue.

## Licence and attribution

Licensed **AGPL-3.0-or-later**, because the reference data and calculation
method are derived from the RCPCH
[`rcpchgrowth-python`](https://github.com/rcpch/rcpchgrowth-python) package,
which is AGPL-3.0. The AGPL requires that users interacting with a deployed
copy over a network can obtain its source, so **this repository must stay
public** and the app links back to it.

Underlying references:

- **UK90** — Cole TJ, Freeman JV, Preece MA. British 1990 growth reference
  centiles for weight, height, body mass index and head circumference.
  *Statistics in Medicine* 1998. Reanalysed 2009.
- **WHO 2006** — WHO Multicentre Growth Reference Study Group. WHO Child Growth
  Standards.

## Scope

This is a calculation aid for clinicians, to be used alongside clinical
judgement. It is not a registered medical device. A single centile is far less
informative than a trajectory — always read the result against the child's own
chart over time.
