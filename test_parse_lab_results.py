#!/usr/bin/env python3
"""Tests for the lab-results parser and the parsers driver.

Zero-dependency: run with `python3 -m unittest test_parse_lab_results -v`.
"""
import json
import pathlib
import tempfile
import unittest

from parsers import run_parsers
from parsers._common import html_to_text
from parsers.lab_results import parse

# A trimmed raw order covering the three cases the parser must handle:
#   - a numeric component (value/units/reference range preserved)
#   - an RTF narrative component (HTML stripped, isNarrative flagged)
#   - a QC component (dropped)
FIXTURE = [
    {
        "orderName": "BASIC METABOLIC PANEL",
        "key": "WP-24-opaque-id-should-be-dropped",
        "historicalResults": {"historicalResults": {"a": "big duplicated blob"}},
        "results": [
            {
                "name": "BASIC METABOLIC PANEL",
                "isAbnormal": False,
                "showDetails": True,          # UI flag — must not appear in output
                "orderMetadata": {
                    "orderProviderName": "Dr. Ada Lovelace",
                    "prioritizedInstantISO": "2025-11-08T06:23:00-08:00",
                    "resultTimestampDisplay": "Nov 08, 2025 6:23 AM",
                    "collectionTimestampsDisplay": "Nov 08, 2025 6:23 AM",
                    "specimensDisplay": "Blood (Blood)",
                    "resultStatus": "Final",
                    "resultingLab": {
                        "name": "UCSF LAB",
                        "address": ["400 Parnassus Avenue", "San Francisco CA 94122"],
                        "cliaNumber": "05D0643676",
                    },
                },
                "resultComponents": [
                    {
                        "componentInfo": {"name": "Sodium, Plasma/Serum", "units": "mmol/L"},
                        "componentResultInfo": {
                            "value": "140",
                            "isValueRtf": False,
                            "referenceRange": {
                                "low": 135, "high": 145,
                                "formattedReferenceRange": "135 - 145",
                            },
                            "abnormalFlagCategoryValue": "Unknown",
                        },
                        "componentComments": {"hasContent": False, "contentAsString": ""},
                    },
                    {
                        "componentInfo": {"name": "Final Diagnosis", "units": ""},
                        "componentResultInfo": {
                            "value": '<div class="fmtConv">Benign tissue.<br>No malignancy&nbsp;seen.</div>',
                            "isValueRtf": True,
                            "referenceRange": {"formattedReferenceRange": ""},
                            "abnormalFlagCategoryValue": "Unknown",
                        },
                        "componentComments": {"hasContent": False, "contentAsString": ""},
                    },
                    {
                        "componentInfo": {"name": "Urine QC Results", "units": ""},
                        "componentResultInfo": {
                            "value": "Passed",
                            "isValueRtf": False,
                            "referenceRange": {"formattedReferenceRange": ""},
                            "abnormalFlagCategoryValue": "Unknown",
                        },
                        "componentComments": {"hasContent": False, "contentAsString": ""},
                    },
                ],
            }
        ],
    }
]


class TestHtmlToText(unittest.TestCase):
    def test_strips_tags_and_decodes_entities(self):
        out = html_to_text('<div class="fmtConv">Benign tissue.<br>No malignancy&nbsp;seen.</div>')
        self.assertNotIn("<", out)
        self.assertNotIn("fmtConv", out)
        self.assertIn("Benign tissue.", out)
        self.assertIn("No malignancy seen.", out)  # &nbsp; -> normal space
        self.assertEqual(out, "Benign tissue.\nNo malignancy seen.")  # <br> -> newline

    def test_empty(self):
        self.assertEqual(html_to_text(""), "")


