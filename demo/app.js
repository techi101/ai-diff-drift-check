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
    "sr03-hard-testfixture": "This value sits in a test file (tests/test_client.py) and is only used by an assertion, so it is labeled honored. The rule only sees a long quoted string next to the word token.",
    "sr07-hard-falsealarm": "The word password is part of the message text. No password is logged, so it is labeled honored."
  };
  var OUT = {
    caught: "Caught",
    silent_miss: "Silent miss",
    review_violation: "Missed, sent to review",
    false_alarm: "False alarm",
    review_ok: "Sent to review",
    correct_pass: "Correct pass"
  };
  var KIND = { plain: "Plain", hard: "Tricky" };
  var HERO_ID = "sr07-hard-headers";
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var data, reqById = {}, state = { kind: "all", out: "all", sel: HERO_ID, subset: "all" };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function $(id) { return document.getElementById(id); }
  function fmt(x) { return x === null || x === undefined ? "n/a" : x.toFixed(2); }
  function models() { return (data.judge && data.judge.models) || []; }
  function title(id) { return TITLES[id] || id; }
  function caseById(id) { return data.cases.find(function (x) { return x.id === id; }); }

  // Outcome of one verdict against the label (same rules as drift_check/evaluate.py).
  function outcomeOf(label, pred) {
    if (label === "violated") return pred === "violated" ? "caught" : pred === "honored" ? "silent_miss" : "review_violation";
    return pred === "violated" ? "false_alarm" : pred === "honored" ? "correct_pass" : "review_ok";
  }
  function judgeWrong(c) {
    return models().filter(function (m) { return c.judges && c.judges[m.model].alone !== c.label; });
  }
  function matchOut(c, v) {
    if (v === "all") return true;
    if (v === "caught") return c.outcome === "caught";
    if (v === "missed") return c.outcome === "silent_miss" || c.outcome === "review_violation";
    if (v === "false_alarm") return c.outcome === "false_alarm";
    if (v === "review") return c.pred === "unknown";
    if (v === "judge_wrong") return judgeWrong(c).length > 0;
    return true;
  }
  function visible() {
    return data.cases.filter(function (c) {
      return (state.kind === "all" || c.kind === state.kind) && matchOut(c, state.out);
    });
  }
  function status(outcome) {
    return '<span class="status"><i class="sq ' + outcome + '"></i>' + OUT[outcome] + "</span>";
  }

  /* Diff ------------------------------------------------------------- */
  function addedLines(diff) {
    return diff.split("\n").filter(function (l) { return l.charAt(0) === "+" && l.indexOf("+++") !== 0; });
  }
  function renderDiff(c, req, hero) {
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
          note = '<tr class="note"><td colspan="4"><div class="annot"><div class="annot-title">Drifts from ' + esc(req.id) + ", " + esc(req.short.toLowerCase()) + "</div><p>" + esc(c.drift_note) + "</p>" +
            (hero ? "" : c.regex_evidence ? '<p class="muted">Regex matched <code>' + esc(c.regex_evidence.split("\n")[0]) + "</code></p>" : '<p class="muted">The regex rule did not flag this line.</p>') +
            "</div></td></tr>";
        } else if (addN === flagIdx) {
          cls += " flag";
          note = '<tr class="note"><td colspan="4"><div class="annot warn"><div class="annot-title">Regex flagged this line for ' + esc(req.id) +
            "</div><p>" + esc(FA_NOTE[c.id] || "Labeled honored.") + '</p><p class="muted">Regex matched <code>' + esc(c.regex_evidence.split("\n")[0]) + "</code></p></div></td></tr>";
        }
      } else if (sign === "-") { oldNo++; oldCell = oldNo; cls = "del"; }
      else { oldNo++; newNo++; oldCell = oldNo; newCell = newNo; }
      rows.push('<tr class="' + cls + '"><td class="ln">' + oldCell + '</td><td class="ln">' + newCell + '</td><td class="sign">' + esc(sign) +
        '</td><td class="code"><span>' + esc(body) + "</span></td></tr>" + note);
    });
    return '<div class="diff"><div class="diff-file"><span class="fname">' + esc(file) + '</span><span class="stat">+' + adds.length + " added</span></div>" +
      '<div class="diff-body"><table aria-label="Unified diff of ' + esc(file) + '">' + rows.join("") + "</table></div></div>";
  }

  /* Hero ------------------------------------------------------------- */
  function renderHero() {
    var c = caseById(HERO_ID), req = reqById[c.req_id], M = models();
    $("heroReq").innerHTML = "Figure 1. Requirement " + esc(req.id) + " from the design review: <b>" + esc(req.text) + "</b>";
    $("heroDiff").innerHTML = renderDiff(c, req, true);
    $("hvRules").textContent = c.pred;
    $("hvRules").className = "vword v-" + c.pred;
    $("hvRulesNote").innerHTML = "Rule output: " + esc(c.why) + ". <b>Wrong.</b> This would ship with a green check.";
    if (M.length) {
      var j = c.judges[M[0].model];
      var runs = M.map(function (m) { var x = c.judges[m.model]; return x.runs.filter(function (v) { return v === x.alone; }).length + " of " + x.runs.length; });
      var same = M.every(function (m) { return c.judges[m.model].alone === j.alone; });
      $("hvJudge").textContent = j.alone;
      $("hvJudge").className = "vword v-" + j.alone;
      $("hvJudgeNote").innerHTML = (runs.every(function (r) { return r === runs[0]; }) ? runs[0] + " runs" : runs.join(" and ") + " runs") +
        (same && M.length > 1 ? ", on both Gemini models" : "") + ". <span class=\"ok\">Right.</span> It quoted the line back as evidence.";
    }
    var R = data.systems.regex, C = M.length ? data.systems[M[0].model].cascade : null;
    var frac = function (s) { return s.caught + " of " + s.violations_in_set; };
    $("heroResult").textContent = "On " + data.cases.length + " hand-made cases, rules alone caught " + frac(R.all) + " drifts (" + frac(R.hard) + " tricky)." +
      (C ? " Rules then an LLM judge caught " + frac(C.all) + "." : "");
    var fig = $("heroCase");
    $("heroCaseId").textContent = c.id;
    if (!reduce) { fig.classList.add("play"); setTimeout(function () { fig.classList.add("lit"); }, 850); }
    else { fig.classList.add("done"); }
  }

  /* Scoreboard ------------------------------------------------------- */
  function systemsFor() {
    var M = models();
    var lanes = function (mode) {
      return M.map(function (m) {
        return { name: m.short, stats: data.systems[m.model][mode], pred: function (c) { return c.judges[m.model][mode === "judge_alone" ? "alone" : "cascade"]; } };
      });
    };
    var out = [{ name: "Rules alone", what: "One regex rule per requirement", lanes: [{ name: "Regex", stats: data.systems.regex, pred: function (c) { return c.pred; } }] }];
    if (M.length) {
      out.push({ name: "Rules then judge", what: "The judge only sees what the rules leave unknown", lanes: lanes("cascade") });
      out.push({ name: "Judge alone", what: "The judge sees every case", lanes: lanes("judge_alone") });
    }
    return out;
  }
  var ORDER_V = ["caught", "silent_miss", "review_violation"], ORDER_H = ["correct_pass", "false_alarm", "review_ok"];
  function cellsHTML(outs, order, row) {
    outs.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
    return '<div class="cells" aria-hidden="true">' + outs.map(function (o, i) {
      return '<i class="' + o + '" style="--i:' + i + ";--row:" + row + '"></i>';
    }).join("") + "</div>";
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function renderBoard(animate) {
    var k = state.subset;
    var pool = data.cases.filter(function (c) { return k === "all" || c.kind === k; });
    var R = data.systems.regex[k];
    var html = '<div class="board-head"><span>' + R.violations_in_set + " violated cases</span><span>" + R.honored_in_set + " honored cases</span></div>";
    var row = 0;
    systemsFor().forEach(function (sys) {
      var caught = [];
      sys.lanes.forEach(function (l) { var n = l.stats[k].caught; if (caught.indexOf(n) === -1) caught.push(n); });
      html += '<div class="sys"><div class="sys-id"><div class="sys-name">' + sys.name + '</div><div class="sys-big">' + caught.join(" and ") +
        ' <span class="of">of ' + R.violations_in_set + "</span></div><div class=\"sys-what\">" + sys.what + "</div></div>";
      sys.lanes.forEach(function (l) {
        var s = l.stats[k];
        var vo = [], ho = [];
        pool.forEach(function (c) { var o = outcomeOf(c.label, l.pred(c)); (c.label === "violated" ? vo : ho).push(o); });
        var vparts = ["<b>" + s.caught + "</b> caught"];
        if (s.silent_misses) vparts.push("<b>" + s.silent_misses + "</b> silent " + (s.silent_misses === 1 ? "miss" : "misses"));
        var unresV = vo.filter(function (o) { return o === "review_violation"; }).length;
        if (unresV) vparts.push("<b>" + unresV + "</b> left unresolved");
        var unresH = ho.filter(function (o) { return o === "review_ok"; }).length;
        html += '<div class="lane"><div class="lane-name">' + esc(l.name) + "</div>" +
          '<div class="lane-v" data-cap="Violated cases">' + cellsHTML(vo, ORDER_V, row) +
          '<div class="counts">' + vparts.join(", ") + '<br><span class="ci">Recall ' + fmt(s.recall) + ", 95% interval [" + fmt(s.recall_ci95[0]) + ", " + fmt(s.recall_ci95[1]) + "]</span></div></div>" +
          '<div class="lane-h" data-cap="Honored cases">' + cellsHTML(ho, ORDER_H, row) +
          '<div class="counts"><b>' + s.false_alarms + "</b> false " + (s.false_alarms === 1 ? "alarm" : "alarms") + " of " + s.honored_in_set +
          (unresH ? ", <b>" + unresH + "</b> unresolved" : "") + "</div></div></div>";
        row++;
      });
      html += "</div>";
    });
    var b = $("board");
    b.classList.remove("animate");
    b.innerHTML = html;
    if (animate && !reduce) { void b.offsetWidth; b.classList.add("animate"); }
    var label = { plain: "the " + R.cases + " plain cases", hard: "the " + R.cases + " tricky cases", all: "all " + R.cases + " cases" }[k];
    $("scoresSub").textContent = "Showing " + label + ". Each square is one labeled case: solid squares are violations, outlined squares honor the requirement.";
    document.querySelectorAll("#subsetToggle button").forEach(function (x) { x.setAttribute("aria-pressed", String(x.dataset.v === k)); });
    renderTable();
  }

  function ci(x) { return x ? ' <span class="ci">[' + x[0].toFixed(2) + ", " + x[1].toFixed(2) + "]</span>" : ""; }
  function renderTable() {
    var k = state.subset, M = models();
    var cols = [{ name: "Regex alone", s: data.systems.regex[k] }];
    M.forEach(function (m) { cols.push({ name: m.short, s: data.systems[m.model].cascade[k] }); });
    M.forEach(function (m) { cols.push({ name: m.short, s: data.systems[m.model].judge_alone[k] }); });
    var rows = [
      ["Violations caught", "Said violated on a violated case", function (s) { return s.caught + " <small>of " + s.violations_in_set + "</small>"; }],
      ["Recall", "Caught divided by violations", function (s) { return fmt(s.recall) + ci(s.recall_ci95); }],
      ["Precision", "Caught divided by everything flagged", function (s) { return fmt(s.precision) + ci(s.precision_ci95); }],
      ["False alarms", "Flagged an honored case", function (s) { return s.false_alarms + " <small>of " + s.honored_in_set + "</small>"; }],
      ["Silent misses", "Said honored on a violation", function (s) { return s.silent_misses + " <small>of " + s.violations_in_set + "</small>"; }],
      ["Unresolved", "Still unknown at the end", function (s) { return s.sent_to_review + " <small>of " + s.cases + "</small>"; }]
    ];
    var grp = '<tr class="grp"><th></th><th></th>' + (M.length ? '<th colspan="' + M.length + '">Regex then judge</th><th colspan="' + M.length + '">Judge alone</th>' : "") + "</tr>";
    $("scoreTable").innerHTML = "<thead>" + grp + "<tr><th>Metric</th>" + cols.map(function (c) { return "<th>" + esc(c.name) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      rows.map(function (r) {
        return '<tr><td><span class="metric-name">' + r[0] + '</span><span class="metric-def">' + r[1] + "</span></td>" +
          cols.map(function (c) { return '<td class="num">' + r[2](c.s) + "</td>"; }).join("") + "</tr>";
      }).join("") + "</tbody>";
  }

  function renderJudgeNotes() {
    var M = models();
    if (!M.length) { $("judgeNotes").innerHTML = ""; return; }
    var link = function (id) { return '<button type="button" class="case-link" data-id="' + id + '">' + esc(title(id)) + "</button>"; };
    var list = function (ids) { return ids.map(link).join(" and "); };
    var parts = M.map(function (m) {
      var st = m.stability;
      return "<b>" + esc(m.short) + "</b> gave the same verdict on all " + data.judge.repeats + " runs for " + st.all_cases_unanimous + " of " + st.all_cases +
        " cases, and judging alone it was wrong on " + (m.alone_wrong.length ? m.alone_wrong.length + " of " + st.all_cases + ": " + list(m.alone_wrong) : "none of them") + ".";
    });
    var p = "<p>Each case went to each model " + data.judge.repeats + " times at temperature 0, and the majority verdict counts. " + parts.join(" ") + "</p>";
    if (data.judge.models_agree !== undefined) p += "<p>The two models agreed on <b>" + data.judge.models_agree + " of " + data.cases.length + "</b> cases. Rules then judge keeps every mistake the rules make on cases they decide, which is why it stops at " +
      data.systems[M[0].model].cascade.all.caught + " of " + data.systems.regex.all.violations_in_set + ": " + list(M[0].cascade_wrong.filter(function (id) { return caseById(id).label === "violated"; })) + " was passed by the rules and never reached the judge.</p>";
    $("judgeNotes").innerHTML = p;
  }

  /* Findings explorer ------------------------------------------------ */
  function renderCounts() {
    var byKind = function (k) { return data.cases.filter(function (c) { return k === "all" || c.kind === k; }); };
    document.querySelectorAll("#kindFilter button").forEach(function (b) { b.querySelector(".cnt").textContent = byKind(b.dataset.v).length; });
    var pool = byKind(state.kind);
    document.querySelectorAll("#outFilter button").forEach(function (b) {
      var c = b.querySelector(".cnt");
      if (c) c.textContent = pool.filter(function (x) { return matchOut(x, b.dataset.v); }).length;
    });
  }
  function renderList() {
    var list = visible();
    if (!list.length) {
      $("caseList").innerHTML = '<div class="list-empty">No cases match these filters. Choose "Any outcome" to see them all.</div>';
      $("detail").innerHTML = "";
      return;
    }
    if (!list.some(function (c) { return c.id === state.sel; })) state.sel = list[0].id;
    $("caseList").innerHTML = list.map(function (c) {
      var req = reqById[c.req_id];
      return '<button type="button" class="item' + (c.id === state.sel ? " on" : "") + '" data-id="' + c.id + '" aria-pressed="' + (c.id === state.sel) + '">' +
        '<div class="item-row"><span class="item-title">' + esc(title(c.id)) + "</span>" + status(c.outcome) + "</div>" +
        '<div class="item-sub"><span>' + esc(req.id) + " " + esc(req.short) + "</span><span>" + KIND[c.kind] + "</span></div>" +
        (c.judges ? '<div class="item-judges">' + models().map(function (m) {
          var ok = c.judges[m.model].alone === c.label;
          return "<span>" + esc(m.short) + ' <span class="' + (ok ? "ok-word" : "bad-word") + '">' + (ok ? "right" : "wrong") + "</span></span>";
        }).join("") + "</div>" : "") + "</button>";
    }).join("");
    renderDetail();
  }
  function renderDetail() {
    var c = caseById(state.sel);
    if (!c) return;
    var req = reqById[c.req_id];
    var vrow = function (who, verdict, extra) {
      return '<tr><th scope="row">' + who + '</th><td class="v v-' + verdict + '">' + verdict + "</td><td>" + (extra || "") + "</td></tr>";
    };
    var rows = vrow("Ground truth label", c.label, '<span class="runs">Set by hand before any run</span>') +
      vrow("Regex rules", c.pred, c.pred === c.label ? '<span class="ok-word">right</span>' : c.pred === "unknown" ? '<span class="runs">sent to review</span>' : '<span class="bad-word">wrong</span>');
    var cascade = "";
    if (c.judges) {
      models().forEach(function (m) {
        var jd = c.judges[m.model];
        var agree = jd.runs.filter(function (v) { return v === jd.alone; }).length;
        rows += vrow("Judge alone, " + esc(m.short), jd.alone, (jd.alone === c.label ? '<span class="ok-word">right</span>' : '<span class="bad-word">wrong</span>') +
          ' <span class="runs">' + agree + " of " + jd.runs.length + " runs agree</span>");
        cascade += "<div><h4>" + esc(m.short) + " <span>" + esc(m.model) + "</span></h4>" +
          '<p><span class="l">Rules then judge:</span> <b class="v-' + jd.cascade + '">' + jd.cascade + "</b>, decided by the " +
          (jd.cascade_stage === "judge" ? "judge because the rules said unknown" : "rules, so the judge was not asked") + ".</p>" +
          '<p><span class="l">Judge evidence:</span> <code>' + esc(jd.alone_why || "none") + "</code></p></div>";
      });
      cascade = '<div class="cascade">' + cascade + "</div>";
    }
    var tail = "";
    if (c.outcome === "correct_pass") tail = "<p class=\"why\"><b>No drift.</b> Labeled honored and the rules agreed.</p>";
    if (c.outcome === "review_ok") tail = "<p class=\"why\"><b>No drift.</b> Labeled honored, but the rules could not prove it, so a human or the judge would have to look.</p>";
    if (c.outcome === "silent_miss") tail = "<p class=\"why\"><b>Worst outcome.</b> The rules said honored, so this violation would ship with a green check.</p>";
    $("detail").innerHTML =
      '<div class="detail-kicker">' + status(c.outcome) + "<span>" + KIND[c.kind] + " case</span><span>" + esc(req.cwe) + " " + esc(req.cwe_name) + "</span></div>" +
      "<h3>" + esc(title(c.id)) + "</h3>" +
      '<p class="detail-req"><b>' + esc(req.id) + "</b> " + esc(req.text) + "</p>" +
      '<table class="verdict-table"><thead><tr><th>Who</th><th>Verdict</th><th></th></tr></thead><tbody>' + rows + "</tbody></table>" +
      renderDiff(c, req, false) +
      '<p class="why"><b>Rule output:</b> ' + esc(c.why) + "</p>" + tail + cascade +
      (c.judge_prompt ? '<details class="fold prompt"><summary>Exact prompt sent to the LLM judge</summary><pre class="code-block">' + esc(c.judge_prompt) + "</pre></details>" : "");
  }

  /* Requirements matrix ---------------------------------------------- */
  function renderReqs() {
    var mark = function (c) {
      return '<button type="button" class="mk ' + c.outcome + '" data-id="' + c.id + '" title="' + esc(title(c.id) + ": " + OUT[c.outcome]) + '" aria-label="' + esc(title(c.id) + ", " + OUT[c.outcome]) + '"></button>';
    };
    var cell = function (cs) { return '<td class="marks">' + (cs.length ? cs.map(mark).join("") : '<span class="mk-none" aria-label="none">none</span>') + "</td>"; };
    $("reqMatrix").innerHTML = "<thead><tr><th class=\"c-id\">ID</th><th>Requirement</th><th class=\"c-cwe\">CWE</th><th>Plain, violated</th><th>Plain, honored</th><th>Tricky</th></tr></thead><tbody>" +
      data.requirements.map(function (r) {
        var cs = data.cases.filter(function (c) { return c.req_id === r.id; });
        return '<tr><td class="rq-id">' + esc(r.id) + '</td><td><span class="rq-name" data-id="' + esc(r.id) + '">' + esc(r.short) + '</span><span class="rq-text">' + esc(r.text) + "</span></td>" +
          '<td class="rq-cwe">' + esc(r.cwe) + "</td>" +
          cell(cs.filter(function (c) { return c.kind === "plain" && c.label === "violated"; })) +
          cell(cs.filter(function (c) { return c.kind === "plain" && c.label === "honored"; })) +
          cell(cs.filter(function (c) { return c.kind === "hard"; })) + "</tr>";
      }).join("") + "</tbody>";
  }

  function renderV1() {
    var v1 = data.judge_v1, m = models()[0];
    $("v1note").textContent = v1 ? "An earlier run, with hint comments still in three cases, had " + v1.model + " judge " + v1.correct + " of " + v1.cases +
      " correctly. The comments were removed and everything was rerun; every number on this page is the rerun, where " + v1.model + " still got " +
      (m ? data.cases.length - m.alone_wrong.length : "?") + " of " + data.cases.length + " right." : "";
  }

  /* Wiring ----------------------------------------------------------- */
  function select(id, scroll) {
    state.sel = id;
    if (caseById(id) && !visible().some(function (x) { return x.id === id; })) { state.kind = "all"; state.out = "all"; syncTabs(); }
    renderCounts(); renderList();
    if (scroll) $("findings").scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
  }
  function syncTabs() {
    document.querySelectorAll("#kindFilter button").forEach(function (b) { b.classList.toggle("on", b.dataset.v === state.kind); });
    document.querySelectorAll("#outFilter button").forEach(function (b) { b.classList.toggle("on", b.dataset.v === state.out); });
  }
  function bind() {
    $("kindFilter").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; state.kind = b.dataset.v; syncTabs(); renderCounts(); renderList(); });
    $("outFilter").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; state.out = b.dataset.v; syncTabs(); renderCounts(); renderList(); });
    $("caseList").addEventListener("click", function (e) { var b = e.target.closest(".item"); if (!b) return; state.sel = b.dataset.id; renderList(); });
    $("reqMatrix").addEventListener("click", function (e) { var b = e.target.closest(".mk"); if (!b) return; select(b.dataset.id, true); });
    $("judgeNotes").addEventListener("click", function (e) { var b = e.target.closest(".case-link"); if (!b) return; select(b.dataset.id, true); });
    $("subsetToggle").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; state.subset = b.dataset.v; renderBoard(true); });
  }
  function growWhenSeen() {
    var b = $("board");
    if (reduce || !("IntersectionObserver" in window)) return;
    b.classList.add("waiting");
    var io = new IntersectionObserver(function (es) {
      if (es.some(function (x) { return x.isIntersecting; })) { b.classList.remove("waiting"); renderBoard(true); io.disconnect(); }
    }, { threshold: 0.25 });
    io.observe(b);
  }

  fetch("data.json").then(function (r) { return r.json(); }).then(function (d) {
    data = d;
    d.requirements.forEach(function (r) { reqById[r.id] = r; });
    renderHero(); renderBoard(false); renderJudgeNotes(); renderReqs(); renderV1(); renderCounts(); renderList(); bind(); growWhenSeen();
  }).catch(function () {
    $("heroResult").textContent = "Could not load data.json. Open the page through a web server, not from the file system.";
  });
})();
