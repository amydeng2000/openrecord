#!/usr/bin/env python3
"""
validate_pull.py — canary for the daily MyChart pull.

Sanity-checks the freshly pulled JSON files (in <repo-root>/raw/mychart/) so the
daily workflow fails loudly instead of committing empty or degraded data over
good records. It does NOT judge medical correctness — only shape and volume.

Per category (medications, vitals, lab_results) it verifies the file:
  1. exists,
  2. parses as valid JSON,
  3. is meaningfully non-empty
       - vitals: total readings across flowsheets > 0
       - medications / lab_results: non-empty array
And a regression check: compares the new record COUNT against the previously
committed version (git show HEAD:raw/mychart/<file>) and flags a drop below
DROP_THRESHOLD of the previous count. First run (file not yet in HEAD) skips it.

Output is PHI-free: numbers only (counts, byte sizes), never names or values.
Exits non-zero if any category is empty/invalid/missing or a sharp drop is seen.

Usage:
    python3 scripts/validate_pull.py <data-backend-repo-root>
"""
import json
import pathlib
import subprocess
import sys

SUBDIR = "raw/mychart"
CATEGORIES = ["medications", "vitals", "lab_results"]
# Flag a regression if a category's record count drops below this fraction of the
# previously committed count. Labs/meds/vitals are append-mostly, so a large drop
# almost always means a partial or broken scrape rather than a real change.
DROP_THRESHOLD = 0.5


def count_records(category, data):
    """Record count for a category, tolerant of each category's JSON shape.

    - vitals: a list of flowsheets, each with a "readings" array -> total readings.
    - medications: an object { "medications": [...], "patientFirstName": ... }
      (getMedications returns this shape, NOT a bare array).
    - lab_results (and anything else): a plain array of records.
    """
    if category == "vitals":
        if not isinstance(data, list):
            return 0
        return sum(len(f.get("readings", [])) for f in data if isinstance(f, dict))
    if category == "medications":
        if isinstance(data, dict):
            meds = data.get("medications")
            return len(meds) if isinstance(meds, list) else 0
        return len(data) if isinstance(data, list) else 0
    return len(data) if isinstance(data, list) else 0


def previous_count(repo_root, category):
    """Record count from the previously committed version, or None if unavailable."""
    rel = f"{SUBDIR}/{category}.json"
    try:
        out = subprocess.run(
            ["git", "-C", str(repo_root), "show", f"HEAD:{rel}"],
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        return None  # git not installed
    if out.returncode != 0 or not out.stdout.strip():
        return None  # file not in HEAD yet (first run) or empty
    try:
        return count_records(category, json.loads(out.stdout))
    except json.JSONDecodeError:
        return None


def main():
    if len(sys.argv) != 2:
        print("usage: validate_pull.py <data-backend-repo-root>", file=sys.stderr)
        return 2

    repo_root = pathlib.Path(sys.argv[1]).resolve()
    files_dir = repo_root / SUBDIR
    problems = []

    print(f"Validating {SUBDIR}/ in {repo_root}")
    for cat in CATEGORIES:
        path = files_dir / f"{cat}.json"
        if not path.exists():
            problems.append(f"{cat}: file missing")
            print(f"  {cat}: MISSING")
            continue

        raw = path.read_text()
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            problems.append(f"{cat}: invalid JSON")
            print(f"  {cat}: INVALID JSON")
            continue

        count = count_records(cat, data)
        size = len(raw.encode("utf-8"))
        prev = previous_count(repo_root, cat)

        if count == 0:
            problems.append(f"{cat}: empty (0 records)")
            status = "EMPTY"
        elif prev is not None and prev > 0 and count < prev * DROP_THRESHOLD:
            problems.append(f"{cat}: count dropped {prev} -> {count}")
            status = "DROP"
        else:
            status = "ok"

        prev_str = "n/a" if prev is None else str(prev)
        print(f"  {cat}: {status} | records={count} (prev={prev_str}) | {size} bytes")

    if problems:
        print("\nVALIDATION FAILED:")
        for p in problems:
            print(f"  - {p}")
        return 1

    print("\nValidation passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
