#!/usr/bin/env python3
"""parse_records.py — Turn raw scraped MyChart JSON into concise, LLM-friendly files.

For every category that has a registered parser (see the `parsers/` package),
this reads `<category>.json` from the output folder and writes a concise
`<category>_parsed.json` next to it. Categories without a parser are left alone.
Safe to re-run; it never re-scrapes.

`pull_records.py` calls this automatically after a scrape, but you can also run
it by hand against an existing dump — handy when the transform improves and you
want to re-parse without another (2FA-gated) pull.

Usage:
    python3 parse_records.py                          # parse all registered categories
    python3 parse_records.py --only lab_results       # just one
    python3 parse_records.py --out ./data             # a different output folder
    python3 parse_records.py --replace-raw            # overwrite the raw file to save disk
"""
import argparse
import pathlib
import sys

from parsers import PARSERS, run_parsers

REPO = pathlib.Path(__file__).resolve().parent


def _print_summary(summary: list[dict]) -> None:
    print("=" * 60)
    if not summary:
        print("Nothing to parse (no matching raw files found).")
    for row in summary:
        if row["status"] == "ok":
            kb = row["bytes"] / 1024
            print(f"  ✓ {row['category']:<18} {row['records']} records → "
                  f"{pathlib.Path(row['path']).name} ({kb:.0f} KB)")
        else:
            print(f"  ✗ {row['category']:<18} ERROR: {row['error']}")
    print("=" * 60)


def main() -> None:
    ap = argparse.ArgumentParser(description="Parse raw scraped MyChart JSON into concise files.")
    ap.add_argument(
        "--out",
        default=str(REPO.parent / "openrecord-scrape-output"),
        help="Folder holding the raw per-category JSON (default: ../openrecord-scrape-output).",
    )
    ap.add_argument(
        "--only",
        default="",
        help="Comma-separated categories to parse (default: every category with a parser).",
    )
    ap.add_argument(
        "--replace-raw",
        action="store_true",
        help="Overwrite <category>.json instead of writing <category>_parsed.json.",
    )
    args = ap.parse_args()

    out_dir = pathlib.Path(args.out).resolve()
    if not out_dir.exists():
        sys.exit(f"Output folder not found: {out_dir}")

    categories = [c.strip() for c in args.only.split(",") if c.strip()] or None
    if categories:
        unknown = [c for c in categories if c not in PARSERS]
        if unknown:
            print(
                f"Warning: no parser for {', '.join(unknown)}. "
                f"Known parsers: {', '.join(sorted(PARSERS))}",
                file=sys.stderr,
            )

    summary = run_parsers(out_dir, categories=categories, replace_raw=args.replace_raw)
    _print_summary(summary)


if __name__ == "__main__":
    main()
