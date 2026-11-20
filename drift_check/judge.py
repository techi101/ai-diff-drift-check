"""Second stage for cases the rules mark "unknown": an LLM judge.

Nothing here calls a model. build_prompt() makes the exact text you would
send, and parse_verdict() turns a model reply into a verdict safely.
The default judge used by the eval is offline and returns "unknown",
so every number in the README comes from the rules alone.
"""
import json
import re

from .rules import HONORED, VIOLATED, UNKNOWN

PROMPT = """You are checking whether a code change honors ONE security requirement
from a security design review.

Requirement {req_id}: {req_text}

Code diff (only '+' lines are new code):
```diff
{diff}
```

Answer with JSON only, no prose:
{{"verdict": "honored" | "violated" | "unknown", "evidence": "<the line that decides it>"}}
Use "unknown" if the diff does not contain enough code to decide."""


def build_prompt(req_id, req_text, diff):
    return PROMPT.format(req_id=req_id, req_text=req_text, diff=diff.strip())


def parse_verdict(reply):
    """Pull a verdict out of a model reply. Anything malformed -> unknown."""
    if not isinstance(reply, str):
        return UNKNOWN, "reply was not text"
    m = re.search(r"\{.*\}", reply, re.S)
    if not m:
        return UNKNOWN, "no JSON object in reply"
    try:
        obj = json.loads(m.group(0))
    except json.JSONDecodeError:
        return UNKNOWN, "JSON did not parse"
    verdict = str(obj.get("verdict", "")).strip().lower()
    if verdict not in (HONORED, VIOLATED, UNKNOWN):
        return UNKNOWN, "verdict not one of the allowed values"
    return verdict, str(obj.get("evidence", ""))[:200]


def offline_judge(req_id, req_text, diff):
    """Default judge: makes no call, always abstains."""
    return UNKNOWN, "offline judge (no model call)"
