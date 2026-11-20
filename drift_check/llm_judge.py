"""A real LLM judge: Gemini over the REST API, standard library only.

make_judge() returns a function with the same shape as offline_judge, so it
plugs straight into evaluate.run(). Each case is asked `repeats` times; the
majority verdict is the prediction (no majority -> unknown). Every reply is
cached on disk keyed by (model, prompt, repeat index), so reruns are free and
the raw replies can be audited.
"""
import hashlib
import json
import os
import time
import urllib.error
import urllib.request
from collections import Counter

from .judge import build_prompt, parse_verdict
from .rules import UNKNOWN

API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


class BillingError(RuntimeError):
    """The API said this needs a paid plan. Stop, do not retry."""


def gemini_call(model, prompt, api_key, timeout=60):
    body = json.dumps({"contents": [{"parts": [{"text": prompt}]}],
                       "generationConfig": {"temperature": 0}}).encode()
    req = urllib.request.Request(API.format(model=model), data=body, method="POST",
                                 headers={"Content-Type": "application/json", "x-goog-api-key": api_key})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        d = json.loads(r.read())
    parts = d["candidates"][0]["content"]["parts"]
    return "".join(p.get("text", "") for p in parts), d.get("modelVersion", model)


def with_retries(fn, tries=6, base=5.0, sleep=time.sleep):
    for i in range(tries):
        try:
            return fn()
        except urllib.error.HTTPError as e:
            msg = e.read().decode("utf-8", "replace")
            if e.code in (400, 403) and ("billing" in msg.lower() or "paid" in msg.lower()):
                raise BillingError(msg[:300])
            if e.code in (429, 500, 503) and i < tries - 1:
                sleep(base * (2 ** i))
                continue
            raise
        except (urllib.error.URLError, TimeoutError):
            if i < tries - 1:
                sleep(base * (2 ** i))
                continue
            raise


def majority(verdicts):
    """Most common verdict if it has a strict majority, else unknown."""
    v, n = Counter(verdicts).most_common(1)[0]
    return v if n > len(verdicts) / 2 else UNKNOWN


def make_judge(model, cache_dir, repeats=3, call=None, log=None, pause=0.0):
    """call(prompt) -> (reply_text, model_version). Defaults to Gemini."""
    if call is None:
        key = os.environ.get("GEMINI_API_KEY")
        if not key:
            raise RuntimeError("GEMINI_API_KEY is not set")
        call = lambda p: with_retries(lambda: gemini_call(model, p, key))  # noqa: E731
    os.makedirs(cache_dir, exist_ok=True)
    log = log if log is not None else {}

    def judge(req_id, req_text, diff, case_id=None):
        prompt = build_prompt(req_id, req_text, diff)
        runs = []
        for i in range(repeats):
            h = hashlib.sha256(f"{model}\n{i}\n{prompt}".encode()).hexdigest()[:24]
            path = os.path.join(cache_dir, h + ".json")
            if os.path.exists(path):
                with open(path, encoding="utf-8") as f:
                    rec = json.load(f)
            else:
                text, version = call(prompt)
                rec = {"model": model, "model_version": version, "repeat": i,
                       "req_id": req_id, "reply": text}
                with open(path, "w", encoding="utf-8", newline="\n") as f:
                    json.dump(rec, f, indent=1)
                if pause:
                    time.sleep(pause)
            verdict, why = parse_verdict(rec["reply"])
            runs.append({"verdict": verdict, "evidence": why, "model_version": rec.get("model_version")})
        final = majority([r["verdict"] for r in runs])
        evidence = next((r["evidence"] for r in runs if r["verdict"] == final), "no majority across runs")
        log[(req_id, diff)] = runs
        return final, evidence

    judge.log = log
    return judge
