# drift-check: a small eval for "does the AI-written code honor the security review?"

A weekend-sized proof of work, built against one specific step of Seezo's product.

## The problem

Seezo's AI Plugin page describes a **Validate** step for code written by coding agents:

> "Validate: Check if the generated code addresses the assessment content. Any drift between security requirements and what was built is reported and persistent."
> (https://seezo.io/seezo-ai-plugin, read 20 Nov 2026)

Their blog post says what question that step answers:

> "When code exists, Seezo can validate the implementation against the requirements from the assessment, locally or in CI. This is not a replacement for every form of code scanning. It answers a focused question: does the implementation honor the security design decisions and requirements that were reviewed?"
> (https://seezo.io/blog/dont-let-security-get-left-behind-in-agentic-development, Jul 24 2026)

and sets the bar it has to meet: "Deliver results reliable, scalable, and useful enough to ensure developers do not disconnect the security tools."

The Applied AI Engineer job post lists "Building and operationalizing LLM evals pipelines for cybersecurity applications" and "Creating security-focused benchmarks and test sets" (https://seezo.io/jobs/applied-ai-engineer).

I could not find a public test set for that Validate question (requirement + agent diff, labeled honored or violated). Seezo's public GitHub org (github.com/Seezo-io) has `cursor-security-rules`, `llm-security-101` and `homebrew-tap`; the tap README says the CLI repo is internal. So this repo builds a tiny version of that test set and a scorer for it. It is not a claim about how Seezo's validator works; I have not seen it.

## What is in here

- `data/build_cases.py` writes `data/cases.jsonl`: **31 hand-written diffs** across **10 security requirements** (password hashing, parameterized SQL, hardcoded secrets, cookie flags, TLS verification, JWT verification, secrets in logs, invoice IDOR, login rate limit, file uploads). Each diff is labeled `honored` or `violated` by hand. 21 are `plain` (what an agent normally writes), 10 are `hard` (indirection, helpers, look-alike strings, written to sit where pattern matching is weak).
- `drift_check/rules.py`: a baseline validator. One regex rule per requirement, looking only at lines the diff adds. It answers `honored`, `violated`, or `unknown`. `unknown` means "touched this area but I cannot decide", which is the honest answer for things like authorization checks.
- `drift_check/judge.py`: the second stage for `unknown` cases. It builds the LLM judge prompt and parses replies safely (bad JSON or odd verdicts fall back to `unknown`). **It makes no model call.** The default judge abstains, so all numbers below come from the rules alone and the whole thing runs offline in under a second.
- `drift_check/evaluate.py`: scoring. `violated` is the positive class. It reports caught, false alarms, silent misses (said `honored` on a real violation, the worst outcome) and how many cases go to review, split by `plain` vs `hard`. It also prints a `validated / not_validated / needs_review` summary.

## How to run

Python 3.10+, standard library only (pytest for the tests).

```
python data/build_cases.py              # writes data/cases.jsonl
python -m drift_check eval              # score the rules on all 31 cases
python -m drift_check check my.diff     # check one diff against all 10 requirements, exit 1 on a violation
python -m drift_check prompt SR-08 my.diff   # print the judge prompt for one requirement
python -m pytest -q
```

`check` exits non-zero when anything is `violated`, so it can sit in a pre-commit hook or a CI step.

## Results (real output, 20 Nov 2026)

| subset | cases | violations | caught | false alarms | silent misses | sent to review | precision | recall |
|---|---|---|---|---|---|---|---|---|
| plain | 21 | 11 | 10 | 0 | 0 | 1 | 1.00 | 0.91 |
| hard | 10 | 6 | 1 | 2 | 1 | 6 | 0.33 | 0.17 |
| all | 31 | 17 | 11 | 2 | 1 | 7 | 0.85 | 0.65 |

Tests: 28 passed.

What the misses look like:
- **Silent miss**: `logger.debug("incoming request headers: %s", dict(request.headers))` logs the Authorization header, but no forbidden word appears on the line, so the rule says `honored`.
- **False alarms**: a fake token in a test fixture is flagged as a hardcoded secret; `"password reset link expired"` in a log message is flagged as logging a password.
- **Sent to review**: SQL built in a variable then executed, hashing behind a helper, `algorithms=ALLOWED_ALGS` held in a variable, an ownership check inside `load_owned()`, and the plain IDOR case (an endpoint that loads an invoice by id with no owner check; regex cannot prove an absence of authorization).

The takeaway: rules are fine on the obvious diffs and fall apart exactly where the Validate step matters most (authorization, data flow through variables and helpers). That is the case for an LLM judge on the `unknown` slice, and for a labeled set like this one to measure whether the judge is actually better before shipping it.

## Honest limits

- **The plain numbers are in-sample.** I wrote the rules and the plain cases together, so 1.00 precision on plain says little. The hard set is the more honest number, and it is only 10 cases.
- 31 cases, one labeler (me), Python/Flask only. No inter-rater check. Real agent sessions produce bigger diffs that span files.
- The rules see one diff at a time with no repo context, so they cannot follow a helper into another file.
- No LLM was run. The judge stage is wired in and tested with a fake judge, but there are no LLM numbers here.
- All code in the cases is synthetic and written for this repo. No customer data, no Seezo data.

## Next steps if this were real

1. Grow the hard set with real agent-written diffs (e.g. from public repos with Claude Code / Cursor commits) and two labelers.
2. Run an LLM judge on the `unknown` slice only and compare silent misses and false alarms against rules alone.
3. Track the same metrics per release so a prompt or model change that raises silent misses fails CI.
