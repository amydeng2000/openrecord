"""Shared helpers for the parsers package."""
from __future__ import annotations

import re
from html.parser import HTMLParser

# Tags whose end (or, for <br>, start) should become a line break so that the
# stripped plain text keeps the paragraph/line structure of the original HTML.
_BLOCK_TAGS = {
    "p", "div", "br", "li", "ul", "ol", "tr", "table",
    "h1", "h2", "h3", "h4", "h5", "h6",
}


class _TextExtractor(HTMLParser):
    """Collect text from HTML, inserting newlines around block-level elements."""

    def __init__(self) -> None:
        # convert_charrefs=True turns &amp; etc. into plain text for us.
        super().__init__(convert_charrefs=True)
        self._parts: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag == "br":
            self._parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _BLOCK_TAGS:
            self._parts.append("\n")

    def handle_data(self, data: str) -> None:
        self._parts.append(data)

    def text(self) -> str:
        return "".join(self._parts)


def html_to_text(html: str) -> str:
    """Strip HTML/RTF markup to clean plain text, preserving line structure.

    MyChart stores rich-text result components (e.g. surgical-pathology
    narratives) as HTML like ``<div class="fmtConv" ...>...``. This collapses
    that to readable plain text: tags removed, entities decoded, runs of spaces
    squeezed, and no more than one blank line in a row.
    """
    if not html:
        return ""
    parser = _TextExtractor()
    parser.feed(html)
    raw = parser.text()

    # Squeeze runs of horizontal whitespace (incl. &nbsp; -> \xa0) but keep newlines.
    lines = [re.sub(r"[^\S\n]+", " ", ln).strip() for ln in raw.split("\n")]

    # Collapse multiple consecutive blank lines down to a single one.
    out: list[str] = []
    prev_blank = False
    for ln in lines:
        if ln == "":
            if not prev_blank:
                out.append("")
            prev_blank = True
        else:
            out.append(ln)
            prev_blank = False
    return "\n".join(out).strip()
