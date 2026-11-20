import io
import urllib.error

import pytest

from drift_check.evaluate import load_cases, run, run_judge_only, score, wilson
from drift_check.llm_judge import make_judge, majority, with_retries, BillingError
from drift_check.rules import HONORED, VIOLATED, UNKNOWN
from tests.test_drift_check import CASES, diff


def test_majority_needs_strict_majority():
    assert majority([VIOLATED, VIOLATED, HONORED]) == VIOLATED
    assert majority([VIOLATED, HONORED, UNKNOWN]) == UNKNOWN
    assert majority([HONORED]) == HONORED


def test_judge_caches_replies_and_votes(tmp_path):
    replies = iter(['{"verdict": "violated", "evidence": "a"}',
                    '{"verdict": "honored", "evidence": "b"}',
                    '{"verdict": "violated", "evidence": "c"}'])
    calls = []

    def fake_call(prompt):
        calls.append(prompt)
        return next(replies), "fake-model-001"

    j = make_judge("fake-model", str(tmp_path), repeats=3, call=fake_call)
    assert j("SR-05", "t", diff("+x = 1"))[0] == VIOLATED
    assert len(calls) == 3
    # second time everything comes from the cache: no new calls
    j2 = make_judge("fake-model", str(tmp_path), repeats=3, call=lambda p: pytest.fail("no call expected"))
    assert j2("SR-05", "t", diff("+x = 1"))[0] == VIOLATED


def test_bad_reply_counts_as_unknown(tmp_path):
    j = make_judge("m", str(tmp_path), repeats=1, call=lambda p: ("no json here", "m"))
    assert j("SR-01", "t", diff("+x = 1"))[0] == UNKNOWN


def _http_error(code, msg):
    return urllib.error.HTTPError("u", code, "x", {}, io.BytesIO(msg.encode()))


def test_retries_on_429_then_succeeds():
    seq = [_http_error(429, "quota, check your plan and billing details"), _http_error(503, "busy")]

    def fn():
        if seq:
            raise seq.pop(0)
        return "ok"

    assert with_retries(fn, sleep=lambda s: None) == "ok"


def test_billing_error_stops_immediately():
    def fn():
        raise _http_error(403, "This model requires billing to be enabled")

    with pytest.raises(BillingError):
        with_retries(fn, sleep=lambda s: None)


def test_judge_only_calls_judge_for_every_case():
    cases = load_cases(CASES)
    rows = run_judge_only(cases, lambda r, t, d: (VIOLATED, "x"))
    assert len(rows) == 31 and all(r["stage"] == "judge" for r in rows)
    assert score(rows)["caught"] == 17


def test_cascade_with_perfect_judge_fixes_only_unknowns():
    cases = {c["id"]: c for c in load_cases(CASES)}
    by_diff = {(c["req_id"], c["diff"]): c["label"] for c in cases.values()}
    s = score(run(list(cases.values()), judge=lambda r, t, d: (by_diff[(r, d)], "oracle")))
    # unknowns become right; the rule mistakes (2 false alarms, 1 silent miss) stay
    assert (s["caught"], s["false_alarms"], s["silent_misses"], s["sent_to_review"]) == (16, 2, 1, 0)


def test_wilson_interval():
    assert wilson(0, 0) is None
    lo, hi = wilson(1, 6)
    assert 0.02 < lo < 0.04 and 0.55 < hi < 0.57
    assert wilson(10, 10)[1] == 1.0
