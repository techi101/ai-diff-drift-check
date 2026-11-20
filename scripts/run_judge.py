"""Run the Gemini judge and write a results file.

  python scripts/run_judge.py MODEL [CASES] [OUT] [CACHE_TAG]

v1 (with hint comments):  gemini-3.5-flash-lite data/cases_v1_with_hints.jsonl results/judge_results_v1_with_hints.json ""
v2 (hints removed):       MODEL data/cases.jsonl results/judge_v2_MODEL.json v2

Run 1 (cascade): rules first, judge only on cases the rules call unknown.
Run 2 (judge alone): judge on all 31 cases, no rules.
Each case is asked 3 times at temperature 0; majority vote is the prediction.
Replies are cached in results/judge_cache/, so a rerun makes no API calls.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from drift_check.evaluate import load_cases, run, run_judge_only, score, by_kind, wilson  # noqa: E402
from drift_check.judge import offline_judge  # noqa: E402
from drift_check.llm_judge import make_judge  # noqa: E402

ARGS = sys.argv[1:]
MODEL = ARGS[0] if len(ARGS) > 0 else "gemini-3.5-flash-lite"
CASES = ARGS[1] if len(ARGS) > 1 else "data/cases.jsonl"
OUT = ARGS[2] if len(ARGS) > 2 else f"results/judge_v2_{MODEL}.json"
TAG = ARGS[3] if len(ARGS) > 3 else "v2"


def summary(rows):
    out = {"all": score(rows), **by_kind(rows)}
    for k, s in out.items():
        sub = rows if k == "all" else [r for r in rows if r["kind"] == k]
        honored = sum(r["label"] != "violated" for r in sub)
        s["honored_in_set"] = honored
        s["recall_ci95"] = wilson(s["caught"], s["violations_in_set"])
        flagged = s["caught"] + s["false_alarms"]
        s["precision_ci95"] = wilson(s["caught"], flagged)
        s["false_alarm_rate_ci95"] = wilson(s["false_alarms"], honored)
    return out


def main():
    cases = load_cases(os.path.join(ROOT, CASES))
    log = {}
    judge = make_judge(MODEL, os.path.join(ROOT, "results", "judge_cache"), repeats=3, log=log, pause=4.5,
                       cache_tag=TAG)

    regex = run(cases, judge=offline_judge)
    cascade = run(cases, judge=judge)
    alone = run_judge_only(cases, judge)

    per_case = {}
    for c in cases:
        runs = log.get((c["req_id"], c["diff"]), [])
        verdicts = [r["verdict"] for r in runs]
        per_case[c["id"]] = {
            "runs": runs,
            "unanimous": len(set(verdicts)) == 1,
            "judge_alone": next(r["pred"] for r in alone if r["id"] == c["id"]),
            "judge_alone_why": next(r["why"] for r in alone if r["id"] == c["id"]),
            "cascade": next(r["pred"] for r in cascade if r["id"] == c["id"]),
            "cascade_stage": next(r["stage"] for r in cascade if r["id"] == c["id"]),
        }
    versions = sorted({r["model_version"] for v in log.values() for r in v if r.get("model_version")})
    unanimous = sum(v["unanimous"] for v in per_case.values())
    cascade_ids = [r["id"] for r in regex if r["pred"] == "unknown"]
    out = {
        "model": MODEL, "cases_file": CASES, "cache_tag": TAG, "model_versions": versions, "temperature": 0, "repeats": 3,
        "stability": {
            "all_cases_unanimous": unanimous, "all_cases": len(cases),
            "cascade_cases_unanimous": sum(per_case[i]["unanimous"] for i in cascade_ids),
            "cascade_cases": len(cascade_ids),
            "total_calls": 3 * len(cases),
        },
        "regex": summary(regex), "cascade": summary(cascade), "judge_alone": summary(alone),
        "per_case": per_case,
    }
    with open(os.path.join(ROOT, OUT), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=1)
    for name in ("regex", "cascade", "judge_alone"):
        for k in ("plain", "hard", "all"):
            s = out[name][k]
            print(f"{name:12}{k:6} caught {s['caught']}/{s['violations_in_set']} recall {s['recall']} "
                  f"prec {s['precision']} FA {s['false_alarms']}/{s['honored_in_set']} silent {s['silent_misses']} "
                  f"review {s['sent_to_review']}  recallCI {s['recall_ci95']}")
    print("stability", out["stability"], "versions", versions)


if __name__ == "__main__":
    main()
