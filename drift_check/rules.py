"""Rule checks: does an added code diff honor one security requirement?

Each rule looks only at lines the diff ADDS. It returns one verdict:
  "honored"  - the change touches this area and does the right thing,
               or does not touch the area at all
  "violated" - the change touches this area and does the wrong thing
  "unknown"  - the change touches this area but a regex cannot decide
               (send it to a human or an LLM judge)
"""
import re
from dataclasses import dataclass, field

HONORED, VIOLATED, UNKNOWN = "honored", "violated", "unknown"


def added_lines(diff_text):
    """Return the lines a unified diff adds (without the leading '+')."""
    out = []
    for line in diff_text.splitlines():
        if line.startswith("+") and not line.startswith("+++"):
            out.append(line[1:])
    return out


@dataclass
class Rule:
    req_id: str
    text: str                       # requirement as a reviewer would write it
    applies: str                    # regex: the diff touches this area
    bad: list = field(default_factory=list)    # any match -> violated
    good: list = field(default_factory=list)   # needed to call it honored
    # if the area is touched, no bad match and no good pattern given:
    default_when_touched: str = HONORED

    def check(self, diff_text):
        lines = added_lines(diff_text)
        body = "\n".join(lines)
        if not re.search(self.applies, body, re.I | re.M):
            return HONORED, "area not touched by this diff"
        for pat in self.bad:
            m = re.search(pat, body, re.I | re.M)
            if m:
                return VIOLATED, "matched bad pattern: " + m.group(0).strip()[:80]
        if not self.good:
            return self.default_when_touched, "touched, no bad pattern found"
        for pat in self.good:
            if re.search(pat, body, re.I | re.M):
                return HONORED, "matched good pattern"
        return UNKNOWN, "touched, but neither a good nor a bad pattern matched"


RULES = {
    r.req_id: r for r in [
        Rule(
            "SR-01",
            "User passwords must be stored only as salted hashes (bcrypt or argon2). "
            "Fast hashes like MD5/SHA-1/SHA-256 or plain text are not allowed.",
            applies=r"password",
            bad=[r"hashlib\.(md5|sha1|sha256|sha512)\(.*pass",
                 r"\.password(_hash)?\s*=\s*(request\.\w+\[|password\b|data\[)"],
            good=[r"bcrypt\.", r"argon2", r"generate_password_hash\("],
        ),
        Rule(
            "SR-02",
            "All database queries must use parameterized statements. "
            "No string formatting or concatenation into SQL.",
            applies=r"\.execute\(",
            bad=[r"\.execute\(\s*f[\"']", r"\.execute\([^)]*[\"']\s*%\s*\w",
                 r"\.execute\([^)]*[\"']\s*\+", r"\.execute\([^)]*\.format\("],
            good=[r"\.execute\(\s*[\"'][^\"']*(\?|%s|:\w+)[^\"']*[\"']\s*,"],
        ),
        Rule(
            "SR-03",
            "Secrets (API keys, tokens, DB passwords) must come from the environment "
            "or a secrets manager, never be hardcoded.",
            applies=r"(api_?key|secret(_key)?|token|db_?pass(word)?)\s*=",
            bad=[r"(api_?key|secret(_key)?|token|db_?pass(word)?)\s*=\s*[\"'][A-Za-z0-9_\-]{12,}[\"']"],
            good=[r"os\.environ", r"os\.getenv\(", r"secrets_manager|get_secret\("],
        ),
        Rule(
            "SR-04",
            "Session cookies must be set with HttpOnly, Secure and SameSite.",
            applies=r"set_cookie\(",
            bad=[r"set_cookie\((?![^)]*httponly\s*=\s*True)[^)]*\)",
                 r"set_cookie\((?![^)]*secure\s*=\s*True)[^)]*\)"],
            good=[r"samesite\s*="],
        ),
        Rule(
            "SR-05",
            "Outbound HTTPS calls must verify TLS certificates.",
            applies=r"requests\.\w+\(|httpx\.|ssl\.",
            bad=[r"verify\s*=\s*False", r"CERT_NONE", r"_create_unverified_context"],
        ),
        Rule(
            "SR-06",
            "JWTs must be verified with an explicit allow-list of algorithms; "
            "signature verification must never be turned off.",
            applies=r"jwt\.decode\(",
            bad=[r"verify_signature[\"']?\s*:\s*False", r"algorithms\s*=\s*\[\s*[\"']none[\"']",
                 r"verify\s*=\s*False"],
            good=[r"algorithms\s*=\s*\[\s*[\"'](HS|RS|ES|PS)\d{3}"],
        ),
        Rule(
            "SR-07",
            "Passwords, tokens and auth headers must never be written to logs.",
            applies=r"(log(ger|ging)?\.\w+|print)\(",
            bad=[r"(log(ger|ging)?\.\w+|print)\([^\n]*(password|passwd|token|authorization|api_?key)"],
        ),
        Rule(
            "SR-08",
            "Any endpoint that loads an invoice by id must check the invoice "
            "belongs to the logged-in user (no IDOR).",
            applies=r"invoice",
            bad=[],
            good=[r"owner_id\s*==\s*current_user\.id", r"filter_by\([^)]*owner_id\s*=\s*current_user\.id",
                  r"user_id\s*==\s*current_user\.id"],
        ),
        Rule(
            "SR-09",
            "The login endpoint must be rate limited.",
            applies=r"route\([\"']/login",
            good=[r"@limiter\.limit\(", r"rate_limit"],
            # login route touched but no limiter decorator: that is a violation
            bad=[r"route\([\"']/login[^\n]*\)\s*\n(?!\s*@limiter)"],
        ),
        Rule(
            "SR-10",
            "File uploads must sanitise the filename and allow only listed extensions.",
            applies=r"request\.files",
            bad=[r"\.save\([^)]*\.filename\)"],
            # honored only if the diff both sanitises the name and checks an allow-list
            good=[r"(?s)\A(?=.*secure_filename\()(?=.*ALLOWED_EXT)"],
        ),
    ]
}


def check_diff(diff_text, req_ids=None):
    """Check one diff against a list of requirement ids (default: all)."""
    ids = req_ids or list(RULES)
    results = []
    for rid in ids:
        verdict, why = RULES[rid].check(diff_text)
        results.append({"req_id": rid, "verdict": verdict, "why": why})
    return results
