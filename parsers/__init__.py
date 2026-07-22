"""Parsers for raw scraped MyChart JSON.

Each category produced by ``scrape-dump.ts`` (``<category>.json`` in the output
folder) can have a parser that reshapes the verbose raw dump into a concise,
LLM-friendly form. Parsers are registered in ``PARSERS`` below, keyed by the
category name (which matches the ``<category>.json`` basename).

To add a parser for another category: create ``parsers/<category>.py`` exposing
``parse(raw) -> concise``, then add one line to ``PARSERS``.
"""
from __future__ import annotations

import json
import pathlib
from typing import Callable, Iterable, Optional

from . import lab_results

# category name (matches <category>.json) -> function turning raw data into a concise form
PARSERS: dict[str, Callable[[object], object]] = {
    "lab_results": lab_results.parse,
    # "imaging_results": imaging_results.parse,   # future
    # "medications": medications.parse,           # future
}


def run_parsers(
    out_dir,
    categories: Optional[Iterable[str]] = None,
    replace_raw: bool = False,
) -> list[dict]:
    """Parse each registered category present in ``out_dir``.

    Reads ``<category>.json`` and writes ``<category>_parsed.json`` (or
    overwrites the raw file when ``replace_raw`` is True). Only categories that
    have a registered parser AND a raw file on disk are processed; anything else
    is skipped. Returns a per-category summary; a failing parser is recorded as
    an error and never aborts the others.

    ``categories`` optionally restricts the run (e.g. to what was just pulled);
    None means every registered parser.
    """
    out_dir = pathlib.Path(out_dir)
    targets = [c for c in (list(categories) if categories else PARSERS) if c in PARSERS]

    summary: list[dict] = []
    for category in targets:
        raw_path = out_dir / f"{category}.json"
        if not raw_path.exists():
            continue
        try:
            raw = json.loads(raw_path.read_text())
            parsed = PARSERS[category](raw)
            text = json.dumps(parsed, indent=2, ensure_ascii=False)
            dest = raw_path if replace_raw else out_dir / f"{category}_parsed.json"
            dest.write_text(text)
            summary.append({
                "category": category,
                "status": "ok",
                "records": len(parsed) if isinstance(parsed, list) else None,
                "bytes": len(text.encode("utf-8")),
                "path": str(dest),
            })
        except Exception as exc:  # keep going; the raw file is already safely on disk
            summary.append({"category": category, "status": "error", "error": str(exc)})
    return summary
