"""Score a validator on the labeled cases in data/cases.jsonl.

"violated" is the positive class: the thing a security team wants caught.
An "unknown" answer is not a catch, so it counts against recall, and it
is also reported on its own as the share of cases a human would review.
"""
import json
from collections import Counter

from .rules import RULES, VIOLATED, UNKNOWN
from .judge import offline_judge


def load_cases(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def run(cases, judge=offline_judge):
    rows = []
    for c in cases:
        rule = RULES[c["req_id"]]
        verdict, why = rule.check(c["diff"])
        stage = "rules"
        if verdict == UNKNOWN:
            verdict, why = judge(c["req_id"], rule.text, c["diff"])
            stage = "judge"
        rows.append({"id": c["id"], "req_id": c["req_id"], "label": c["label"],
                     "kind": c.get("kind", "plain"), "pred": verdict,
                     "stage": stage, "why": why})
    return rows


def score(rows):
    n = len(rows)
    tp = sum(r["label"] == VIOLATED and r["pred"] == VIOLATED for r in rows)
    fp = sum(r["label"] != VIOLATED and r["pred"] == VIOLATED for r in rows)
    fn_missed = sum(r["label"] == VIOLATED and r["pred"] not in (VIOLATED, UNKNOWN) for r in rows)
    fn_unknown = sum(r["label"] == VIOLATED and r["pred"] == UNKNOWN for r in rows)
    pos = tp + fn_missed + fn_unknown
    unknown = sum(r["pred"] == UNKNOWN for r in rows)
    decided = [r for r in rows if r["pred"] != UNKNOWN]
    correct_decided = sum(r["pred"] == r["label"] for r in decided)
    return {
        "cases": n,
        "violations_in_set": pos,
        "caught": tp,
        "false_alarms": fp,
        "silent_misses": fn_missed,        # said "honored" on a real violation: the worst case
        "sent_to_review": unknown,
        "precision": round(tp / (tp + fp), 3) if tp + fp else None,
        "recall": round(tp / pos, 3) if pos else None,
        "accuracy_when_decided": round(correct_decided / len(decided), 3) if decided else None,
        "decided_share": round(len(decided) / n, 3) if n else None,
    }


def by_kind(rows):
    out = {}
    for kind in sorted({r["kind"] for r in rows}):
        out[kind] = score([r for r in rows if r["kind"] == kind])
    return out


def drift_report(rows):
    """Summary in the same shape as 'validated / not validated' counts."""
    c = Counter(r["pred"] for r in rows)
    return {"validated": c.get("honored", 0), "not_validated": c.get("violated", 0),
            "needs_review": c.get("unknown", 0)}
