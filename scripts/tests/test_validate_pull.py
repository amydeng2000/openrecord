#!/usr/bin/env python3
"""Tests for scripts/validate_pull.py.

Runs the validator as a subprocess against a throwaway git repo so the git-based
regression check is exercised for real. Run with:

    python3 -m unittest discover -s scripts/tests -p 'test_*.py'
"""
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "validate_pull.py"


def git(repo, *args):
    subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True)


def init_repo(repo):
    git(repo, "init", "-q")
    git(repo, "config", "user.email", "t@example.com")
    git(repo, "config", "user.name", "tester")


def write_files(repo, meds, vitals_readings, labs):
    d = repo / "raw" / "mychart"
    d.mkdir(parents=True, exist_ok=True)
    # medications.json is an OBJECT { medications: [...], patientFirstName }, matching
    # what getMedications returns — NOT a bare array.
    (d / "medications.json").write_text(
        json.dumps({"medications": [{"name": f"med{i}"} for i in range(meds)], "patientFirstName": "Test"})
    )
    (d / "vitals.json").write_text(
        json.dumps([{"name": "flowsheet", "readings": [{"v": i} for i in range(vitals_readings)]}])
    )
    (d / "lab_results.json").write_text(json.dumps([{"n": i} for i in range(labs)]))


def run_validate(repo):
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(repo)], capture_output=True, text=True
    )


class ValidatePullTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = pathlib.Path(self._tmp.name)
        init_repo(self.repo)

    def tearDown(self):
        self._tmp.cleanup()

    def test_healthy_first_run_passes(self):
        write_files(self.repo, meds=5, vitals_readings=10, labs=8)
        r = run_validate(self.repo)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_medications_object_shape_not_flagged_empty(self):
        # Regression: medications.json is an object with a nested "medications"
        # array; the validator must count the array, not treat the object as empty.
        write_files(self.repo, meds=18, vitals_readings=10, labs=8)
        r = run_validate(self.repo)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("medications: ok", r.stdout)
        self.assertIn("records=18", r.stdout)

    def test_empty_medications_fails(self):
        write_files(self.repo, meds=0, vitals_readings=10, labs=8)
        r = run_validate(self.repo)
        self.assertEqual(r.returncode, 1)
        self.assertIn("medications", r.stdout)

    def test_empty_vitals_fails(self):
        write_files(self.repo, meds=5, vitals_readings=0, labs=8)
        r = run_validate(self.repo)
        self.assertEqual(r.returncode, 1)
        self.assertIn("vitals", r.stdout)

    def test_missing_file_fails(self):
        write_files(self.repo, meds=5, vitals_readings=10, labs=8)
        (self.repo / "raw" / "mychart" / "medications.json").unlink()
        r = run_validate(self.repo)
        self.assertEqual(r.returncode, 1)
        self.assertIn("medications", r.stdout)

    def test_invalid_json_fails(self):
        write_files(self.repo, meds=5, vitals_readings=10, labs=8)
        (self.repo / "raw" / "mychart" / "lab_results.json").write_text("{ not json")
        r = run_validate(self.repo)
        self.assertEqual(r.returncode, 1)

    def test_sharp_drop_fails(self):
        # Commit a healthy "previous" version, then overwrite with a big vitals drop.
        write_files(self.repo, meds=100, vitals_readings=100, labs=100)
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", "prev")
        write_files(self.repo, meds=100, vitals_readings=10, labs=100)  # 100 -> 10 readings
        r = run_validate(self.repo)
        self.assertEqual(r.returncode, 1)
        self.assertIn("vitals", r.stdout)

    def test_stable_counts_pass(self):
        write_files(self.repo, meds=100, vitals_readings=100, labs=100)
        git(self.repo, "add", "-A")
        git(self.repo, "commit", "-q", "-m", "prev")
        write_files(self.repo, meds=101, vitals_readings=100, labs=102)  # small growth
        r = run_validate(self.repo)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