class TestLabParser(unittest.TestCase):
    def setUp(self):
        self.records = parse(FIXTURE)

    def test_one_record_per_result(self):
        self.assertEqual(len(self.records), 1)

    def test_order_level_metadata(self):
        rec = self.records[0]
        self.assertEqual(rec["orderName"], "BASIC METABOLIC PANEL")
        self.assertEqual(rec["resultTime"], "2025-11-08T06:23:00-08:00")
        self.assertEqual(rec["specimen"], "Blood (Blood)")
        self.assertEqual(rec["performingLab"], "UCSF LAB")
        self.assertEqual(rec["labAddress"], "400 Parnassus Avenue, San Francisco CA 94122")

    def test_numeric_component_preserved(self):
        sodium = self.records[0]["components"][0]
        self.assertEqual(sodium["testName"], "Sodium, Plasma/Serum")
        self.assertEqual(sodium["value"], "140")
        self.assertEqual(sodium["units"], "mmol/L")
        self.assertEqual(sodium["referenceRange"], "135 - 145")
        self.assertEqual(sodium["refLow"], 135)
        self.assertEqual(sodium["refHigh"], 145)
        self.assertNotIn("isNarrative", sodium)  # numeric values are not narratives

    def test_rtf_narrative_stripped_and_flagged(self):
        diagnosis = self.records[0]["components"][1]
        self.assertEqual(diagnosis["testName"], "Final Diagnosis")
        self.assertTrue(diagnosis["isNarrative"])
        self.assertNotIn("<", diagnosis["value"])
        self.assertIn("Benign tissue.", diagnosis["value"])
        self.assertIn("No malignancy seen.", diagnosis["value"])

    def test_qc_component_dropped(self):
        names = [c["testName"] for c in self.records[0]["components"]]
        self.assertNotIn("Urine QC Results", names)
        self.assertEqual(len(names), 2)

    def test_no_bloat_fields_leak_through(self):
        blob = json.dumps(self.records)
        for junk in ("historicalResults", "showDetails", "cliaNumber", "opaque-id"):
            self.assertNotIn(junk, blob)


# A radiology-style order: NO components, narrative only in reportDetails.reportContent.
RADIOLOGY_FIXTURE = [
    {
        "orderName": "MR BRAIN WITH AND WITHOUT CONTRAST",
        "results": [
            {
                "name": "MR BRAIN WITH AND WITHOUT CONTRAST",
                "isAbnormal": False,
                "orderMetadata": {
                    "orderProviderName": "Dr. Robert Osorio",
                    "prioritizedInstantISO": "2025-11-08T00:00:00-08:00",
                    "resultStatus": "Final",
                    "resultingLab": {"name": "UCSF Radiology", "address": []},
                },
                "resultComponents": [],
                "reportDetails": {
                    "reportContent": {
                        "reportContent": "<div><b>IMPRESSION:</b><br>No acute intracranial&nbsp;abnormality.</div>",
                        "reportCss": ".x{color:red}",
                    },
                },
            }
        ],
    }
]


class TestRadiologyReport(unittest.TestCase):
    def setUp(self):
        self.records = parse(RADIOLOGY_FIXTURE)

    def test_report_only_result_is_kept(self):
        # Even with zero components, the report narrative must survive.
        self.assertEqual(len(self.records), 1)

    def test_report_text_captured_and_stripped(self):
        rec = self.records[0]
        self.assertIn("report", rec)
        self.assertNotIn("<", rec["report"])
        self.assertIn("IMPRESSION:", rec["report"])
        self.assertIn("No acute intracranial abnormality.", rec["report"])  # &nbsp; normalized
        self.assertEqual(rec["components"], [])

    def test_report_css_not_leaked(self):
        self.assertNotIn("color:red", json.dumps(self.records))


class TestRunParsers(unittest.TestCase):
    def test_driver_writes_parsed_file(self):
        with tempfile.TemporaryDirectory() as d:
            out = pathlib.Path(d)
            (out / "lab_results.json").write_text(json.dumps(FIXTURE))

            summary = run_parsers(out, categories=["lab_results"])

            self.assertEqual(len(summary), 1)
            self.assertEqual(summary[0]["status"], "ok")
            parsed_path = out / "lab_results_parsed.json"
            self.assertTrue(parsed_path.exists())
            self.assertTrue((out / "lab_results.json").exists())  # raw kept by default
            data = json.loads(parsed_path.read_text())
            self.assertEqual(len(data), 1)

    def test_replace_raw_overwrites(self):
        with tempfile.TemporaryDirectory() as d:
            out = pathlib.Path(d)
            raw = out / "lab_results.json"
            raw.write_text(json.dumps(FIXTURE))

            run_parsers(out, categories=["lab_results"], replace_raw=True)

            self.assertFalse((out / "lab_results_parsed.json").exists())
            data = json.loads(raw.read_text())  # raw now holds the concise form
            self.assertEqual(data[0]["orderName"], "BASIC METABOLIC PANEL")
            self.assertIn("components", data[0])

    def test_missing_raw_file_is_skipped(self):
        with tempfile.TemporaryDirectory() as d:
            summary = run_parsers(pathlib.Path(d), categories=["lab_results"])
            self.assertEqual(summary, [])

    def test_unregistered_category_ignored(self):
        with tempfile.TemporaryDirectory() as d:
            summary = run_parsers(pathlib.Path(d), categories=["nonexistent_category"])
            self.assertEqual(summary, [])


if __name__ == "__main__":
    unittest.main()
