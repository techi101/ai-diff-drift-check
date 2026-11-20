"""Builds demo/data.json from the real eval.

Run from the repo root:  python demo/build_data.py
Every verdict and score comes from drift_check (run, score, by_kind).
The only thing added here is DRIFT_LINE: for each case labeled "violated",
the added line that makes it a violation, so the demo can highlight it.
Labels are not changed.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from drift_check.rules import RULES, VIOLATED, UNKNOWN, HONORED  # noqa: E402
from drift_check.evaluate import load_cases, run, score, by_kind  # noqa: E402
from drift_check.judge import build_prompt  # noqa: E402

# Public CWE ids for each requirement (context only, not used in scoring).
CWE = {
    "SR-01": ("CWE-916", "Weak password hash"),
    "SR-02": ("CWE-89", "SQL injection"),
    "SR-03": ("CWE-798", "Hardcoded credentials"),
    "SR-04": ("CWE-1004", "Sensitive cookie without HttpOnly"),
    "SR-05": ("CWE-295", "Certificate not validated"),
    "SR-06": ("CWE-347", "JWT signature not verified"),
    "SR-07": ("CWE-532", "Secrets in logs"),
    "SR-08": ("CWE-639", "IDOR"),
    "SR-09": ("CWE-307", "No login rate limit"),
    "SR-10": ("CWE-434", "Unrestricted file upload"),
}
SHORT = {
    "SR-01": "Password hashing", "SR-02": "Parameterized SQL", "SR-03": "No hardcoded secrets",
    "SR-04": "Cookie flags", "SR-05": "TLS verification", "SR-06": "JWT verification",
    "SR-07": "No secrets in logs", "SR-08": "Invoice ownership check", "SR-09": "Login rate limit",
    "SR-10": "Safe file uploads",
}

# Substring of the added line that carries the violation (labeled cases only).
DRIFT_LINE = {
    "sr01-plain-bad": ("hashlib.sha256", "Password stored with a fast SHA256 hash, not bcrypt or argon2."),
    "sr01-plain-bad2": ("user.password =", "Raw form password saved straight onto the user."),
    "sr01-hard-helper": ("quick_digest(password)", "quick_digest wraps MD5, hidden behind a helper import."),
    "sr02-plain-bad": ("cur.execute(f", "User input formatted into the SQL string with an f string."),
    "sr02-hard-indirect": ("q = ", "SQL built by concatenation in a variable, then executed."),
    "sr03-plain-bad": ("sk_live", "Live API key written into source."),
    "sr04-plain-bad": ("set_cookie(", "Session cookie set with no HttpOnly, Secure or SameSite."),
    "sr04-hard-partial": ("set_cookie(", "HttpOnly and Secure are set, SameSite is missing."),
    "sr05-plain-bad": ("verify=False", "Certificate checks turned off on the outbound call."),
    "sr05-hard-session": ("s.verify = False", "Certificate checks turned off on the whole session."),
    "sr06-plain-bad": ("verify_signature", "JWT decoded with signature verification switched off."),
    "sr07-plain-bad": ("logger.info", "Password written to the log line."),
    "sr07-hard-headers": ("logger.debug", "All request headers logged, which includes Authorization."),
    "sr08-plain-bad": ("get_or_404(invoice_id)", "Invoice loaded by id with no check that it belongs to the caller."),
    "sr09-plain-bad": ("@app.route('/login'", "Login route added with no rate limiter."),
    "sr10-plain-bad": ("f.save(", "Upload saved under the client supplied filename."),
    "sr10-hard-noext": ("f.save(", "Filename is sanitised but there is no extension allow list."),
}


def outcome(label, pred):
    if label == VIOLATED:
        return {VIOLATED: "caught", HONORED: "silent_miss", UNKNOWN: "review_violation"}[pred]
    return {VIOLATED: "false_alarm", HONORED: "correct_pass", UNKNOWN: "review_ok"}[pred]


def main():
    cases = load_cases(os.path.join(ROOT, "data", "cases.jsonl"))
    rows = run(cases)
    by_id = {c["id"]: c for c in cases}
    out_cases = []
    for r in rows:
        c = by_id[r["id"]]
        drift = DRIFT_LINE.get(r["id"]) if r["label"] == VIOLATED else None
        evidence = r["why"].split("matched bad pattern: ", 1)[1] if r["why"].startswith("matched bad pattern: ") else None
        item = {
            "id": r["id"], "req_id": r["req_id"], "kind": r["kind"], "label": r["label"],
            "pred": r["pred"], "stage": r["stage"], "why": r["why"],
            "outcome": outcome(r["label"], r["pred"]), "diff": c["diff"],
            "drift_match": drift[0] if drift else None, "drift_note": drift[1] if drift else None,
            "regex_evidence": evidence,
        }
        if r["pred"] == UNKNOWN:
            item["judge_prompt"] = build_prompt(r["req_id"], RULES[r["req_id"]].text, c["diff"])
        out_cases.append(item)
    data = {
        "requirements": [{"id": k, "text": RULES[k].text, "short": SHORT[k],
                          "cwe": CWE[k][0], "cwe_name": CWE[k][1]} for k in RULES],
        "cases": out_cases,
        "scores": {"all": score(rows), **by_kind(rows)},
        "judge": {"run": False, "note": "drift_check/judge.py builds the prompt and parses replies, "
                  "but the eval uses offline_judge, which makes no model call and abstains."},
    }
    with open(os.path.join(ROOT, "demo", "data.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, indent=1)
    print("wrote demo/data.json:", len(out_cases), "cases")
    for k, s in data["scores"].items():
        print(k, s)


if __name__ == "__main__":
    main()
