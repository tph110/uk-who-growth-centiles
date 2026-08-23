import json, os

SRC = "/tmp/rg/rcpchgrowth/data_tables"
OUT = "/Users/tom/Desktop/growth-centiles/lib/reference-data.js"

REFS = [
    ("uk90Preterm",  f"{SRC}/uk90_preterm.json"),
    ("whoInfants",   f"{SRC}/who/who_infants.json"),
    ("whoChildren",  f"{SRC}/who/who_children.json"),
    ("uk90Child",    f"{SRC}/uk90_child.json"),
]
MEAS = ["height", "weight", "ofc"]
SEXES = ["male", "female"]

def num(x):
    # keep full precision but drop pointless trailing zeros
    f = float(x)
    r = repr(round(f, 10))
    return r

out = {}
report = []
for key, path in REFS:
    with open(path) as fh:
        d = json.load(fh)
    m = d["measurement"]
    out[key] = {}
    for meas in MEAS:
        out[key][meas] = {}
        for sex in SEXES:
            rows = m[meas][sex]
            arr = []
            for r in rows:
                L, M, S, a = r["L"], r["M"], r["S"], r["decimal_age"]
                if L == "" or M == "" or S == "":
                    continue  # absent reference data (e.g. preterm bmi)
                arr.append([float(a), float(L), float(M), float(S)])
            arr.sort(key=lambda t: t[0])
            out[key][meas][sex] = arr
            report.append(f"{key:12s} {meas:7s} {sex:6s} n={len(arr):5d}  {arr[0][0]:+.4f} -> {arr[-1][0]:+.4f}")

def fmt_arr(arr):
    return "[" + ",".join("[" + ",".join(num(v) for v in row) + "]" for row in arr) + "]"

lines = []
lines.append("""// UK-WHO growth reference data (L, M, S by decimal age).
//
// Derived from the RCPCH `rcpchgrowth-python` package data tables:
//   https://github.com/rcpch/rcpchgrowth-python  (AGPL-3.0)
//
// Underlying references:
//   UK90  - Cole TJ, Freeman JV, Preece MA. British 1990 growth reference,
//           reanalysed 2009. Used <42 weeks gestation, and 4-20 years.
//   WHO   - WHO Multicentre Growth Reference Study Group, 2006 Growth
//           Standards. Used 2 weeks to 4 years.
//
// Each entry is [decimalAge, L, M, S]. Arrays are kept complete (including
// ages beyond the range at which each reference is actually used) because
// cubic interpolation needs two neighbouring points either side of the
// requested age, including at reference boundaries.
//
// GENERATED FILE - do not edit by hand. See scripts/extract-reference-data.py
""")
lines.append("export const REFERENCE_DATA = {")
for key in out:
    lines.append(f"  {key}: {{")
    for meas in MEAS:
        lines.append(f"    {meas}: {{")
        for sex in SEXES:
            lines.append(f"      {sex}: {fmt_arr(out[key][meas][sex])},")
        lines.append("    },")
    lines.append("  },")
lines.append("};")
lines.append("")

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as fh:
    fh.write("\n".join(lines))

print("\n".join(report))
print("\nwrote", OUT, os.path.getsize(OUT), "bytes")
