#!/usr/bin/env python3
"""
pull_records.py — Pull selected MyChart records into a folder of JSON files.

OpenRecord's scraper is written in TypeScript, so this script is a thin Python
runner around it: it launches `scrape-dump.ts` (via bun), types in your 2FA code
when MyChart asks, and writes one JSON file per category to the output folder.
After it finishes you do all your analysis in Python against those JSON files.

By default it pulls just three categories — medications, vitals, and lab_results
(override with --only). vitals and medications are already in a usable shape and
are left as-is; lab_results is verbose, so it is parsed into a concise form right
after the pull, and by default the raw dump is replaced so only the parsed
lab_results.json remains in the output folder.

Credentials come from the `.env` file in this folder (same one OpenRecord uses):

    host="ucsfmychart.ucsfmedicalcenter.org"
    username="your-mychart-username"
    pw="your-mychart-password"

Usage:
    python3 pull_records.py                         # medications, vitals, lab_results
    python3 pull_records.py --out ./data            # or a folder of your choice
    python3 pull_records.py --only lab_results      # pull just one category
    python3 pull_records.py --keep-raw              # also keep the raw lab_results.json

Notes:
  * First run sends you a 2FA code (SMS/email); paste it when prompted.
  * The session is cached (.cookie-cache/), so later runs usually skip 2FA.
  * Output is real medical data (PHI) — keep the folder private, never commit it.
"""
import argparse
import os
import pathlib
import shutil
import subprocess
import sys
import json

from parsers import PARSERS, run_parsers

REPO = pathlib.Path(__file__).resolve().parent
CODE_FILE = REPO / ".2fa-code"

# Categories pulled by default (override with --only). Only lab_results has a
# parser; vitals and medications are already usable and pass through unchanged.
DEFAULT_CATEGORIES = ["medications", "vitals", "lab_results"]


def find_bun() -> str:
    """Locate the `bun` executable (installed to ~/.bun/bin by the official installer)."""
    candidates = [
        shutil.which("bun"),
        os.path.expanduser("~/.bun/bin/bun"),
        "/opt/homebrew/bin/bun",
        "/usr/local/bin/bun",
    ]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    sys.exit(
        "Could not find `bun`. Install it with:\n"
        "    curl -fsSL https://bun.sh/install | bash\n"
        "then restart your terminal and re-run this script."
    )


def main() -> None:
    ap = argparse.ArgumentParser(description="Pull selected MyChart records to JSON.")
    ap.add_argument(
        "--out",
        default=str(REPO.parent / "openrecord-scrape-output"),
        help="Output folder for the per-category JSON files "
             "(default: ../openrecord-scrape-output, kept outside the repo).",
    )
    ap.add_argument(
        "--only",
        default="",
        help="Comma-separated categories to pull "
             "(default: medications,vitals,lab_results). Also limits what gets parsed.",
    )
    ap.add_argument(
        "--keep-raw",
        action="store_true",
        help="Keep the raw lab_results.json as well; by default it is replaced by "
             "the concise parsed version so only the small file remains.",
    )
    args = ap.parse_args()
    out_dir = pathlib.Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    only = [c.strip() for c in args.only.split(",") if c.strip()] or list(DEFAULT_CATEGORIES)

    if not (REPO / ".env").exists():
        sys.exit("No .env found in this folder. Create it with host, username, pw (see the docstring).")

    bun = find_bun()

    # Environment for the TS scraper. bun auto-loads .env for the credentials;
    # we just point it at our output folder and tell it where to look for the 2FA code.
    env = os.environ.copy()
    env["OUT_DIR"] = str(out_dir)
    env["TWOFA_CODE_FILE"] = str(CODE_FILE)
    env["TWOFA_WAIT_SEC"] = "600"
    if only:
        # scrape-dump.ts filters its TASKS list to just these categories.
        env["SCRAPE_ONLY"] = ",".join(only)

    # Clear any stale 2FA code from a previous run.
    CODE_FILE.unlink(missing_ok=True)

    print(f"Pulling MyChart records [{', '.join(only)}] → {out_dir}\n")

    proc = subprocess.Popen(
        [bun, "run", "scrape-dump.ts"],
        cwd=str(REPO),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    assert proc.stdout is not None
    prompted = False
    for line in proc.stdout:
        # Mirror the scraper's own progress to your terminal.
        sys.stdout.write(line)
        sys.stdout.flush()
        # When the scraper is waiting for a 2FA code, ask you for it and hand it over.
        if not prompted and "Waiting up to" in line and "2FA code" in line:
            prompted = True
            code = input("\n>>> Enter the 2FA code MyChart just sent you: ").strip()
            CODE_FILE.write_text(code)

    rc = proc.wait()
    CODE_FILE.unlink(missing_ok=True)

    if rc != 0:
        sys.exit(f"\nScraper exited with code {rc}. See the output above for the error.")

    # Post-scrape confirmation.
    #
    # IMPORTANT: never print scraped medical content here — no vitals readings,
    # flowsheet names, or per-category record counts. This output can be captured
    # in CI logs (e.g. the daily GitHub Action), so it must stay free of PHI. Only
    # operational status is printed: how many categories succeeded, any parse
    # errors, and the output path.
    summary_path = out_dir / "_summary.json"
    if summary_path.exists():
        summary = json.loads(summary_path.read_text())
        ok = [s for s in summary if s.get("status") == "ok"]
        print(f"Done: {len(ok)}/{len(summary)} categories succeeded.")

    # Reshape the verbose dumps into a concise form. Only categories that were
    # pulled AND have a registered parser are processed (here: just lab_results);
    # vitals/medications pass through untouched. By default the raw lab_results.json
    # is replaced so only the small parsed file remains. A parse error is reported
    # (name only, no data) but never fails the pull — the raw data is already saved.
    results = run_parsers(out_dir, categories=only, replace_raw=not args.keep_raw)
    for row in results or []:
        if row["status"] != "ok":
            print(f"  parse error [{row['category']}]: {row['error']}")

    print(f"JSON files are in: {out_dir}")


if __name__ == "__main__":
    main()
