"""Writes data/cases.jsonl: small hand-written diffs, each labeled by hand.

kind = "plain": the kind of diff a coding agent writes in a normal session.
kind = "hard":  written on purpose to sit where regex rules are weak
                (indirection, helpers, look-alike strings). Labels for these
                were decided from what the code does, before running the rules.
All code is synthetic and written for this repo.
"""
import json
import os


def d(*lines):
    """Make a small unified diff from '+'/'-'/' ' prefixed lines."""
    return "--- a/app.py\n+++ b/app.py\n@@ -1,1 +1,1 @@\n" + "\n".join(lines) + "\n"


CASES = [
    # SR-01 password storage
    ("sr01-plain-bad", "SR-01", "violated", "plain", d(
        "+import hashlib",
        "+def register(username, password):",
        "+    digest = hashlib.sha256(password.encode()).hexdigest()",
        "+    db.insert_user(username, digest)")),
    ("sr01-plain-ok", "SR-01", "honored", "plain", d(
        "+import bcrypt",
        "+def register(username, password):",
        "+    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt())",
        "+    db.insert_user(username, hashed)")),
    ("sr01-plain-bad2", "SR-01", "violated", "plain", d(
        "+@app.route('/signup', methods=['POST'])",
        "+def signup():",
        "+    user = User(email=request.form['email'])",
        "+    user.password = request.form['password']",
        "+    db.session.add(user)")),
    ("sr01-hard-helper", "SR-01", "violated", "hard", d(
        "+from .util import quick_digest  # wraps hashlib.md5",
        "+def register(username, password):",
        "+    db.insert_user(username, quick_digest(password))")),

    # SR-02 SQL
    ("sr02-plain-bad", "SR-02", "violated", "plain", d(
        "+def find_user(cur, email):",
        "+    cur.execute(f\"SELECT * FROM users WHERE email = '{email}'\")",
        "+    return cur.fetchone()")),
    ("sr02-plain-ok", "SR-02", "honored", "plain", d(
        "+def find_user(cur, email):",
        "+    cur.execute(\"SELECT * FROM users WHERE email = ?\", (email,))",
        "+    return cur.fetchone()")),
    ("sr02-hard-indirect", "SR-02", "violated", "hard", d(
        "+def search(cur, term):",
        "+    q = \"SELECT * FROM items WHERE name LIKE '%\" + term + \"%'\"",
        "+    cur.execute(q)")),

    # SR-03 secrets
    ("sr03-plain-bad", "SR-03", "violated", "plain", d(
        "+STRIPE_API_KEY = None",
        "+api_key = \"sk_live_51HxQ2bExampleExample\"",
        "+client = Stripe(api_key)")),
    ("sr03-plain-ok", "SR-03", "honored", "plain", d(
        "+import os",
        "+api_key = os.environ[\"STRIPE_API_KEY\"]",
        "+client = Stripe(api_key)")),
    ("sr03-hard-testfixture", "SR-03", "honored", "hard", d(
        "+# tests/test_client.py: fake value, never a real key",
        "+token = \"test_token_not_real_123456\"",
        "+assert parse(token) is None")),

    # SR-04 cookies
    ("sr04-plain-bad", "SR-04", "violated", "plain", d(
        "+resp = make_response(redirect('/home'))",
        "+resp.set_cookie('session', sid)",
        "+return resp")),
    ("sr04-plain-ok", "SR-04", "honored", "plain", d(
        "+resp = make_response(redirect('/home'))",
        "+resp.set_cookie('session', sid, httponly=True, secure=True, samesite='Lax')",
        "+return resp")),
    ("sr04-hard-partial", "SR-04", "violated", "hard", d(
        "+resp.set_cookie('session', sid, httponly=True, secure=True)",
        "+return resp")),

    # SR-05 TLS
    ("sr05-plain-bad", "SR-05", "violated", "plain", d(
        "+r = requests.get(PARTNER_URL, timeout=5, verify=False)",
        "+return r.json()")),
    ("sr05-plain-ok", "SR-05", "honored", "plain", d(
        "+r = requests.get(PARTNER_URL, timeout=5)",
        "+return r.json()")),
    ("sr05-hard-session", "SR-05", "violated", "hard", d(
        "+s = requests.Session()",
        "+s.verify = False",
        "+r = s.get(PARTNER_URL)")),

    # SR-06 JWT
    ("sr06-plain-bad", "SR-06", "violated", "plain", d(
        "+claims = jwt.decode(token, options={\"verify_signature\": False})",
        "+user_id = claims['sub']")),
    ("sr06-plain-ok", "SR-06", "honored", "plain", d(
        "+claims = jwt.decode(token, PUBLIC_KEY, algorithms=[\"RS256\"])",
        "+user_id = claims['sub']")),
    ("sr06-hard-varalgs", "SR-06", "honored", "hard", d(
        "+ALLOWED_ALGS = [\"RS256\"]",
        "+claims = jwt.decode(token, PUBLIC_KEY, algorithms=ALLOWED_ALGS)")),

    # SR-07 logging
    ("sr07-plain-bad", "SR-07", "violated", "plain", d(
        "+logger.info(\"login attempt user=%s password=%s\", user, password)")),
    ("sr07-plain-ok", "SR-07", "honored", "plain", d(
        "+logger.info(\"login attempt user=%s\", user)")),
    ("sr07-hard-headers", "SR-07", "violated", "hard", d(
        "+logger.debug(\"incoming request headers: %s\", dict(request.headers))")),
    ("sr07-hard-falsealarm", "SR-07", "honored", "hard", d(
        "+logger.warning(\"password reset link expired for user_id=%s\", uid)")),

    # SR-08 IDOR
    ("sr08-plain-bad", "SR-08", "violated", "plain", d(
        "+@app.route('/invoices/<int:invoice_id>')",
        "+@login_required",
        "+def get_invoice(invoice_id):",
        "+    inv = Invoice.query.get_or_404(invoice_id)",
        "+    return jsonify(inv.to_dict())")),
    ("sr08-plain-ok", "SR-08", "honored", "plain", d(
        "+@app.route('/invoices/<int:invoice_id>')",
        "+@login_required",
        "+def get_invoice(invoice_id):",
        "+    inv = Invoice.query.filter_by(id=invoice_id, owner_id=current_user.id).first_or_404()",
        "+    return jsonify(inv.to_dict())")),
    ("sr08-hard-helper", "SR-08", "honored", "hard", d(
        "+@app.route('/invoices/<int:invoice_id>/pdf')",
        "+@login_required",
        "+def invoice_pdf(invoice_id):",
        "+    inv = load_owned(Invoice, invoice_id)  # aborts 404 if not the caller's",
        "+    return render_pdf(inv)")),

    # SR-09 rate limit
    ("sr09-plain-bad", "SR-09", "violated", "plain", d(
        "+@app.route('/login', methods=['POST'])",
        "+def login():",
        "+    return do_login(request.form)")),
    ("sr09-plain-ok", "SR-09", "honored", "plain", d(
        "+@app.route('/login', methods=['POST'])",
        "+@limiter.limit(\"5 per minute\")",
        "+def login():",
        "+    return do_login(request.form)")),

    # SR-10 uploads
    ("sr10-plain-bad", "SR-10", "violated", "plain", d(
        "+f = request.files['avatar']",
        "+f.save(os.path.join(UPLOAD_DIR, f.filename))")),
    ("sr10-plain-ok", "SR-10", "honored", "plain", d(
        "+ALLOWED_EXT = {'png', 'jpg'}",
        "+f = request.files['avatar']",
        "+name = secure_filename(f.filename)",
        "+if name.rsplit('.', 1)[-1].lower() not in ALLOWED_EXT: abort(400)",
        "+f.save(os.path.join(UPLOAD_DIR, name))")),
    ("sr10-hard-noext", "SR-10", "violated", "hard", d(
        "+f = request.files['avatar']",
        "+name = secure_filename(f.filename)",
        "+f.save(os.path.join(UPLOAD_DIR, name))")),
]


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "cases.jsonl"), "w", encoding="utf-8", newline="\n") as f:
        for cid, rid, label, kind, diff in CASES:
            f.write(json.dumps({"id": cid, "req_id": rid, "label": label,
                                "kind": kind, "diff": diff}) + "\n")
    print(f"wrote {len(CASES)} cases")


if __name__ == "__main__":
    main()
