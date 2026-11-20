import os
import subprocess
import sys

import pytest

from drift_check.rules import RULES, added_lines, check_diff, HONORED, VIOLATED, UNKNOWN
from drift_check.judge import build_prompt, parse_verdict, offline_judge
from drift_check.evaluate import load_cases, run, score, by_kind, drift_report

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CASES = os.path.join(ROOT, "data", "cases.jsonl")


def diff(*lines):
    return "--- a/x.py\n+++ b/x.py\n@@ -1 +1 @@\n" + "\n".join(lines) + "\n"


# ---- diff parsing ----

def test_added_lines_skips_headers_removed_and_context():
    text = "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n same\n+new one\n+new two\n"
    assert added_lines(text) == ["new one", "new two"]


def test_removed_bad_code_is_not_flagged():
    # the agent removed verify=False: that is a fix, not a violation
    text = diff("-r = requests.get(u, verify=False)", "+r = requests.get(u)")
    assert RULES["SR-05"].check(text)[0] == HONORED


def test_untouched_area_is_honored():
    assert RULES["SR-06"].check(diff("+x = 1"))[0] == HONORED


# ---- one check per rule, both directions ----

@pytest.mark.parametrize("rid,bad,good", [
    ("SR-01", "+h = hashlib.md5(password.encode())", "+h = bcrypt.hashpw(password.encode(), bcrypt.gensalt())"),
    ("SR-02", "+cur.execute(\"SELECT 1 WHERE a = '%s'\" % a)", "+cur.execute(\"SELECT 1 WHERE a = %s\", (a,))"),
    ("SR-03", "+secret_key = \"abcdefghijklmnop\"", "+secret_key = os.getenv(\"SECRET_KEY\")"),
    ("SR-04", "+resp.set_cookie('s', v, secure=True)", "+resp.set_cookie('s', v, httponly=True, secure=True, samesite='Strict')"),
    ("SR-05", "+ctx = ssl._create_unverified_context()", "+r = requests.post(u, json=b)"),
    ("SR-06", "+c = jwt.decode(t, k, algorithms=['none'])", "+c = jwt.decode(t, k, algorithms=['HS256'])"),
    ("SR-07", "+print('token', token)", "+print('done')"),
    ("SR-09", "+@app.route('/login')\n+def login(): pass", "+@app.route('/login')\n+@limiter.limit('5/minute')\n+def login(): pass"),
    ("SR-10", "+f = request.files['a']\n+f.save(f.filename)",
     "+ALLOWED_EXT = {'png'}\n+f = request.files['a']\n+n = secure_filename(f.filename)"),
])
def test_rule_bad_and_good(rid, bad, good):
    assert RULES[rid].check(diff(bad))[0] == VIOLATED
    assert RULES[rid].check(diff(good))[0] == HONORED


def test_idor_without_owner_check_is_unknown_not_honored():
    # rules must not claim an authz check passed when they cannot see one
    text = diff("+inv = Invoice.query.get(invoice_id)")
    assert RULES["SR-08"].check(text)[0] == UNKNOWN


def test_check_diff_returns_one_result_per_requirement():
    res = check_diff(diff("+x = 1"))
    assert [r["req_id"] for r in res] == list(RULES)
    assert check_diff(diff("+x = 1"), ["SR-02"])[0]["req_id"] == "SR-02"


# ---- judge prompt + parsing ----

def test_build_prompt_contains_requirement_and_diff():
    p = build_prompt("SR-08", RULES["SR-08"].text, diff("+inv = load(1)"))
    assert "SR-08" in p and "belongs to the logged-in user" in p and "+inv = load(1)" in p


@pytest.mark.parametrize("reply,expected", [
    ('{"verdict": "violated", "evidence": "verify=False"}', VIOLATED),
    ('Sure! ```json\n{"verdict": "Honored", "evidence": "x"}\n```', HONORED),
    ('{"verdict": "probably fine"}', UNKNOWN),
    ('not json at all', UNKNOWN),
    ('{"verdict": "violated",}', UNKNOWN),
    (None, UNKNOWN),
])
def test_parse_verdict_is_safe(reply, expected):
    assert parse_verdict(reply)[0] == expected


def test_offline_judge_abstains():
    assert offline_judge("SR-01", "t", "d")[0] == UNKNOWN


# ---- scoring ----

def test_score_math():
    rows = [
        {"label": VIOLATED, "pred": VIOLATED, "kind": "a"},   # caught
        {"label": VIOLATED, "pred": UNKNOWN, "kind": "a"},    # sent to review
        {"label": VIOLATED, "pred": HONORED, "kind": "b"},    # silent miss
        {"label": HONORED, "pred": VIOLATED, "kind": "b"},    # false alarm
        {"label": HONORED, "pred": HONORED, "kind": "b"},
    ]
    s = score(rows)
    assert s["caught"] == 1 and s["false_alarms"] == 1 and s["silent_misses"] == 1
    assert s["sent_to_review"] == 1 and s["violations_in_set"] == 3
    assert s["precision"] == 0.5 and s["recall"] == 0.333
    assert s["accuracy_when_decided"] == 0.5
    assert set(by_kind(rows)) == {"a", "b"}


def test_drift_report_counts():
    rows = [{"pred": HONORED}, {"pred": HONORED}, {"pred": VIOLATED}, {"pred": UNKNOWN}]
    assert drift_report(rows) == {"validated": 2, "not_validated": 1, "needs_review": 1}


def test_judge_is_only_called_for_unknowns():
    calls = []

    def fake_judge(rid, text, d):
        calls.append(rid)
        return VIOLATED, "fake"

    rows = run(load_cases(CASES), judge=fake_judge)
    assert all(r["stage"] == "judge" for r in rows if r["id"] in
               {c for c in ["sr08-plain-bad", "sr02-hard-indirect"]})
    assert len(calls) == sum(r["stage"] == "judge" for r in rows)


# ---- the labeled set ----

def test_dataset_is_well_formed():
    cases = load_cases(CASES)
    assert len(cases) == 31
    assert len({c["id"] for c in cases}) == len(cases)
    for c in cases:
        assert c["req_id"] in RULES
        assert c["label"] in (HONORED, VIOLATED)
        assert c["kind"] in ("plain", "hard")
        assert added_lines(c["diff"])


def test_eval_numbers_match_readme():
    # locks the README numbers: if a rule changes, this test says so
    s = score(run(load_cases(CASES)))
    assert (s["caught"], s["false_alarms"], s["silent_misses"], s["sent_to_review"]) == (11, 2, 1, 7)


# ---- CLI ----

def test_cli_check_exits_nonzero_on_violation(tmp_path):
    p = tmp_path / "c.diff"
    p.write_text(diff("+r = requests.get(u, verify=False)"), encoding="utf-8")
    out = subprocess.run([sys.executable, "-m", "drift_check", "check", str(p), "SR-05"],
                         cwd=ROOT, capture_output=True, text=True)
    assert out.returncode == 1
    assert '"not_validated": 1' in out.stdout
