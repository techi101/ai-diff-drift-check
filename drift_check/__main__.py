"""CLI.

  python -m drift_check eval [data/cases.jsonl]       score the rules on the labeled set
  python -m drift_check check change.diff [SR-01 ...]  check one diff, print a drift report
  python -m drift_check prompt SR-08 change.diff       print the LLM judge prompt for one case
"""
import json
import sys

from .rules import RULES, check_diff, UNKNOWN
from .evaluate import load_cases, run, score, by_kind
from .judge import build_prompt


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    cmd = argv.pop(0)

    if cmd == "eval":
        path = argv[0] if argv else "data/cases.jsonl"
        rows = run(load_cases(path))
        for r in rows:
            mark = "ok " if r["pred"] == r["label"] else ("?? " if r["pred"] == UNKNOWN else "XX ")
            print(f"{mark}{r['id']:<24}{r['req_id']:<7} label={r['label']:<9} pred={r['pred']:<9} [{r['kind']}]")
        print()
        print("overall:", json.dumps(score(rows)))
        for kind, s in by_kind(rows).items():
            print(f"{kind}:", json.dumps(s))
        return 0

    if cmd == "check":
        with open(argv[0], encoding="utf-8") as f:
            diff = f.read()
        results = check_diff(diff, argv[1:] or None)
        for r in results:
            print(f"{r['req_id']}  {r['verdict']:<9} {r['why']}")
        counts = {"validated": 0, "not_validated": 0, "needs_review": 0}
        for r in results:
            key = {"honored": "validated", "violated": "not_validated"}.get(r["verdict"], "needs_review")
            counts[key] += 1
        print(json.dumps(counts))
        return 1 if counts["not_validated"] else 0

    if cmd == "prompt":
        rid, path = argv[0], argv[1]
        with open(path, encoding="utf-8") as f:
            print(build_prompt(rid, RULES[rid].text, f.read()))
        return 0

    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
