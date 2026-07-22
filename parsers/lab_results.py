"""Parser for ``lab_results.json`` (from ``listLabResults`` in the TS scraper).

Turns the ~840 KB raw dump into a concise, LLM-friendly shape: one record per
result, each with order-level metadata plus a list of components (the individual
analytes) and, for narrative reports, the full report text. Drops the bulk that
is not clinically useful — ``historicalResults`` (a full re-embedding of trend
data), opaque EHR IDs/URLs, ~20 UI boolean flags per result, and the empty
rich-text duplicate blocks.

Narrative report text lives in two different places depending on report type,
and both are captured:
  * Pathology (e.g. SURGICAL PATHOLOGY) — narrative is spread across named
    ``resultComponents`` (Final Diagnosis, Comment, Gross Description, …) whose
    values are RTF/HTML; these become components with ``isNarrative: true``.
  * Radiology (e.g. MR BRAIN) — the result has NO components; the whole report
    is HTML in ``reportDetails.reportContent.reportContent``; it becomes the
    record's top-level ``report`` field.

Input schema is defined by ``scrapers/myChart/labs_and_procedure_results/
labtestresulttype.ts`` (``LabTestResultWithHistory[]``).
"""
from __future__ import annotations

import re

from ._common import html_to_text

# Non-clinical component names to drop (quality-control / instrument bookkeeping).
# Heuristic and easy to tune — matched case-insensitively against the component name.
_QC_NAME_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in (
        r"\bQC\b",            # e.g. "Urine QC Results"
        r"quality control",
        r"lot (?:number|no\.?|#)",  # e.g. "Test Kit Lot Number"
        r"\btest kit\b",
    )
]


def _is_qc(name: str) -> bool:
    return any(p.search(name or "") for p in _QC_NAME_PATTERNS)


def _parse_component(component: dict) -> dict | None:
    """Build a concise component record, or None if it should be dropped."""
    info = component.get("componentInfo") or {}
    result_info = component.get("componentResultInfo") or {}
    comments = component.get("componentComments") or {}

    name = info.get("name")
    if _is_qc(name):
        return None

    ref = result_info.get("referenceRange") or {}
    is_rtf = bool(result_info.get("isValueRtf"))
    value = result_info.get("value") or ""
    if is_rtf and value:
        value = html_to_text(value)

    out: dict = {
        "testName": name,
        "value": value,
        "units": info.get("units") or "",
        "referenceRange": ref.get("formattedReferenceRange") or "",
        "abnormalFlag": result_info.get("abnormalFlagCategoryValue"),
    }
    if ref.get("low") is not None:
        out["refLow"] = ref["low"]
    if ref.get("high") is not None:
        out["refHigh"] = ref["high"]
    if is_rtf:
        out["isNarrative"] = True
    if comments.get("hasContent") and comments.get("contentAsString"):
        out["comment"] = comments["contentAsString"]
    return out


def parse(raw: list) -> list:
    """Transform the raw ``lab_results.json`` array into concise records."""
    records: list[dict] = []
    for order in raw or []:
        order_name = order.get("orderName")
        for result in order.get("results") or []:
            meta = result.get("orderMetadata") or {}
            lab = meta.get("resultingLab") or {}

            components = []
            for component in result.get("resultComponents") or []:
                parsed = _parse_component(component)
                if parsed is not None:
                    components.append(parsed)

            # Radiology-style reports carry no components; the narrative is HTML
            # in reportDetails.reportContent.reportContent.
            report_content = (result.get("reportDetails") or {}).get("reportContent") or {}
            report = html_to_text(report_content.get("reportContent") or "")

            if not components and not report:
                # Nothing clinical left after filtering — skip the result entirely.
                continue

            address = [a for a in (lab.get("address") or []) if a]
            record = {
                "orderName": order_name,
                "resultTime": meta.get("prioritizedInstantISO") or meta.get("resultTimestampDisplay"),
                "collected": meta.get("collectionTimestampsDisplay"),
                "status": meta.get("resultStatus"),
                "specimen": meta.get("specimensDisplay"),
                "orderingProvider": meta.get("orderProviderName"),
                "isAbnormal": result.get("isAbnormal"),
                "performingLab": lab.get("name"),
                "labAddress": ", ".join(address),
                "components": components,
            }
            if report:
                record["report"] = report
            records.append(record)
    return records
