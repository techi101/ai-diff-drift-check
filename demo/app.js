(function () {
  "use strict";

  // Short human titles for each case id (the ids and labels come from data/cases.jsonl).
  var TITLES = {
    "sr01-plain-bad": "SHA256 used for passwords",
    "sr01-plain-ok": "bcrypt with salt",
    "sr01-plain-bad2": "Plain text password saved",
    "sr01-hard-helper": "MD5 hidden behind a helper",
    "sr02-plain-bad": "f string inside SQL",
    "sr02-plain-ok": "Parameterized query",
    "sr02-hard-indirect": "SQL concatenated in a variable",
    "sr03-plain-bad": "Live API key in source",
    "sr03-plain-ok": "API key from environment",
    "sr03-hard-testfixture": "Fake token in a test fixture",
    "sr04-plain-bad": "Session cookie with no flags",
    "sr04-plain-ok": "Cookie with all three flags",
    "sr04-hard-partial": "Cookie missing SameSite",
    "sr05-plain-bad": "verify=False on a request",
    "sr05-plain-ok": "Default TLS verification",
    "sr05-hard-session": "verify off on a Session",
    "sr06-plain-bad": "JWT signature check off",
    "sr06-plain-ok": "JWT with RS256 allow list",
    "sr06-hard-varalgs": "Allow list held in a variable",
    "sr07-plain-bad": "Password in a log line",
    "sr07-plain-ok": "Log line without secrets",
    "sr07-hard-headers": "All request headers logged",
    "sr07-hard-falsealarm": "\"password reset\" log message",
    "sr08-plain-bad": "Invoice loaded with no owner check",
    "sr08-plain-ok": "Invoice filtered by owner",
    "sr08-hard-helper": "Owner check inside load_owned()",
    "sr09-plain-bad": "Login route without limiter",
    "sr09-plain-ok": "Login route with limiter",
    "sr10-plain-bad": "Upload saved with client filename",
    "sr10-plain-ok": "Sanitised name and extension allow list",
    "sr10-hard-noext": "No extension allow list"
  };
  // Why the regex was wrong on the two false alarms.
  var FA_NOTE = {
    "sr03-hard-testfixture": "This is a fake value in a test fixture, so it is labeled honored. The rule only sees a long quoted string next to the word token.",
    "sr07-hard-falsealarm": "The word password is part of the message text. No password is logged, so it is labeled honored."
  };
  var OUT = {
    caught: { label: "Caught", chip: "chip-caught" },
    silent_miss: { label: "Silent miss", chip: "chip-miss" },
    review_violation: { label: "Missed, sent to review", chip: "chip-miss" },
    false_alarm: { label: "False alarm", chip: "chip-fa" },
    review_ok: { label: "Sent to review", chip: "chip-review" },
    correct_pass: { label: "Correct pass", chip: "chip-pass" }
  };
  var KIND = { plain: "Plain", hard: "Tricky" };

  var data, reqById = {}, state = { kind: "all", out: "all", sel: "sr07-hard-headers", subset: "hard" };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function $(id) { return document.getElementById(id); }
  function fmt(x) { return x === null || x === undefined ? "n/a" : x.toFixed(2); }

  function matchOut(c, v) {
    if (v === "all") return true;
    if (v === "caught") return c.outcome === "caught";
    if (v === "missed") return c.outcome === "silent_miss" || c.outcome === "review_violation";
    if (v === "false_alarm") return c.outcome === "false_alarm";
    if (v === "review") return c.pred === "unknown";
    if (v === "judge_wrong") return !!c.judge && c.judge.alone !== c.label;
    return true;
  }
  function visible() {
    return data.cases.filter(function (c) {
      return (state.kind === "all" || c.kind === state.kind) && matchOut(c, state.out);
    });
  }

  function renderHero() {
    var R = data.systems ? data.systems.regex : data.scores, C = data.systems && data.systems.cascade, J = data.systems && data.systems.judge_alone;
    var frac = function (s) { return s.caught + " of " + s.violations_in_set; };
    var miss = function (n) { return n + " silent " + (n === 1 ? "miss" : "misses"); };
    if (!C) {
      $("headline").innerHTML = "A regex checker caught <b>" + frac(R.plain) + "</b> violations in plain diffs but only <b>" + frac(R.hard) + "</b> in tricky ones.";
      return;
    }
    $("headline").innerHTML = "On tricky diffs, regex rules caught <b>" + frac(R.hard) + "</b> violations. Sending the cases regex cannot decide to an LLM judge (" +
      esc(data.judge.model) + ") raised that to <b>" + frac(C.hard) + "</b>, and the judge alone caught <b>" + frac(J.hard) + "</b> with <b>" +
      J.hard.false_alarms + " of " + J.hard.honored_in_set + "</b> false alarms. Only 31 hand made cases, so read it as a smoke test, not a benchmark.";
    var k = [
      { cls: "bad", label: "Tricky: regex alone", v: R.hard.caught + "<small>/ " + R.hard.violations_in_set + " caught</small>", sub: R.hard.false_alarms + " false alarms, " + miss(R.hard.silent_misses) + ", " + R.hard.sent_to_review + " unresolved" },
      { cls: "good", label: "Tricky: regex then judge", v: C.hard.caught + "<small>/ " + C.hard.violations_in_set + " caught</small>", sub: C.hard.false_alarms + " false alarms, " + miss(C.hard.silent_misses) + ", " + C.hard.sent_to_review + " unresolved" },
      { cls: "good", label: "Tricky: judge alone", v: J.hard.caught + "<small>/ " + J.hard.violations_in_set + " caught</small>", sub: J.hard.false_alarms + " false alarms, " + miss(J.hard.silent_misses) + ", " + J.hard.sent_to_review + " unresolved" },
      { cls: "neutral", label: "All 31: judge alone", v: J.all.caught + "<small>/ " + J.all.violations_in_set + " caught</small>", sub: J.all.false_alarms + " of " + J.all.honored_in_set + " honored cases flagged" }
    ];
    $("kpis").innerHTML = k.map(function (x) {
      return '<div class="kpi ' + x.cls + '"><div class="kpi-label">' + x.label + '</div><div class="kpi-value">' + x.v +
        '</div><div class="kpi-sub">' + x.sub + "</div></div>";
    }).join("");
  }

  function renderCounts() {
    var byKind = function (k) { return data.cases.filter(function (c) { return k === "all" || c.kind === k; }); };
    document.querySelectorAll("#kindFilter button").forEach(function (b) {
      b.querySelector(".cnt").textContent = byKind(b.dataset.v).length;
    });
    var pool = byKind(state.kind);
    document.querySelectorAll("#outFilter button").forEach(function (b) {
      var c = b.querySelector(".cnt");
      if (c) c.textContent = pool.filter(function (x) { return matchOut(x, b.dataset.v); }).length;
    });
  }

  function renderList() {
    var list = visible();
    if (!list.length) {
      $("caseList").innerHTML = '<div class="list-empty">No cases match these filters. Try "Any outcome".</div>';
      $("detail").innerHTML = '<div class="list-empty">Nothing selected.</div>';
      return;
    }
    if (!list.some(function (c) { return c.id === state.sel; })) state.sel = list[0].id;
    $("caseList").innerHTML = list.map(function (c) {
      var o = OUT[c.outcome];
      return '<button class="item' + (c.id === state.sel ? " on" : "") + '" data-id="' + c.id + '">' +
        '<div class="item-top"><span class="item-title">' + esc(TITLES[c.id] || c.id) + '</span><span class="chip ' + o.chip + '">' + o.label + "</span></div>" +
        '<div class="item-meta">' + c.req_id + " · " + KIND[c.kind].toLowerCase() + " · " + c.id + "</div>" +
        (c.judge ? '<div class="item-judge ' + (c.judge.alone === c.label ? "ok" : "bad") + '">Judge: ' + c.judge.alone + (c.judge.alone === c.label ? " (right)" : " (wrong)") + "</div>" : "") + "</button>";
    }).join("");
    renderDetail();
  }

  function addedLines(diff) {
    return diff.split("\n").filter(function (l) { return l.charAt(0) === "+" && l.indexOf("+++") !== 0; });
  }

  function renderDiff(c, req) {
    var lines = c.diff.replace(/\n$/, "").split("\n");
    var file = "app.py", rows = [], newNo = 0, oldNo = 0;
    var adds = addedLines(c.diff);
    var driftIdx = -1, flagIdx = -1;
    if (c.drift_match) driftIdx = adds.findIndex(function (l) { return l.indexOf(c.drift_match) !== -1; });
    if (c.outcome === "false_alarm" && c.regex_evidence) {
      var ev = c.regex_evidence.split("\n")[0];
      flagIdx = adds.findIndex(function (l) { return l.indexOf(ev) !== -1; });
    }
    var addN = -1;
    lines.forEach(function (l) {
      if (l.indexOf("--- ") === 0) return;
      if (l.indexOf("+++ ") === 0) { file = l.slice(6) || l.slice(4); return; }
      if (l.indexOf("@@") === 0) {
        var m = /\+(\d+)/.exec(l); newNo = m ? +m[1] - 1 : 0;
        var o = /-(\d+)/.exec(l); oldNo = o ? +o[1] - 1 : 0;
        rows.push('<tr class="hunk"><td class="ln"></td><td class="ln"></td><td class="sign"></td><td>' + esc(l) + "</td></tr>");
        return;
      }
      var sign = l.charAt(0), body = l.slice(1), cls = "", oldCell = "", newCell = "", note = "";
      if (sign === "+") {
        addN++; newNo++; newCell = newNo; cls = "add";
        if (addN === driftIdx) {
          cls += " drift";
          note = '<tr class="note"><td colspan="4"><div class="annot red"><div class="annot-title"><span class="chip ' + OUT[c.outcome].chip + '">' + OUT[c.outcome].label +
            "</span>Violates " + esc(req.id) + ": " + esc(req.short) + "</div><p>" + esc(c.drift_note) + "</p>" +
            (c.regex_evidence ? '<p>Regex matched <code>' + esc(c.regex_evidence.split("\n")[0]) + "</code></p>" : "<p>The regex rule did not flag this line.</p>") +
            "</div></td></tr>";
        } else if (addN === flagIdx) {
          cls += " flag";
          note = '<tr class="note"><td colspan="4"><div class="annot orange"><div class="annot-title"><span class="chip chip-fa">False alarm</span>Regex flagged ' + esc(req.id) +
            "</div><p>" + esc(FA_NOTE[c.id] || "Labeled honored.") + '</p><p>Regex matched <code>' + esc(c.regex_evidence.split("\n")[0]) + "</code></p></div></td></tr>";
        }
      } else if (sign === "-") { oldNo++; oldCell = oldNo; cls = "del"; }
      else { oldNo++; newNo++; oldCell = oldNo; newCell = newNo; }
      rows.push('<tr class="' + cls + '"><td class="ln">' + oldCell + '</td><td class="ln">' + newCell + '</td><td class="sign">' + esc(sign) + "</td><td>" + esc(body) + "</td></tr>" + note);
    });
    return '<div class="diff"><div class="diff-file"><span>' + esc(file) + '</span><span class="diff-stat">+' + adds.length + "</span></div>" +
      '<div class="diff-body"><table aria-label="Unified diff">' + rows.join("") + "</table></div></div>";
  }

  function renderDetail() {
    var c = data.cases.find(function (x) { return x.id === state.sel; });
    if (!c) return;
    var req = reqById[c.req_id], o = OUT[c.outcome];
    var jd = c.judge, judgeTile = "", cascadeLine = "";
    if (jd) {
      var agree = jd.runs.filter(function (v) { return v === jd.alone; }).length;
      judgeTile = '<div class="verdict"><div class="verdict-label">LLM judge said</div><div class="verdict-val v-' + jd.alone + '">' + jd.alone +
        (jd.alone === c.label ? ' <span class="tick ok">right</span>' : ' <span class="tick bad">wrong</span>') + '</div><div class="verdict-sub">' + agree + " of " + jd.runs.length + " runs agree</div></div>";
      cascadeLine = '<p class="why"><b>Regex then judge:</b> final verdict <b class="v-' + jd.cascade + '">' + jd.cascade + "</b>, decided by the " +
        (jd.cascade_stage === "judge" ? "judge because the rules said unknown" : "rules, so the judge was not asked") + ".</p>" +
        '<p class="why"><b>Judge evidence:</b> <code>' + esc(jd.alone_why || "none") + "</code></p>";
    } else {
      judgeTile = '<div class="verdict"><div class="verdict-label">LLM judge</div><div class="verdict-val v-judge">Not run</div></div>';
    }
    var tail = "";
    if (c.outcome === "correct_pass") tail = "<p class=\"why\"><b>No drift.</b> Labeled honored and the rules agreed.</p>";
    if (c.outcome === "review_ok") tail = "<p class=\"why\"><b>No drift.</b> Labeled honored, but the rules could not prove it, so a human or the judge would have to look.</p>";
    if (c.outcome === "silent_miss") tail = "<p class=\"why\"><b>Worst outcome.</b> The rules said honored, so this violation would ship with a green check.</p>";
    $("detail").innerHTML =
      '<div class="detail-head"><div><div class="chips"><span class="chip ' + o.chip + '">' + o.label + '</span><span class="chip chip-kind">' + KIND[c.kind] +
      '</span><span class="chip chip-cwe">' + esc(req.cwe) + " · " + esc(req.cwe_name) + "</span></div>" +
      '<div class="detail-title">' + esc(TITLES[c.id] || c.id) + "</div>" +
      '<p class="detail-req"><b>' + esc(req.id) + "</b> " + esc(req.text) + "</p></div></div>" +
      '<div class="verdicts">' +
      '<div class="verdict"><div class="verdict-label">Ground truth label</div><div class="verdict-val v-' + c.label + '">' + c.label + "</div></div>" +
      '<div class="verdict"><div class="verdict-label">Regex rules said</div><div class="verdict-val v-' + c.pred + '">' + c.pred + "</div></div>" +
      judgeTile + "</div>" +
      renderDiff(c, req) +
      '<p class="why"><b>Rule output:</b> ' + esc(c.why) + "</p>" + tail + cascadeLine +
      (c.judge_prompt ? '<details class="prompt"><summary>Exact prompt sent to the LLM judge</summary><pre class="code-block">' + esc(c.judge_prompt) + "</pre></details>" : "");
  }

  function ci(x) { return x ? '<span class="ci">[' + x[0].toFixed(2) + ", " + x[1].toFixed(2) + "]</span>" : ""; }
  function renderScores() {
    var k = state.subset, sys = ["regex", "cascade", "judge_alone"];
    var NAMES = { regex: "Regex alone", cascade: "Regex then judge", judge_alone: "Judge alone" };
    var S = function (n) { return data.systems[n][k]; };
    var bar = function (v) { return '<span class="bar"><i style="width:' + Math.round((v || 0) * 100) + '%"></i></span>'; };
    $("scoreTitle").textContent = { plain: "Plain diffs", hard: "Tricky diffs", all: "All diffs" }[k] + " (" + S("regex").cases + " cases)";
    var rows = [
      ["Violations caught", "Said violated on a violated case", function (s) { return s.caught + " <small>/ " + s.violations_in_set + "</small>"; }],
      ["Recall", "Caught ÷ violations", function (s) { return fmt(s.recall) + ci(s.recall_ci95) + bar(s.recall); }],
      ["Precision", "Caught ÷ everything flagged", function (s) { return fmt(s.precision) + ci(s.precision_ci95) + bar(s.precision); }],
      ["False alarms", "Flagged an honored case", function (s) { return s.false_alarms + " <small>/ " + s.honored_in_set + " honored</small>"; }],
      ["Silent misses", "Said honored on a violation", function (s) { return s.silent_misses + " <small>/ " + s.violations_in_set + "</small>"; }],
      ["Unresolved", "Still unknown at the end", function (s) { return s.sent_to_review + " <small>/ " + s.cases + " cases</small>"; }]
    ];
    $("scoreTable").innerHTML = "<thead><tr><th>Metric</th>" + sys.map(function (n) {
      return "<th>" + NAMES[n] + "</th>";
    }).join("") + "</tr></thead><tbody>" + rows.map(function (r) {
      return '<tr><td><span class="metric-name">' + r[0] + '</span><span class="metric-def">' + r[1] + "</span></td>" +
        sys.map(function (n) { return '<td class="num">' + r[2](S(n)) + "</td>"; }).join("") + "</tr>";
    }).join("") + "</tbody>";
    document.querySelectorAll("#subsetToggle button").forEach(function (b) { b.classList.toggle("on", b.dataset.v === k); });
  }
  function renderJudgeCard() {
    var j = data.judge, st = j.stability;
    var wrong = data.cases.filter(function (c) { return c.judge && c.judge.alone !== c.label; });
    $("judgeCard").innerHTML =
      '<div class="card-head"><h3>LLM judge run</h3><span class="chip chip-cwe">' + esc(j.model) + "</span></div>" +
      "<p>Each case was sent " + j.repeats + " times at temperature " + j.temperature + ". The prediction is the majority verdict, and no majority counts as unknown.</p>" +
      '<div class="judge-stat">' +
      '<div class="kpi neutral"><div class="kpi-label">All 3 runs agreed</div><div class="kpi-value">' + st.all_cases_unanimous + "<small>/ " + st.all_cases + " cases</small></div></div>" +
      '<div class="kpi bad"><div class="kpi-label">Judge alone wrong</div><div class="kpi-value">' + wrong.length + "<small>/ " + data.cases.length + " cases</small></div></div></div>" +
      "<p><b>Regex then judge</b> runs the rules first and only asks the judge about the " + st.cascade_cases + " cases the rules mark unknown. <b>Judge alone</b> asks it about every case.</p>" +
      '<p class="muted small">Use the "Judge wrong" filter in Findings to see every judge mistake. Every case shows the exact prompt.</p>';
  }

  function renderReqs() {
    $("reqList").innerHTML = data.requirements.map(function (r) {
      var cs = data.cases.filter(function (c) { return c.req_id === r.id; });
      return '<div class="req"><div class="req-id">' + r.id + '</div><div><div class="req-name">' + esc(r.short) +
        ' <span class="chip chip-cwe">' + esc(r.cwe) + '</span></div><div class="req-text">' + esc(r.text) + "</div></div>" +
        '<div class="req-cases">' + cs.map(function (c) {
          return '<button class="case-chip ' + c.outcome + '" data-id="' + c.id + '" title="' + esc((TITLES[c.id] || c.id) + ": " + OUT[c.outcome].label) + '">' +
            (c.kind === "hard" ? "tricky" : "plain") + " · " + (c.label === "violated" ? "bad" : "ok") + "</button>";
        }).join("") + "</div></div>";
    }).join("");
  }

  function select(id, scroll) {
    state.sel = id;
    var c = data.cases.find(function (x) { return x.id === id; });
    if (c && !visible().some(function (x) { return x.id === id; })) {
      state.kind = "all"; state.out = "all"; syncSeg();
    }
    renderCounts(); renderList();
    if (scroll) $("findings").scrollIntoView({ behavior: "smooth" });
  }
  function syncSeg() {
    document.querySelectorAll("#kindFilter button").forEach(function (b) { b.classList.toggle("on", b.dataset.v === state.kind); });
    document.querySelectorAll("#outFilter button").forEach(function (b) { b.classList.toggle("on", b.dataset.v === state.out); });
  }

  function bind() {
    $("kindFilter").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      state.kind = b.dataset.v; syncSeg(); renderCounts(); renderList();
    });
    $("outFilter").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      state.out = b.dataset.v; syncSeg(); renderCounts(); renderList();
    });
    $("caseList").addEventListener("click", function (e) {
      var b = e.target.closest(".item"); if (!b) return;
      state.sel = b.dataset.id; renderList();
    });
    $("reqList").addEventListener("click", function (e) {
      var b = e.target.closest(".case-chip"); if (!b) return;
      select(b.dataset.id, true);
    });
    $("subsetToggle").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      state.subset = b.dataset.v; renderScores();
    });
    $("moreBtn").addEventListener("click", function () {
      var body = $("moreBody"), open = body.hidden;
      body.hidden = !open;
      this.setAttribute("aria-expanded", String(open));
      this.textContent = open ? "Show less" : "Show more";
    });
  }

  fetch("data.json").then(function (r) { return r.json(); }).then(function (d) {
    data = d;
    d.requirements.forEach(function (r) { reqById[r.id] = r; });
    renderHero(); renderScores(); renderJudgeCard(); renderReqs(); renderCounts(); renderList(); bind();
  }).catch(function () {
    $("headline").textContent = "Could not load data.json.";
  });
})();
