/* ============================================================
   instructor.js — Overview · Lectures · Questions · Students · Items · Export
   All text is rendered with textContent (Safe.el). All writes are RPCs;
   the database re-checks every permission, the UI only hides buttons.
   ============================================================ */
;(function () {
  "use strict";
  try { sessionStorage.removeItem("ii.preview"); } catch (e) { /* ignore */ }   // leaving the student preview
  const { el, clear, fill, fmtDate, fmtDay, toCSV, parseCSV, download, bulletLines } = Safe;
  const { renderLecture, renderQuestion, label } = Render;
  const { toast, modal, confirmBox, signInScreen, avatarMenu } = Shell;

  const $main = document.getElementById("main");
  const S = {
    me: null, profile: null, isAdmin: false,
    vocab: {}, vocabRows: [], lectures: [], questions: [],
    cohort: "", days: 30, cohorts: [], cohortSize: {},
    qFilters: { mine: "", status: "", pool: "", source: "", niche: "", topic: "", author: "", lecture: "", tier: "", difficulty: "", q: "" }
  };
  const TABS = [["overview", "Overview"], ["lectures", "Lectures"], ["questions", "Questions"],
                ["students", "Students"], ["items", "Items"], ["exams", "Exams"], ["export", "Export"]];
  const STATUSES = ["draft", "live", "superseded", "retired", "hidden"];
  const STATUS_LABEL = { draft: "Draft", live: "Live",
                         superseded: "Superseded", retired: "Retired", published: "Published", hidden: "Hidden" };
  const POOLS = ["practice", "pretest", "monthly"];
  const statusChip = (s) => el("span", { class: "status " + s }, STATUS_LABEL[s] || s);
  const vlabel = (kind, id) => label(S.vocab, kind, id);
  const opts = (kind, sel, blank) => [
    blank !== false ? el("option", { value: "" }, blank || "—") : null,
    ...(S.vocabRows.filter((v) => v.kind === kind).map((v) => el("option", { value: v.id, selected: v.id === sel }, v.label)))
  ];
  const errMsg = (e) => (e && e.message) || String(e);
  async function guard(fn, okMsg) {
    try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
    catch (e) { toast(errMsg(e), true); throw e; }
  }

  /* Page title block: big title, one-line subtitle, controls on the right. */
  const pagehead = (title, sub, ...controls) => el("div", { class: "pagehead" },
    el("div", null, el("h1", null, title), sub ? el("p", { class: "sub" }, sub) : null),
    controls.flat().filter(Boolean).length ? el("div", { class: "controls" }, controls) : null);
  /* Stat card: label, big number, caption. */
  const stat = (l, n, s, href) => el(href ? "a" : "div", { class: "stat", href },
    el("div", { class: "l" }, l), el("div", { class: "n" }, String(n)), s ? el("div", { class: "s" }, s) : null);
  const control = (labelText, input) => el("label", { class: "control" }, labelText, input);
  async function loadCohorts() {
    S.cohorts = await API.cohortList().catch(() => API.cohorts().catch(() => []));
    const all = await API.studentSummary(null, null).catch(() => []);
    S.cohortSize = {};
    for (const r of all) if (r.role === "student") S.cohortSize[r.cohort_id || ""] = (S.cohortSize[r.cohort_id || ""] || 0) + 1;
    S.cohortSize.all = all.filter((r) => r.role === "student").length;
    if (S.cohort && !S.cohorts.some((c) => c.id === S.cohort)) S.cohort = "";
  }
  /* Cohort and Period pickers shown on Overview, Students and Items. */
  function scopeControls(withPeriod) {
    const n = (k) => S.cohortSize[k] || 0;
    const ppl = (k) => `${k} student${k === 1 ? "" : "s"}`;
    const cs = el("select", null, el("option", { value: "" }, `All cohorts · ${ppl(S.cohortSize.all || 0)}`),
      S.cohorts.map((c) => el("option", { value: c.id, selected: c.id === S.cohort }, `${c.name} · ${ppl(n(c.id))}`)));
    cs.addEventListener("change", () => { S.cohort = cs.value; saveScope(); route(); });
    const ps = el("select", null, [[7, "Last 7 days"], [30, "Last 30 days"], [90, "Last 90 days"], [3650, "All time"]]
      .map(([v, t]) => el("option", { value: v, selected: +v === +S.days }, t)));
    ps.addEventListener("change", () => { S.days = +ps.value; saveScope(); route(); });
    return [control("Cohort", cs), withPeriod === false ? null : control("Period", ps)];
  }
  function saveScope() { try { localStorage.setItem("ii.scope", JSON.stringify({ cohort: S.cohort, days: S.days })); } catch (e) { /* ignore */ } }
  const periodText = () => (S.days >= 3650 ? "all time" : `the last ${S.days} days`);
  const backlink = (href, text) => el("a", { class: "backlink", href }, "← " + text);
  const pct = (x) => (x == null ? "—" : `${Math.round(x)}%`);
  /* Short, stable display ids instead of UUIDs. */
  const qCode = (id) => "Q-" + String(id || "").replace(/-/g, "").slice(0, 5).toUpperCase();
  const sCode = (id) => "S-" + String(id || "").replace(/-/g, "").slice(0, 4).toUpperCase();
  const daysSince = (d) => (d ? (Date.now() - new Date(d).getTime()) / 864e5 : Infinity);

  // ------------------------------------------------------------------
  // Boot and routing
  // ------------------------------------------------------------------
  async function boot() {
    let sess;
    try { sess = await API.session(); } catch (e) { sess = null; }
    if (!sess) {
      document.body.classList.add("nonav");
      signInScreen($main, "Use your university email.", "Instructor access is granted by an admin after you first sign in.");
      return;
    }
    if (S.me === sess.user.id) return;          // already booted (auth event + initial load)
    S.me = sess.user.id; S.profile = sess.profile || {}; S.email = sess.user.email;
    Shell.syncTheme(S.profile);
    Shell.syncLang(S.profile);
    S.isAdmin = S.profile.role === "admin";

    // Students who land here go to their own app; the database enforces roles regardless.
    if (S.profile.role !== "instructor" && S.profile.role !== "admin") { location.replace("app.html"); return; }
    SiteNav.mount({ role: "staff", active: "overview" });
    const userBtn = el("button", { class: "userbtn", type: "button" });
    SiteNav.foot.append(userBtn);
    avatarMenu(userBtn, S.profile, sess.user.email, [{ label: "Revision home page", href: "../index.html" }]);
    try { const saved = JSON.parse(localStorage.getItem("ii.scope") || "{}"); S.cohort = saved.cohort || ""; S.days = saved.days || 30; } catch (e) { /* storage off */ }
    await API.runDueSchedules().catch(() => {});
    await loadCohorts();
    S.vocabRows = await API.vocab();
    S.vocab = {};
    for (const v of S.vocabRows) (S.vocab[v.kind] ||= {})[v.id] = v.label;
    window.addEventListener("hashchange", route);
    route();
  }

  function setTabs(active) {
    SiteNav.hide(false);
    SiteNav.setActive(active);
  }

  let dirtyGuard = null;   // returns true when there are unsaved changes
  window.addEventListener("beforeunload", (e) => { if (dirtyGuard && dirtyGuard()) { e.preventDefault(); e.returnValue = ""; } });

  async function route() {
    const [tab, arg] = (location.hash.slice(1) || "overview").split("/");
    if (tab === "settings") {
      dirtyGuard = null; setTabs("settings");
      Shell.settingsPage($main, { profile: S.profile, email: S.email, student: false,
        extra: [aiUsagePanel(), S.isAdmin ? vocabPanel() : null] });
      return;
    }
    const t = TABS.some(([id]) => id === tab) ? tab : "overview";
    API.questionList().then((qs) => SiteNav.setBadge("questions",
      qs.filter((q) => q.status === "draft" && q.version_author === S.me && !q.retired_at).length)).catch(() => {});
    dirtyGuard = null;
    setTabs(t);
    fill($main, el("p", { class: "dim" }, "Loading…"));
    try {
      if (t === "overview") await overview();
      else if (t === "lectures") arg ? await lectureEditor(arg) : await lectureList();
      else if (t === "questions") arg ? await questionEditor(arg) : await questionList();
      else if (t === "students") await students();
      else if (t === "items") await items();
      else if (t === "exams") arg ? await examEditor(arg) : await exams();
      else if (t === "export") await exportTab();
    } catch (e) {
      fill($main, el("div", { class: "banner bad" }, errMsg(e)));
    }
  }

  // ------------------------------------------------------------------
  // Shared form widgets
  // ------------------------------------------------------------------
  /* Searchable multi-select over a vocabulary kind. */
  function multiPicker(kind, selected, disabled) {
    const sel = new Set(selected || []);
    const rows = S.vocabRows.filter((v) => v.kind === kind);
    const search = el("input", { type: "search", placeholder: `Search ${rows.length} ${kind.replace("_", " ")}s…`, disabled });
    const list = el("div", { class: "list" });
    const chosen = el("div", { class: "sel" });
    let onChange = () => {};
    function draw() {
      const q = search.value.trim().toLowerCase();
      fill(list, rows.filter((r) => !q || r.label.toLowerCase().includes(q) || r.id.includes(q)).slice(0, 200).map((r) => {
        const cb = el("input", { type: "checkbox", checked: sel.has(r.id), disabled });
        cb.addEventListener("change", () => { cb.checked ? sel.add(r.id) : sel.delete(r.id); drawSel(); onChange(); });
        return el("label", null, cb, r.label);
      }));
      if (!list.firstChild) list.append(el("span", { class: "dim" }, rows.length ? "No match" : "No terms yet — an admin can add them on the Overview tab."));
    }
    function drawSel() {
      fill(chosen, sel.size ? [...sel].map((id) => el("span", { class: "chip" }, vlabel(kind, id))) : el("span", { class: "dim" }, "None selected"));
    }
    search.addEventListener("input", draw);
    draw(); drawSel();
    return { node: el("div", { class: "picker" }, search, list, chosen), get: () => [...sel],
      set: (ids) => { sel.clear(); (ids || []).forEach((i) => sel.add(i)); draw(); drawSel(); }, set onChange(f) { onChange = f; } };
  }
  const field = (labelText, input, required, hint) =>
    el("label", { class: "f" }, el("span", null, labelText, required ? el("b", null, " *") : null), input, hint ? el("div", { class: "hint" }, hint) : null);

  // ------------------------------------------------------------------
  // Overview
  // ------------------------------------------------------------------
  async function overview() {
    const [ov, studs, questions] = await Promise.all([
      API.cohortOverview(S.cohort, S.days), API.studentSummary(S.cohort, S.days), API.questionList()]);
    S.questions = questions;
    const students = studs.filter((s) => s.role === "student");
    const monthly = ov.monthly_exam_id ? await API.examDetail(ov.monthly_exam_id).catch(() => null) : null;
    const doneCodes = new Set(monthly ? monthly.attempts.filter((a) => a.submitted_at).map((a) => a.code) : []);

    const reasons = (s) => {
      const d = daysSince(s.last_active);
      if (!s.last_active) return "No activity yet";
      if (d > 7) return `No activity for ${Math.floor(d)} days`;
      if ((s.answers || 0) >= 10 && s.pct_correct < 50) return s.prev_pct != null && s.pct_correct < s.prev_pct ? "Average under 50% and falling" : `Average ${Math.round(s.pct_correct)}%, under 50%`;
      if (monthly && ov.checkin && daysSince(ov.checkin.opens_at) > 3 && !doneCodes.has(s.code)) return "Skipped the monthly check-in";
      if ((s.answers || 0) >= 10 && s.confidently_wrong_pct >= 20) return `Confidently wrong on ${Math.round(s.confidently_wrong_pct)}% of answers`;
      if (S.days >= 14 && s.active_days < 4) return `Only ${s.active_days} session${s.active_days === 1 ? "" : "s"} in ${S.days >= 3650 ? "total" : S.days + " days"}`;
      return null;
    };
    const flagged = students.map((s) => ({ s, why: reasons(s) })).filter((x) => x.why)
      .sort((a, b) => daysSince(b.s.last_active) - daysSince(a.s.last_active));
    let showNames = false;
    const flagBody = el("tbody");
    const drawFlags = () => fill(flagBody, flagged.length ? flagged.slice(0, 15).map(({ s, why }) => el("tr", null,
      el("td", { class: "mono" }, showNames ? (s.display_name || s.email) : s.code),
      el("td", null, why), el("td", { class: "mono" }, s.last_active ? fmtDay(s.last_active) : "—")))
      : el("tr", null, el("td", { colspan: 3, class: "empty" }, students.length ? "Nobody needs a check-in right now." : "No students in this cohort yet.")));
    const namesBtn = el("button", { class: "btn small", type: "button" }, "Show names");
    namesBtn.addEventListener("click", async () => {
      showNames = !showNames;
      if (showNames) API.logNamesShown().catch(() => {});
      namesBtn.textContent = showNames ? "Hide names" : "Show names";
      drawFlags();
    });
    drawFlags();

    // Topic accuracy over time: Pre-test column, then weekly columns.
    const weeks = ov.weeks || [];
    const cell = (v) => el("td", null, v == null ? el("div", { class: "heatcell none" }, "—")
      : el("div", { class: "heatcell " + (v < 55 ? "red" : v < 70 ? "amber" : "green") }, pct(v)));
    const rows = (ov.topics || []).filter((t) => t.pretest != null || (t.weeks || []).some((x) => x != null));
    const heat = rows.length
      ? el("div", { class: "tablewrap" }, el("table", { class: "heat" },
          el("thead", null, el("tr", null, el("th", null, "Topic"), el("th", null, "Pre-test"),
            weeks.map((w, i) => el("th", { title: "Week of " + fmtDay(w) }, "Wk " + (i + 1))))),
          el("tbody", null, rows.map((t) => el("tr", null, el("td", null, vlabel("topic", t.topic)), cell(t.pretest),
            weeks.map((_, i) => cell((t.weeks || [])[i])))))))
      : el("p", { class: "dim", style: { margin: 0 } }, "Accuracy appears here once students take the pre-test or answer live questions.");

    const N = ov.students || 0;
    const qRow = (q) => el("tr", { class: "click", onclick: () => (location.hash = "questions/" + q.question_id) },
      el("td", { class: "mono" }, qCode(q.question_id)),
      el("td", { class: "stemcell", translate: "no" }, (q.stem || "").slice(0, 140)), el("td", null, q.author_name || "—"),
      el("td", { class: "mono" }, fmtDay(q.updated_at)));

    const myDrafts = questions.filter((q) => q.status === "draft" && q.version_author === S.me && !q.retired_at);
    const [examsNow, schedules] = await Promise.all([API.examList(S.cohort).catch(() => []), API.scheduleList().catch(() => [])]);
    const soon = examsNow.filter((e) => e.status === "open" && e.closes_at && daysSince(e.closes_at) > -3 && daysSince(e.closes_at) < 0);
    const monthlyLive = questions.filter((q) => q.pool === "monthly" && q.live_version_id && !q.retired_at && !q.hidden_at).length;
    const short = schedules.filter((x) => x.active && x.n_items > monthlyLive);
    const todo = [
      flagged.length ? [`${flagged.length} student${flagged.length === 1 ? "" : "s"} to check in with`, "#students", "See list"] : null,
      myDrafts.length ? [`${myDrafts.length} of your draft${myDrafts.length === 1 ? "" : "s"} not yet published`, "#questions", "Open drafts"] : null,
      ...soon.map((e) => [`${e.title} closes ${fmtDay(e.closes_at)} · ${e.submitted} of ${e.eligible} done`, "#exams/" + e.id, "Open"]),
      short.length ? [`The monthly pool has ${monthlyLive} live item${monthlyLive === 1 ? "" : "s"}; your schedule needs ${Math.max(...short.map((x) => x.n_items))}`, "#questions", "Add items"] : null,
      !S.cohorts.length ? ["No class yet: create a cohort and share its class code", "#students", "Set up"] : null
    ].filter(Boolean);
    const today = el("div", { class: "panel accent" }, el("div", { class: "eyebrow" }, "Today"),
      todo.length ? todo.map(([t, href, act]) => el("div", { class: "listrow" }, el("span", null, t),
        el("a", { href, onclick: act === "Open drafts" ? () => { S.qFilters.mine = "drafts"; } : null }, act)))
                  : el("p", { style: { margin: 0, color: "var(--ink2)" } }, "You are all caught up."));

    fill($main,
      pagehead("Cohort overview", "How the class is doing and who needs help.", scopeControls()),
      today,
      el("div", { class: "cards" },
        stat("Active this week", `${ov.active_week || 0} of ${N}`, N ? `${Math.round(100 * (ov.active_week || 0) / N)}% of the cohort` : "No students yet", "#students"),
        stat("Average score", pct(ov.avg), ov.pretest_avg != null ? `Pre-test was ${pct(ov.pretest_avg)}` : `Over ${periodText()}`, "#items"),
        stat("Check-in completed", ov.checkin ? `${ov.checkin.done} of ${N}` : "—",
          ov.checkin ? `Opened ${Math.max(0, Math.floor(daysSince(ov.checkin.opens_at)))} days ago` : "No check-in opened yet", "#exams"),
        stat("Flagged for support", flagged.length, "Review the list below")),
      el("div", { class: "cols" },
        el("div", { class: "panel" }, el("h3", null, "Topic accuracy over time"), heat,
          el("p", { class: "foot" }, "Cohort accuracy. Under 55%: reteach. 55 to 69%: watch. 70% and above: on track.")),
        el("div", { class: "panel" }, el("h3", null, "Students to check in with"),
          el("div", { class: "tablewrap" }, el("table", null,
            el("thead", null, el("tr", null, el("th", null, "Student"), el("th", null, "Why flagged"), el("th", null, "Last active"))),
            flagBody)),
          el("div", { class: "row", style: { marginTop: "14px" } }, namesBtn, el("a", { class: "btn small", href: "#students" }, "All students")),
          el("p", { class: "foot" }, "Pseudonymous IDs by default. Showing names is limited to course staff and is logged."))),
      el("div", { class: "panel" }, el("h3", null, "Your unpublished drafts"),
        myDrafts.length ? el("div", { class: "tablewrap" }, el("table", null,
          el("thead", null, el("tr", null, ["Item", "Stem", "Lecture", "Updated"].map((h) => el("th", null, h)))),
          el("tbody", null, myDrafts.slice(0, 10).map((q) => el("tr", { class: "click", onclick: () => (location.hash = "questions/" + q.question_id) },
            el("td", { class: "mono" }, qCode(q.question_id)), el("td", { class: "stemcell", translate: "no" }, (q.stem || "").slice(0, 140)),
            el("td", null, q.lecture_number != null ? `L${q.lecture_number}` : "—"), el("td", { class: "mono" }, fmtDay(q.updated_at)))))))
          : el("p", { class: "dim", style: { margin: 0 } }, "Nothing waiting. New and imported questions appear here until you publish them.")),
    );
  }

  /* Admin: the tag lists used to label lectures and questions. Designed to be filled
     from a generated file (e.g. AI-produced CSV/JSON), with a single-term form for fixes. */
  function vocabPanel() {
    const kinds = ["topic", "disease", "organism", "niche", "failure_mode", "cascade_step", "tier", "bloom", "difficulty"];
    const counts = el("p", { class: "dim", style: { margin: "0 0 14px" } },
      kinds.map((k) => `${k.replace("_", " ")}: ${S.vocabRows.filter((v) => v.kind === k).length}`).join(" · "));
    const refresh = async () => {
      S.vocabRows = await API.vocab();
      S.vocab = {}; for (const v of S.vocabRows) (S.vocab[v.kind] ||= {})[v.id] = v.label;
      route();
    };
    // bulk import
    const file = el("input", { type: "file", accept: ".csv,.json,text/csv,application/json" });
    const result = el("div");
    const importBtn = el("button", { class: "btn primary", type: "button" }, "Import tag file");
    importBtn.addEventListener("click", async () => {
      const f = file.files[0];
      if (!f) { toast("Choose a .csv or .json file first.", true); return; }
      let rows;
      try {
        const text = await f.text();
        rows = /\.json$/i.test(f.name) || /^\s*[[{]/.test(text) ? [].concat(JSON.parse(text)) : parseCSV(text);
      } catch (e) { toast("Could not read the file: " + errMsg(e), true); return; }
      rows = rows.map((r) => ({ kind: String(r.kind || "").trim(), id: String(r.id || "").trim(), label: String(r.label || "").trim() }));
      const bad = rows.filter((r) => !kinds.includes(r.kind) || !r.id || !r.label);
      const good = rows.filter((r) => !bad.includes(r));
      importBtn.disabled = true;
      let ok = 0; const failed = [];
      for (const r of good) {
        try { await API.upsertVocab(r.kind, r.id, r.label); ok++; } catch (e) { failed.push(`${r.kind}/${r.id}: ${errMsg(e)}`); }
      }
      importBtn.disabled = false;
      fill(result, el("div", { class: failed.length || bad.length ? "banner warn" : "banner info" },
        `${ok} term${ok === 1 ? "" : "s"} added or renamed.`,
        bad.length ? el("p", { style: { margin: "6px 0 0" } }, `${bad.length} row${bad.length === 1 ? "" : "s"} skipped: each needs kind, id and label, and kind must be one of: ${kinds.join(", ")}.`) : null,
        failed.length ? el("ul", null, failed.slice(0, 10).map((x) => el("li", null, x))) : null));
      if (ok) setTimeout(refresh, 1200);
    });
    const tagPrompt = el("button", { class: "btn small", type: "button", onclick: async () => {
      const existing = (k) => S.vocabRows.filter((v) => v.kind === k).map((v) => v.id).join(", ") || "(none)";
      const text = [
        "You are building tag lists for an Infection & Immunity course for Thai medical students (ศรว. 2567).",
        "Produce new entries for these lists: topic (teaching topics) and disease (clinical syndromes and diseases a student must recognise).",
        "Return ONLY CSV with the header line kind,id,label and one row per entry. No other text.",
        "- kind: topic or disease",
        "- id: lowercase words joined by hyphens, e.g. bacterial-meningitis. Never change or reuse an existing id.",
        "- label: the name people will see, e.g. Bacterial meningitis",
        "- Use standard terminology (Harrison's Infectious Diseases). No duplicates of the existing ids below.",
        "Existing topic ids: " + existing("topic"),
        "Existing disease ids: " + existing("disease")
      ].join("\n");
      try { await navigator.clipboard.writeText(text); toast("Prompt copied. Paste it into your AI chat, save the reply as tags.csv and import it here."); }
      catch (e) { modal("AI prompt for tag lists", el("textarea", { rows: 12, readonly: true, value: text })); }
    } }, "Copy AI prompt");
    const template = el("button", { class: "btn small", type: "button", onclick: () => download("tag-template.csv",
      toCSV([{ kind: "disease", id: "bacterial-meningitis", label: "Bacterial meningitis" },
             { kind: "topic", id: "vaccines", label: "Vaccines and prevention" }], ["kind", "id", "label"]), "text/csv") }, "CSV template");

    // single term
    const kindSel = el("select", null, kinds.map((k) => el("option", { value: k }, k.replace("_", " "))));
    const id = el("input", { type: "text", placeholder: "e.g. bacterial-meningitis" });
    const lab = el("input", { type: "text", placeholder: "Label shown to people" });
    const add = el("button", { class: "btn", type: "button" }, "Add or rename one term");
    add.addEventListener("click", async () => {
      await guard(() => API.upsertVocab(kindSel.value, id.value.trim(), lab.value.trim()), "Saved.");
      refresh();
    });
    return el("div", { class: "panel" }, el("h3", { style: { marginBottom: "4px" } }, "Tag lists (admins)"),
      el("p", { class: "dim", style: { margin: "0 0 10px" } }, "The fixed lists used to tag lectures and questions: topics, diseases, organisms and so on. Teachers pick from these lists; they do not type tags."),
      counts,
      el("p", { class: "label" }, "Import a generated list"),
      el("p", { class: "hint", style: { margin: "0 0 10px" } }, "CSV with columns kind, id, label (or a JSON array of the same). Existing ids are renamed, new ids are added; nothing is deleted."),
      el("div", { class: "row", style: { marginBottom: "12px" } }, file, template, tagPrompt), importBtn, result,
      el("p", { class: "label", style: { marginTop: "22px" } }, "Fix one term"),
      el("div", { class: "grid2" }, field("Kind", kindSel), field("Id", id), field("Label", lab)), add);
  }

  // ------------------------------------------------------------------
  // Lectures
  // ------------------------------------------------------------------
  async function lectureList() {
    S.lectures = await API.lectureList();
    fill($main,
      pagehead("Lectures", "Published lectures appear in the student Learn tab unless you hide them. You see your own drafts and every published lecture.",
        el("button", { class: "btn primary", type: "button", onclick: () => (location.hash = "lectures/new") }, "New lecture")),
      el("div", { class: "panel" }, S.lectures.length ? el("div", { class: "tablewrap" }, el("table", null,
        el("thead", null, el("tr", null, ["No.", "Title", "Niche", "Status", "Author", "Last edited", "Opened by", "Live Qs"].map((h, i) => el("th", { class: i === 0 || i > 5 ? "num" : null }, h)))),
        el("tbody", null, S.lectures.map((l) => el("tr", { class: "click" + (l.hidden_at ? " ishidden" : ""), onclick: () => (location.hash = "lectures/" + l.id) },
          el("td", { class: "num" }, String(l.number)), el("td", { translate: "no" }, l.title), el("td", null, Render.shortNiche(S.vocab, l.niche)),
          el("td", null, statusChip(l.status), l.hidden_at ? [" ", statusChip("hidden")] : null), el("td", null, l.author_name || "—"), el("td", null, fmtDate(l.updated_at)),
          el("td", { class: "num" }, String(l.viewers || 0)), el("td", { class: "num" }, String(l.questions || 0)))))))
        : el("div", { class: "empty" }, "No lectures yet.")));
  }

  async function lectureEditor(id) {
    const isNew = id === "new";
    const lec = isNew ? { number: "", title: "", niche: "", summary: "", disease_ids: [], organism_ids: [], cascade_step: null, status: "draft", author_id: S.me }
                      : await API.getLecture(id);
    const canEdit = isNew || lec.author_id === S.me || S.isAdmin;
    const viewers = isNew ? 0 : await API.lectureViewCount(id).catch(() => 0);

    const f = {
      number: el("input", { type: "number", min: 1, value: lec.number, disabled: !canEdit }),
      title: el("input", { type: "text", value: lec.title, disabled: !canEdit, maxlength: 200 }),
      niche: el("select", { disabled: !canEdit }, opts("niche", lec.niche, "Choose a niche")),
      summary: el("textarea", { rows: 10, disabled: !canEdit, placeholder: "One bullet per line.\nCapsule blocks C3b deposition\nSplenectomy → overwhelming sepsis" }),
      cascade: el("select", { disabled: !canEdit }, opts("cascade_step", lec.cascade_step, "None")),
      diseases: multiPicker("disease", lec.disease_ids, !canEdit),
      organisms: multiPicker("organism", lec.organism_ids, !canEdit)
    };
    f.summary.value = lec.summary || "";
    let dirty = false;
    const markDirty = () => { dirty = true; saveBtn.disabled = !canEdit; };
    [f.number, f.title, f.niche, f.summary, f.cascade].forEach((n) => n.addEventListener("input", markDirty));
    f.diseases.onChange = markDirty; f.organisms.onChange = markDirty;
    dirtyGuard = () => dirty;

    const payload = () => ({
      id: isNew ? null : id, number: f.number.value, title: f.title.value, niche: f.niche.value,
      summary: f.summary.value, disease_ids: f.diseases.get(), organism_ids: f.organisms.get(),
      cascade_step: f.cascade.value || null
    });
    const localErrors = (p) => [
      !/^\d+$/.test(String(p.number)) || +p.number < 1 ? "Lecture number must be a positive whole number." : null,
      !p.title.trim() ? "Title is required." : null,
      !p.niche ? "Niche is required." : null
    ].filter(Boolean);
    const errBox = el("div");
    async function save() {
      const p = payload();
      const errs = localErrors(p);
      clear(errBox);
      if (errs.length) { errBox.append(el("div", { class: "banner bad" }, el("ul", null, errs.map((e) => el("li", null, e))))); return null; }
      const newId = await guard(() => API.saveLecture(p), "Lecture saved.");
      dirty = false;
      return newId;
    }
    const saveBtn = el("button", { class: "btn primary", type: "button", disabled: !canEdit || !isNew },
      lec.status === "published" ? "Save changes (live)" : "Save draft");
    saveBtn.addEventListener("click", async () => {
      const newId = await save();
      if (newId && isNew) location.hash = "lectures/" + newId; else if (newId) route();
    });
    const previewBtn = el("button", { class: "btn", type: "button", onclick: () => {
      const p = payload();
      modal("Preview — exactly what a student sees", el("div", { class: "preview-frame" },
        el("div", { class: "preview-tag" }, "Student Learn tab"), renderLecture(p, S.vocab)));
    } }, "Preview as student");
    const promptBtn = isNew ? null : el("button", { class: "btn", type: "button", onclick: () => promptDialog({ ...lec, ...payload(), id }) }, "AI prompt for questions");
    const genBtn = isNew ? null : el("button", { class: "btn primary", type: "button", onclick: () => { if (dirty) { toast("Save your changes first.", true); return; } generateDialog(lec); } }, "Generate questions with AI");

    let pubBtn = null;
    if (!isNew && canEdit) {
      if (lec.status === "draft") {
        pubBtn = el("button", { class: "btn good", type: "button" }, "Publish");
        pubBtn.addEventListener("click", async () => {
          if (dirty && !(await save())) return;
          await guard(() => API.publishLecture(id), "Published — students can see it now.");
          route();
        });
      } else {
        pubBtn = el("button", { class: "btn danger", type: "button" }, "Unpublish");
        pubBtn.addEventListener("click", async () => {
          const n = await API.lectureViewCount(id).catch(() => viewers);
          const ok = await confirmBox("Unpublish this lecture?",
            n > 0 ? [el("div", { class: "banner warn" }, `${n} student${n === 1 ? " has" : "s have"} already opened this lecture.`),
                     el("p", null, "It will disappear from their Learn tab. Their view history and answers are kept.")]
                  : "No students have opened it yet. It will move back to drafts.",
            "Unpublish", true);
          if (!ok) return;
          await guard(() => API.unpublishLecture(id), "Unpublished.");
          route();
        });
      }
    }

    let hideBtn = null;
    if (!isNew && canEdit && lec.status === "published") {
      hideBtn = el("button", { class: "btn", type: "button" }, lec.hidden_at ? "Show to students" : "Hide from students");
      hideBtn.addEventListener("click", async () => {
        if (!lec.hidden_at) {
          const ok = await confirmBox("Hide this lecture?",
            [el("p", null, "Students stop seeing it in Learn, and its practice questions leave their reviews. Nothing is deleted: views, answers and the questions are kept."),
             el("p", { class: "dim" }, "You can show it again at any time.")], "Hide", true);
          if (!ok) return;
        }
        await guard(() => API.setLectureHidden(id, !lec.hidden_at), lec.hidden_at ? "Students can see it again." : "Hidden from students.");
        route();
      });
    }

    fill($main,
      backlink("#lectures", "All lectures"),
      pagehead(isNew ? "New lecture" : `Lecture ${lec.number}: ${lec.title}`,
        isNew ? "Write the summary, tag it, preview it, then publish." : null, statusChip(lec.status), lec.hidden_at ? statusChip("hidden") : null),
      lec.hidden_at ? el("div", { class: "banner info" }, `Hidden from students since ${fmtDay(lec.hidden_at)}. They cannot open it, and its questions are out of their practice. Click “Show to students” to bring it back.`) : null,
      !canEdit ? el("div", { class: "banner info" }, "Read only — only the author or an admin can edit this lecture.") : null,
      lec.status === "published" && !lec.hidden_at && canEdit ? el("div", { class: "banner warn" }, "This lecture is published. Saved changes appear to students immediately.") : null,
      el("div", { class: "split" },
        el("div", { class: "panel" },
          el("div", { class: "grid2" }, field("Lecture number", f.number, true), field("Niche", f.niche, true), field("Cascade step", f.cascade)),
          field("Title", f.title, true),
          field("Summary", f.summary, false, "Plain text. One bullet per line; a leading “-” or “•” is optional. Formatting characters are shown as typed."),
          el("div", { class: "grid2" }, field("Linked organisms", f.organisms.node), field("Linked diseases", f.diseases.node)),
          errBox),
        el("div", { class: "sidebar" },
          el("div", { class: "panel" },
            el("div", { class: "row" }, saveBtn, previewBtn, pubBtn, hideBtn, genBtn, promptBtn),
            el("dl", { class: "meta" },
              isNew ? null : [el("dt", null, "Last edited"), el("dd", null, fmtDate(lec.updated_at)),
                              el("dt", null, "Published"), el("dd", null, fmtDate(lec.published_at)),
                              el("dt", null, "Students who opened it"), el("dd", null, String(viewers))])))));
  }

  // ------------------------------------------------------------------
  // Questions — list
  // ------------------------------------------------------------------
  async function questionList() {
    const [qs, lecs] = await Promise.all([API.questionList(), API.lectureList()]);
    S.questions = qs; S.lectures = lecs;
    const F = S.qFilters;
    const sel = new Set();
    const authors = [...new Map(qs.map((q) => [q.version_author, q.author_name || "—"])).entries()];
    const mk = (key, labelText, options) => {
      const s = el("select", null, el("option", { value: "" }, "All"), options.map(([v, l]) => el("option", { value: v, selected: F[key] === v }, l)));
      s.addEventListener("change", () => { F[key] = s.value; draw(); });
      return el("label", null, labelText, s);
    };
    const vopts = (kind) => S.vocabRows.filter((v) => v.kind === kind).map((v) => [v.id, v.label]);
    const search = el("input", { type: "search", placeholder: "Search stems…", value: F.q });
    search.addEventListener("input", () => { F.q = search.value; draw(); });
    const body = el("tbody");
    const countEl = el("span", { class: "dim" });
    if (F.mine === "review") F.mine = "";
    const draftsBtn = el("button", { class: "btn chipbtn", type: "button", "aria-pressed": String(F.mine === "drafts") },
      `My drafts (${qs.filter((q) => q.status === "draft" && q.version_author === S.me).length})`);
    draftsBtn.addEventListener("click", () => { F.mine = F.mine === "drafts" ? "" : "drafts"; draftsBtn.setAttribute("aria-pressed", String(F.mine === "drafts")); draw(); });

    // bulk actions
    const bulk = el("div", { class: "banner info", hidden: true, style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" } });
    let visible = [];
    const selectAll = el("input", { type: "checkbox", "aria-label": "Select all shown" });
    selectAll.addEventListener("change", () => { visible.forEach((r) => (selectAll.checked ? sel.add(r.question_id) : sel.delete(r.question_id))); draw(); });
    async function runBulk(label, fn) {
      const ids = [...sel];
      let ok = 0; const fails = [];
      for (const id of ids) {
        const r = qs.find((q) => q.question_id === id);
        try { await fn(r); ok++; } catch (e) { fails.push(`${qCode(id)}: ${errMsg(e)}`); }
      }
      toast(`${label}: ${ok} of ${ids.length} done.` + (fails.length ? ` ${fails.length} skipped.` : ""), fails.length > 0);
      if (fails.length) modal("Some items were skipped", el("ul", null, fails.slice(0, 20).map((f) => el("li", null, f))));
      route();
    }
    function drawBulk() {
      bulk.hidden = sel.size === 0;
      if (!sel.size) return;
      const poolSel = el("select", { style: { width: "auto" } }, POOLS.map((p) => el("option", { value: p }, "Move to " + p)));
      fill(bulk, el("b", null, `${sel.size} selected`),
        el("button", { class: "btn small good", type: "button", onclick: async () => {
          const ai = qs.filter((q) => sel.has(q.question_id) && q.source === "ai" && q.status === "draft").length;
          if (ai && !(await confirmAiChecked(ai))) return;
          runBulk("Published", (r) => {
            if (r.status !== "draft") throw new Error("already " + r.status);
            return API.publishQuestionNow(r.version_id);
          });
        } }, "Publish"),
        S.isAdmin ? [poolSel, el("button", { class: "btn small", type: "button", onclick: () => runBulk("Moved", (r) => API.setQuestionPool(r.question_id, poolSel.value)) }, "Move")] : null,
        el("button", { class: "btn small danger", type: "button", onclick: async () => {
          const ok = await confirmBox(`Retire ${sel.size} item${sel.size === 1 ? "" : "s"}?`, "They leave every student pool. All versions and answers are kept.", "Retire", true);
          if (ok) runBulk("Retired", (r) => API.retireQuestion(r.question_id));
        } }, "Retire"),
        el("button", { class: "btn small", type: "button", onclick: async () => {
          const ok = await confirmBox(`Hide ${sel.size} item${sel.size === 1 ? "" : "s"}?`,
            "Hidden items leave student practice and exam picking until you show them again. Only items no student has answered or reviewed, and that are in no exam, can be hidden; the rest are skipped (retire those instead).", "Hide", true);
          if (ok) runBulk("Hidden", (r) => API.setQuestionHidden(r.question_id, true));
        } }, "Hide"),
        el("button", { class: "btn small", type: "button", onclick: () => runBulk("Shown", (r) => API.setQuestionHidden(r.question_id, false)) }, "Show"),
        el("button", { class: "btn small danger", type: "button", onclick: async () => {
          const ok = await confirmBox(`Delete ${sel.size} item${sel.size === 1 ? "" : "s"}?`,
            "Items students have not used are deleted for good. Items with student answers are skipped (retire those instead)" + (S.isAdmin ? "." : ", unless an admin deletes them."), "Delete", true);
          if (ok) runBulk("Deleted", (r) => API.deleteQuestion(r.question_id, false));
        } }, "Delete"),
        el("button", { class: "btn small", type: "button", onclick: () => { sel.clear(); draw(); } }, "Clear selection"));
    }

    function draw() {
      const q = F.q.trim().toLowerCase();
      visible = qs.filter((r) =>
        (F.mine !== "drafts" || (r.status === "draft" && r.version_author === S.me)) &&
        (!F.status || (F.status === "hidden" ? !!r.hidden_at : r.status === F.status || (F.status === "live" && r.live_version_id && !r.retired_at))) &&
        (!F.pool || r.pool === F.pool) && (!F.source || (F.source === "ai" ? r.source === "ai" : r.source !== "ai")) && (!F.niche || r.niche === F.niche) && (!F.topic || r.topic === F.topic) &&
        (!F.author || r.version_author === F.author) && (!F.lecture || r.lecture_id === F.lecture) &&
        (!F.tier || r.tier === F.tier) && (!F.difficulty || r.difficulty === F.difficulty) &&
        (!q || (r.stem || "").toLowerCase().includes(q)))
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
      countEl.textContent = `${visible.length} of ${qs.length} items`;
      selectAll.checked = visible.length > 0 && visible.every((r) => sel.has(r.question_id));
      fill(body, visible.length ? visible.map((r) => {
        const cb = el("input", { type: "checkbox", checked: sel.has(r.question_id), "aria-label": "Select " + qCode(r.question_id) });
        cb.addEventListener("click", (e) => e.stopPropagation());
        cb.addEventListener("change", () => { cb.checked ? sel.add(r.question_id) : sel.delete(r.question_id); drawBulk();
          selectAll.checked = visible.every((x) => sel.has(x.question_id)); });
        return el("tr", { class: "click" + (r.hidden_at ? " ishidden" : ""), onclick: () => (location.hash = "questions/" + r.question_id) },
          el("td", null, cb),
          el("td", { class: "mono" }, qCode(r.question_id)),
          el("td", { class: "stemcell" }, r.source === "ai" ? el("span", { class: "aichip", title: "Written by AI: check before publishing" }, "AI") : null,
            el("span", { translate: "no" }, (r.stem || "").length > 150 ? r.stem.slice(0, 150) + "…" : r.stem)),
          el("td", null, statusChip(r.status), r.hidden_at ? [" ", statusChip("hidden")] : null,
            r.live_version_id && r.status !== "live" && !r.retired_at ? el("div", { class: "hint" }, `v${r.live_version} live`) : null),
          el("td", null, r.pool),
          el("td", null, r.lecture_number != null ? `L${r.lecture_number}` : "—"),
          el("td", null, el("span", { class: "chip" }, vlabel("topic", r.topic)), r.tier ? el("span", { class: "chip" }, "Tier " + r.tier) : null,
            r.difficulty ? el("span", { class: "chip" }, r.difficulty) : null),
          el("td", { class: "num" }, "v" + r.version),
          el("td", { class: "num" }, r.answers ? `${Math.round(r.pct_correct)}% (${r.answers})` : "—"),
          el("td", null, r.author_name || "—"),
          el("td", null, fmtDay(r.updated_at)));
      }) : el("tr", null, el("td", { colspan: 11, class: "empty" },
        qs.length ? "No items match these filters." : "No questions yet.")));
      drawBulk();
    }

    fill($main,
      pagehead("Question bank", "Write questions, preview them and publish. Tick several to publish, hide, retire or delete them together.",
        el("button", { class: "btn primary", type: "button", onclick: () => generateDialog(null) }, "Generate with AI"),
        el("button", { class: "btn", type: "button", onclick: () => promptDialog() }, "AI prompt"),
        el("button", { class: "btn", type: "button", onclick: importDialog }, "Import CSV / JSON"),
        el("button", { class: "btn primary", type: "button", onclick: () => (location.hash = "questions/new") }, "New question")),
      el("div", { class: "panel" },
      el("div", { class: "row", style: { gap: "8px", marginBottom: "14px" } }, draftsBtn),
      el("div", { class: "searchrow" }, el("div", { style: { flex: "1" } }, search), countEl),
      el("div", { class: "filters" },
        mk("status", "Status", STATUSES.map((s) => [s, STATUS_LABEL[s]])),
        mk("pool", "Pool", POOLS.map((p) => [p, p])),
        mk("source", "Written by", [["ai", "AI (generated)"], ["people", "People"]]),
        mk("niche", "Niche", vopts("niche").map(([v]) => [v, Render.shortNiche(S.vocab, v)])),
        mk("topic", "Topic", vopts("topic")),
        mk("author", "Author", authors),
        mk("lecture", "Lecture", lecs.map((l) => [l.id, `L${l.number} ${l.title}`])),
        mk("tier", "Tier", vopts("tier")),
        mk("difficulty", "Difficulty", vopts("difficulty"))),
      bulk,
      el("div", { class: "tablewrap" }, el("table", null,
        el("thead", null, el("tr", null, el("th", null, selectAll),
          ["Item", "Stem", "Status", "Pool", "Lecture", "Tags", "Ver", "Correct (n)", "Author", "Updated"].map((h, i) => el("th", { class: i === 6 || i === 7 ? "num" : null }, h)))),
        body))));
    draw();
  }

  // ------------------------------------------------------------------
  // Generate questions with AI (inside the website). The server function
  // supabase/functions/generate-questions holds the AI key; drafts only.
  // ------------------------------------------------------------------
  const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/";
  let pdfjsReady = null;
  function loadScript(src) {
    return new Promise((ok, bad) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => bad(new Error("Could not load the PDF reader. Check your internet connection.")); document.head.appendChild(s); });
  }
  // pdf.js runs in this page (its worker script is loaded first, so no separate worker is needed under the page's security policy)
  function loadPdfJs() {
    if (!pdfjsReady) pdfjsReady = loadScript(PDFJS + "pdf.worker.min.js").then(() => loadScript(PDFJS + "pdf.min.js")).then(() => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js";
      return window.pdfjsLib;
    });
    return pdfjsReady;
  }
  /* The text of an instructor's PDF, read in the browser. Only this text is sent to the AI. */
  async function pdfText(file, onPage) {
    if (file.size > 25 * 1024 * 1024) throw new Error("That PDF is larger than 25 MB. Split it or use the lecture summary.");
    const lib = await loadPdfJs();
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, disableFontFace: true }).promise;
    const pages = [];
    for (let i = 1; i <= Math.min(doc.numPages, 80); i++) {
      const p = await doc.getPage(i);
      const tc = await p.getTextContent();
      pages.push(tc.items.map((x) => x.str + (x.hasEOL ? "\n" : " ")).join("").replace(/[ \t]+/g, " ").trim());
      if (onPage) onPage(i, doc.numPages);
    }
    const text = pages.filter(Boolean).join("\n\n");
    if (text.replace(/\s/g, "").length < 200)
      throw new Error("This PDF has no readable text (it may be scanned images). Use a PDF with selectable text, or generate from the lecture summary.");
    return { text: text.slice(0, 60000), pages: doc.numPages, truncated: text.length > 60000 };
  }

  async function generateDialog(lecture) {
    const lecs = (S.lectures && S.lectures.length ? S.lectures : await API.lectureList().catch(() => []));
    const lecSel = el("select", null, el("option", { value: "" }, "Choose a lecture"),
      lecs.map((l) => el("option", { value: l.id, selected: lecture && lecture.id === l.id }, `L${l.number} · ${l.title}${l.status === "draft" ? " (draft)" : ""}`)));
    const srcLecture = el("input", { type: "radio", name: "aisrc", value: "lecture", checked: true });
    const srcPdf = el("input", { type: "radio", name: "aisrc", value: "pdf" });
    const file = el("input", { type: "file", accept: "application/pdf,.pdf", disabled: true });
    const n = el("input", { type: "number", min: 1, max: 20, value: 10, style: { width: "100px" } });
    const nOpt = el("select", { style: { width: "auto" } }, [3, 4, 5].map((k) => el("option", { value: k, selected: k === 4 }, k + " options")));
    const diff = el("select", null, [["medium", "mostly medium, a few easy and hard"], ["easy", "mostly easy (for practice)"], ["hard", "mostly hard (for exams)"]]
      .map(([v, t]) => el("option", { value: v }, t)));
    const focus = el("input", { type: "text", maxlength: 300, placeholder: "Optional, e.g. complement deficiencies and Neisseria" });
    const usage = el("p", { class: "hint", style: { margin: "0 0 12px" } });
    const status = el("div", { role: "status", "aria-live": "polite", style: { marginTop: "12px" } });
    [srcLecture, srcPdf].forEach((r) => r.addEventListener("change", () => { file.disabled = !srcPdf.checked; }));
    API.aiGenerationList(5).then((rows) => {
      const r = rows && rows[0];
      usage.textContent = r ? `Used today: ${r.used_today} of ${r.daily_limit} questions.` : "Up to 100 questions a day per instructor.";
    }).catch(() => {});
    let running = false;
    const dlg = modal("Generate questions with AI", [
      el("div", { class: "banner info", style: { marginTop: 0 } },
        "The AI writes drafts only. Nothing reaches students until you check each question and publish it. AI can be wrong: check the key, the facts and the wrong options."),
      usage,
      field("File the questions under", lecSel, true, "Their lecture tag. Generating from the lecture uses its summary."),
      el("div", { class: "f" }, el("span", null, "Source"),
        el("label", { class: "consentbox", style: { marginBottom: "8px" } }, srcLecture, el("span", null, el("b", null, "The lecture summary"))),
        el("label", { class: "consentbox", style: { marginBottom: "8px", flexWrap: "wrap" } }, srcPdf,
          el("span", null, el("b", null, "A PDF of my own teaching material"), el("small", null, "Handouts or slides you wrote, with selectable text. Only the text is sent; please do not upload textbooks.")), file)),
      el("div", { class: "grid2" }, field("How many (1–20)", n), field("Options per question", nOpt), field("Difficulty", diff), field("Focus", focus)),
      status
    ], [
      { label: "Close" },
      { label: "Generate drafts", cls: "primary", onClick: async (close) => {
        if (running) return;
        if (!lecSel.value) { fill(status, el("p", { class: "err" }, "Choose a lecture to file the questions under.")); return; }
        if (srcPdf.checked && !file.files.length) { fill(status, el("p", { class: "err" }, "Choose a PDF file.")); return; }
        running = true;
        const btns = dlg.box.querySelectorAll(".row.end .btn"); btns.forEach((b) => (b.disabled = true));
        try {
          let source_text = null, source_name = null;
          if (srcPdf.checked) {
            fill(status, el("p", { class: "dim" }, "Reading the PDF…"));
            const pdf = await pdfText(file.files[0], (i, total) => fill(status, el("p", { class: "dim" }, `Reading the PDF… page ${i} of ${total}`)));
            source_text = pdf.text; source_name = file.files[0].name;
            if (pdf.truncated) fill(status, el("p", { class: "dim" }, "Long PDF: only the first part is used."));
          }
          fill(status, el("p", { class: "dim" }, "Writing questions… this can take up to a minute."));
          const r = await API.generateQuestions({ lecture_id: lecSel.value, n: Math.max(1, Math.min(20, +n.value || 10)), options: +nOpt.value,
                                                   difficulty: diff.value, focus: focus.value.trim(), source_text, source_name });
          fill(status,
            el("div", { class: "banner " + (r.saved ? "ok" : "warn") },
              `${r.saved} draft${r.saved === 1 ? "" : "s"} saved` + (r.rejected && r.rejected.length ? `, ${r.rejected.length} rejected` : "") + "."),
            r.rejected && r.rejected.length ? el("details", null, el("summary", null, "Why some were rejected"),
              el("ul", null, r.rejected.slice(0, 20).map((x) => el("li", null, el("span", { translate: "no" }, (x.stem || "").slice(0, 80) + "… "), "— ", x.errors)))) : null,
            r.duplicates && r.duplicates.length ? el("p", { class: "hint" }, `${r.duplicates.length} may repeat a question already in the bank; the editor shows which.`) : null,
            r.remaining != null ? el("p", { class: "hint" }, `${r.remaining} questions left today.`) : null);
          if (r.saved) {
            const go = el("button", { class: "btn primary", type: "button", onclick: () => { close(); S.qFilters.mine = ""; S.qFilters.source = "ai"; S.qFilters.status = "draft"; location.hash = "questions"; route(); } }, "Review the drafts");
            status.appendChild(go);
          }
        } catch (e) {
          fill(status, el("div", { class: "banner bad" }, errMsg(e)));
        }
        running = false;
        btns.forEach((b) => (b.disabled = false));
      } }
    ]);
  }

  /* Settings: recent AI generations (yours; admins see everyone's). */
  function aiUsagePanel() {
    const box = el("div", { class: "panel" }, el("h3", null, "AI question generation"), el("p", { class: "dim" }, "Loading…"));
    API.aiGenerationList(30).then((rows) => {
      const r0 = rows[0];
      fill(box, el("h3", { style: { marginBottom: "4px" } }, "AI question generation"),
        el("p", { class: "dim", style: { margin: "0 0 12px" } },
          (S.isAdmin ? "Recent generations by everyone. " : "Your recent generations. ") +
          (r0 ? `You have used ${r0.used_today} of ${r0.daily_limit} questions today.` : "Up to 100 questions a day per instructor.")),
        rows.length ? el("div", { class: "tablewrap" }, el("table", null,
          el("thead", null, el("tr", null, ["When", "Who", "Lecture", "Source", "Saved", "Rejected", "Status"].map((h, i) => el("th", { class: i === 4 || i === 5 ? "num" : null }, h)))),
          el("tbody", null, rows.map((g) => el("tr", null,
            el("td", { class: "mono" }, fmtDate(g.created_at)), el("td", { translate: "no" }, g.author_name || "—"),
            el("td", { translate: "no" }, g.lecture_number != null ? `L${g.lecture_number} ${g.lecture_title}` : "—"),
            el("td", null, g.source === "pdf" ? el("span", null, "PDF: ", el("span", { translate: "no" }, g.source_name || "")) : "Lecture summary"),
            el("td", { class: "num" }, g.n_saved == null ? "—" : String(g.n_saved)), el("td", { class: "num" }, g.n_rejected == null ? "—" : String(g.n_rejected)),
            el("td", { title: g.error || "" }, g.status === "failed" ? el("span", { class: "err" }, "Failed") : g.status === "running" ? "Running" : "Done"))))))
          : el("p", { class: "dim", style: { margin: 0 } }, "No generations yet."));
    }).catch((e) => fill(box, el("h3", null, "AI question generation"), el("p", { class: "err" }, errMsg(e))));
    return box;
  }

  /* Publishing something the AI wrote needs a short, explicit check. */
  function confirmAiChecked(count) {
    return confirmBox(count > 1 ? `Publish ${count} AI-written questions?` : "Publish an AI-written question?",
      [el("p", null, "Students will see " + (count > 1 ? "them" : "it") + " straight away. Please confirm you have checked:"),
       el("ul", null, el("li", null, "the answer key is right"), el("li", null, "the facts in the stem and the explanation"),
         el("li", null, "the wrong options are clearly wrong, and there is only one best answer"))],
      "I checked, publish");
  }

  /* The ground prompt: instructors paste it into any AI chat; the reply imports as-is. */
  function questionPrompt(o) {
    const list = (kind) => S.vocabRows.filter((v) => v.kind === kind).map((v) => `${v.id} (${v.label})`).join("; ");
    const ids = (kind) => S.vocabRows.filter((v) => v.kind === kind).map((v) => v.id).join(", ");
    const lec = o.lecture;
    return [
      `You are writing single-best-answer multiple-choice questions for an Infection & Immunity course for Thai medical students (ศรว. 2567 licensing level).`,
      ``,
      `Write ${o.n} questions${lec ? ` for Lecture ${lec.number}: ${lec.title}` : ""}${o.focus ? `, focusing on: ${o.focus}` : ""}.`,
      lec && lec.summary ? `Lecture summary:\n${bulletLines(lec.summary).map((b) => "- " + b).join("\n")}` : null,
      ``,
      `Rules`,
      `- Each stem is a short clinical vignette or a mechanism question with one clear best answer.`,
      `- ${o.options} options per question, exactly one correct. Options are similar in length and style. Wrong options must be plausible to a student who half-knows the topic.`,
      `- Do not use "all of the above", "none of the above" or negatives such as "EXCEPT" or "NOT".`,
      `- explanation: 2 to 4 sentences saying why the answer is right and why the most tempting wrong option is wrong.`,
      `- Use only well-established facts (Harrison's Infectious Diseases, Oxford Handbook of Infectious Diseases and Microbiology). If you are not sure of a fact, leave that question out.`,
      `- Mix of difficulty: ${o.mix}.`,
      `- Tag every question using ONLY the ids listed under "Allowed values". Never invent an id; leave a list empty if nothing fits.`,
      ``,
      `Output`,
      `Return ONLY a JSON array, with no text before or after it, in exactly this shape:`,
      `[`,
      `  {`,
      `    "stem": "A 6-year-old after splenectomy presents with...",`,
      `    "options": ["...", "...", "...", "..."],`,
      `    "correct": "B",`,
      `    "explanation": "...",`,
      `    "niche": "extra",`,
      `    "topic": "evasion",`,
      `    "lecture_number": ${lec ? lec.number : 1},`,
      `    "organism_ids": ["streptococcus-pneumoniae"],`,
      `    "disease_ids": [],`,
      `    "tier": "1",`,
      `    "failure_mode": "Capsule / anti-phagocytic",`,
      `    "bloom": "apply",`,
      `    "difficulty": "medium"`,
      `  }`,
      `]`,
      `"correct" is the letter of the right option: A is the first option, B the second, and so on.`,
      ``,
      `Allowed values`,
      `niche (where the pathogen lives): ${list("niche")}`,
      `topic: ${ids("topic")}`,
      `lecture_number: ${S.lectures.map((l) => `${l.number} (${l.title})`).join("; ") || "1"}`,
      `tier: 1 (diagnose and manage independently), 2 (diagnose, start treatment, refer)`,
      `bloom: ${ids("bloom")}`,
      `difficulty: ${ids("difficulty")}`,
      `failure_mode (copy the text exactly): ${ids("failure_mode")}`,
      `organism_ids: ${ids("organism")}`,
      `disease_ids: ${ids("disease") || "(none yet: use [])"}`
    ].filter((x) => x !== null).join("\n");
  }

  function promptDialog(lecture) {
    const n = el("input", { type: "number", min: 1, max: 50, value: 10, style: { width: "100px" } });
    const nOpt = el("select", { style: { width: "auto" } }, [3, 4, 5].map((k) => el("option", { value: k, selected: k === 4 }, k + " options")));
    const lecSel = el("select", null, el("option", { value: "" }, "Any lecture"),
      S.lectures.map((l) => el("option", { value: l.id, selected: lecture && lecture.id === l.id }, `L${l.number} · ${l.title}`)));
    const focus = el("input", { type: "text", placeholder: "Optional, e.g. complement deficiencies and Neisseria" });
    const mix = el("select", null, ["mostly medium, a few easy and hard", "mostly easy (for practice)", "mostly hard (for exams)"].map((m) => el("option", { value: m }, m)));
    const out = el("textarea", { rows: 12, readonly: true, style: { fontFamily: "ui-monospace,Consolas,monospace", fontSize: "12.5px" } });
    let lecFull = lecture || null;
    async function build() {
      if (lecSel.value && (!lecFull || lecFull.id !== lecSel.value)) lecFull = await API.getLecture(lecSel.value).catch(() => S.lectures.find((l) => l.id === lecSel.value));
      if (!lecSel.value) lecFull = null;
      out.value = questionPrompt({ n: Math.max(1, Math.min(50, +n.value || 10)), options: +nOpt.value, lecture: lecFull, focus: focus.value.trim(), mix: mix.value });
    }
    [n, nOpt, lecSel, mix].forEach((x) => x.addEventListener("change", build));
    focus.addEventListener("input", build);
    build();
    modal("AI prompt for new questions", [
      el("ol", { class: "history", style: { listStyle: "decimal", paddingLeft: "20px" } },
        el("li", null, "Choose the settings, then click Copy prompt."),
        el("li", null, "Paste it into any AI chat (ChatGPT, Claude, Gemini…)."),
        el("li", null, "Save the reply as a file called questions.json (Notepad → Save as → All files)."),
        el("li", null, "Questions → Import CSV / JSON → choose the file and tick AI-generated. Everything arrives as drafts: check them, tick the good ones and click Publish.")),
      el("div", { class: "grid2" }, field("How many", n), field("Options per question", nOpt), field("Lecture", lecSel), field("Difficulty", mix)),
      field("Focus", focus),
      out
    ], [
      { label: "Close" },
      { label: "Copy prompt", cls: "primary", onClick: async () => {
        try { await navigator.clipboard.writeText(out.value); toast("Prompt copied. Paste it into your AI chat."); }
        catch (e) { out.select(); toast("Press Ctrl+C to copy the selected prompt.", true); }
      } }
    ]);
  }

  // ------------------------------------------------------------------
  // Questions — editor
  // ------------------------------------------------------------------
  const LETTERS = ["A", "B", "C", "D", "E"];
  function validateLocal(p) {
    const e = [];
    if (!p.stem.trim()) e.push("Stem is required.");
    if (p.options.length < 3 || p.options.length > 5) e.push("A question needs 3 to 5 options.");
    if (p.options.some((o) => !o.text.trim())) e.push("Options cannot be empty.");
    const norm = p.options.map((o) => o.text.trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean);
    if (new Set(norm).size < norm.length) e.push("Options must not repeat.");
    if (!p.correct_option_id) e.push("Mark exactly one option as correct.");
    if (!p.explanation.trim()) e.push("An explanation is required.");
    if (!p.niche) e.push("Tag a niche.");
    if (!p.topic) e.push("Tag a topic.");
    if (!p.lecture_id) e.push("Tag a lecture.");
    return e;
  }

  /* Delete with a clear warning; admins may delete items students already used. */
  async function deleteQuestionFlow(qid) {
    let u = { answers: 0, reviews: 0, exams: 0 };
    try { u = await API.questionUsage(qid); } catch (e) { /* show the plain confirm */ }
    if (+u.exams > 0) { modal("Cannot delete yet", el("p", null, `This question is part of ${u.exams} exam${+u.exams === 1 ? "" : "s"}. Remove it from the exam (or delete the exam) first, or retire the question instead.`)); return false; }
    const used = +u.answers > 0 || +u.reviews > 0;
    if (used && !S.isAdmin) {
      modal("Students have used this question", el("p", null, `It has ${u.answers} answer${+u.answers === 1 ? "" : "s"}. Deleting it would erase those results, so only an admin can do that. Retire it instead: it leaves every student pool and keeps the data.`));
      return false;
    }
    const ok = await confirmBox(used ? "Delete this question and its answers?" : "Delete this question?",
      used ? [el("div", { class: "banner bad" }, `${u.answers} student answer${+u.answers === 1 ? "" : "s"} and their review history will be deleted too. This cannot be undone.`),
              el("p", null, "If you only want students to stop seeing it, choose Retire instead.")]
           : "It is removed for good, with all its versions. A copy stays in the audit log.", "Delete", true);
    if (!ok) return false;
    await guard(() => API.deleteQuestion(qid, used), "Question deleted.");
    return true;
  }

  async function questionEditor(qid) {
    const isNew = qid === "new";
    if (!S.lectures.length) S.lectures = await API.lectureList();
    let data = { item: null, versions: [], keys: [] };
    if (!isNew) data = await API.getQuestion(qid);
    const { item, versions, keys } = data;
    if (!isNew && !item) throw new Error("Question not found, or it is a draft by another instructor.");
    const keyOf = (vid) => keys.find((k) => k.version_id === vid) || {};
    const open = versions.find((v) => v.status === "draft");
    const live = versions.find((v) => v.status === "live");
    const work = open || versions[0] || null;              // the version the form shows
    const wkey = work ? keyOf(work.id) : {};
    const retired = !!(item && item.retired_at);
    const pool = item ? item.pool : "practice";
    const iAmVersionAuthor = work && work.author_id === S.me;
    const willCreateVersion = !isNew && !open && !retired;
    const canEdit = !retired && (S.isAdmin || pool === "practice") &&
      (isNew || willCreateVersion || iAmVersionAuthor || S.isAdmin);

    // ---- form state ----
    const st = {
      stem: work ? work.stem : "",
      options: work ? work.options.map((o) => o.text) : ["", "", "", ""],
      correct: work ? Math.max(0, work.options.findIndex((o) => o.id === wkey.correct_option_id)) : -1,
      explanation: wkey.explanation || ""
    };
    if (work && work.options.findIndex((o) => o.id === wkey.correct_option_id) < 0) st.correct = -1;
    const stem = el("textarea", { rows: 4, disabled: !canEdit, placeholder: "A 24-year-old after splenectomy presents with…" });
    stem.value = st.stem;
    const expl = el("textarea", { rows: 4, disabled: !canEdit, placeholder: "Why the right answer is right, and why the tempting wrong one is wrong." });
    expl.value = st.explanation;
    const sel = (kind, v, blank) => el("select", { disabled: !canEdit }, opts(kind, v, blank));
    const tags = {
      niche: sel("niche", work && work.niche, "Choose"),
      topic: sel("topic", work && work.topic, "Choose"),
      lecture: el("select", { disabled: !canEdit }, el("option", { value: "" }, "Choose"),
        S.lectures.map((l) => el("option", { value: l.id, selected: work && work.lecture_id === l.id }, `L${l.number} · ${l.title}${l.status === "draft" ? " (draft)" : ""}`))),
      tier: sel("tier", work && work.tier), failure_mode: sel("failure_mode", work && work.failure_mode),
      bloom: sel("bloom", work && work.bloom), difficulty: sel("difficulty", work && work.difficulty)
    };
    const poolSel = el("select", { disabled: !canEdit || !S.isAdmin || !isNew }, POOLS.map((p) => el("option", { value: p, selected: p === pool }, p)));
    const orgs = multiPicker("organism", work ? work.organism_ids : [], !canEdit);
    const dis = multiPicker("disease", work ? work.disease_ids : [], !canEdit);
    const optBox = el("div");
    const errBox = el("div");
    const dupBox = el("div");
    let dirty = false;
    dirtyGuard = () => dirty;

    function drawOptions() {
      fill(optBox, st.options.map((text, i) => {
        const radio = el("input", { type: "radio", name: "correct", checked: st.correct === i, disabled: !canEdit, "aria-label": `Option ${LETTERS[i]} is correct` });
        radio.addEventListener("change", () => { st.correct = i; changed(); });
        const inp = el("input", { type: "text", value: text, disabled: !canEdit, placeholder: `Option ${LETTERS[i]}` });
        inp.addEventListener("input", () => { st.options[i] = inp.value; changed(false); });
        const rm = el("button", { class: "btn small", type: "button", title: "Remove option", disabled: !canEdit || st.options.length <= 3 }, "×");
        rm.addEventListener("click", () => {
          st.options.splice(i, 1);
          if (st.correct === i) st.correct = -1; else if (st.correct > i) st.correct--;
          drawOptions(); changed();
        });
        return el("div", { class: "optrow" }, el("span", { class: "letter" }, LETTERS[i]), radio, inp, rm);
      }), el("div", { class: "row" },
        el("button", { class: "btn small", type: "button", disabled: !canEdit || st.options.length >= 5,
          onclick: () => { st.options.push(""); drawOptions(); changed(); } }, "+ Add option"),
        el("span", { class: "hint" }, "3–5 options. Select the radio button next to the one correct answer.")));
    }

    const payload = () => ({
      question_id: isNew ? null : qid,
      stem: stem.value, explanation: expl.value,
      options: st.options.map((t, i) => ({ id: LETTERS[i], text: t })),
      correct_option_id: st.correct >= 0 ? LETTERS[st.correct] : null,
      niche: tags.niche.value, topic: tags.topic.value, lecture_id: tags.lecture.value,
      tier: tags.tier.value, failure_mode: tags.failure_mode.value, bloom: tags.bloom.value, difficulty: tags.difficulty.value,
      organism_ids: orgs.get(), disease_ids: dis.get(),
      ...(S.isAdmin && isNew ? { pool: poolSel.value } : {})
    });
    function showErrors(list) {
      fill(errBox, list.length ? el("div", { class: "banner bad" }, el("b", null, "Fix before saving:"), el("ul", null, list.map((x) => el("li", null, x)))) : null);
    }
    let dupTimer = null;
    function changed(redraw) {
      dirty = true;
      if (saveBtn) saveBtn.disabled = !canEdit;
      if (submitBtn) submitBtn.disabled = true;
      if (errBox.firstChild) showErrors(validateLocal(payload()));
      if (redraw === undefined) { /* no-op */ }
    }
    stem.addEventListener("input", () => {
      changed();
      clearTimeout(dupTimer);
      dupTimer = setTimeout(checkDupes, 600);
    });
    expl.addEventListener("input", () => changed());
    Object.values(tags).forEach((t) => t.addEventListener("change", () => changed()));
    // Picking a lecture fills in its niche, organisms and diseases where they are still empty.
    tags.lecture.addEventListener("change", async () => {
      if (!tags.lecture.value || !canEdit) return;
      const L = await API.getLecture(tags.lecture.value).catch(() => null);
      if (!L) return;
      if (!tags.niche.value && L.niche) tags.niche.value = L.niche;
      if (!orgs.get().length && (L.organism_ids || []).length) orgs.set(L.organism_ids);
      if (!dis.get().length && (L.disease_ids || []).length) dis.set(L.disease_ids);
      changed();
    });
    orgs.onChange = () => changed(); dis.onChange = () => changed();

    async function checkDupes() {
      const s = stem.value.trim();
      if (s.length < 20) { clear(dupBox); return; }
      try {
        const hits = await API.similarStems(s, isNew ? null : qid);
        fill(dupBox, hits.length ? el("div", { class: "banner warn" }, el("b", null, "Possible duplicates:"),
          el("ul", null, hits.map((h) => el("li", null, el("a", { href: "#questions/" + h.question_id }, h.stem.slice(0, 140)),
            ` — ${Math.round(h.score * 100)}% similar, ${STATUS_LABEL[h.status] || h.status}`)))) : null);
      } catch (e) { /* the warning is advisory */ }
    }

    async function save() {
      const p = payload();
      const errs = validateLocal(p);
      showErrors(errs);
      if (errs.length) return null;
      const r = await guard(() => API.saveQuestion(p));
      dirty = false;
      toast(r.new_version && !isNew ? `Saved as version ${r.version} (draft). The live version is unchanged.` : "Saved as draft.");
      return r;
    }

    // ---- actions ----
    let saveBtn = null, submitBtn = null;
    const actions = [];
    if (canEdit) {
      saveBtn = el("button", { class: "btn primary", type: "button", disabled: !isNew },
        willCreateVersion ? `Save as new version (v${(versions[0] ? versions[0].version : 0) + 1})` : "Save draft");
      saveBtn.addEventListener("click", async () => {
        const r = await save();
        if (r) { if (isNew) location.hash = "questions/" + r.question_id; else route(); }
      });
      actions.push(saveBtn);
    }
    const canPublish = work && work.status === "draft" && !retired &&
      (iAmVersionAuthor || (item && item.author_id === S.me) || S.isAdmin) && (pool === "practice" || S.isAdmin);
    if (canPublish) {
      submitBtn = el("button", { class: "btn good", type: "button" }, live ? `Publish v${work.version} (replaces v${live.version})` : "Publish");
      submitBtn.addEventListener("click", async () => {
        if (dirty) { toast("Save your changes first.", true); return; }
        if (item && item.source === "ai" && !(await confirmAiChecked(1))) return;
        await guard(() => API.publishQuestionNow(work.id), pool === "practice" ? "Published — students can answer it now." : "Published to the " + pool + " pool.");
        route();
      });
      actions.push(submitBtn);
    } else if (work && work.status === "draft" && pool !== "practice" && !S.isAdmin) {
      actions.push(el("span", { class: "hint" }, "An admin publishes pre-test and monthly items."));
    }
    const preview = el("button", { class: "btn", type: "button", onclick: () => {
      const p = payload();
      modal("Preview — exactly what a student sees", el("div", { class: "preview-frame" },
        el("div", { class: "preview-tag" }, "Student practice view · answers here are not recorded"),
        renderQuestion({ stem: p.stem, options: p.options }, { preview: { correct_option_id: p.correct_option_id, explanation: p.explanation } })));
    } }, "Preview as student");
    actions.push(preview);
    if (!isNew) {
      actions.push(el("button", { class: "btn", type: "button", onclick: async () => {
        const r = await guard(() => API.duplicateQuestion(qid), "Duplicated as a new draft.");
        location.hash = "questions/" + r.question_id;
      } }, "Duplicate"));
    }
    if (!isNew && !retired && (item.author_id === S.me || S.isAdmin)) {
      actions.push(el("button", { class: "btn danger", type: "button", onclick: async () => {
        const ok = await confirmBox("Retire this item?", "It leaves every student pool. All versions, the answer key and students' past answers are kept.", "Retire", true);
        if (!ok) return;
        await guard(() => API.retireQuestion(qid), "Retired."); route();
      } }, "Retire"));
    }
    if (!isNew && !retired && (item.author_id === S.me || S.isAdmin)) {
      actions.push(el("button", { class: "btn", type: "button", onclick: async () => {
        if (item.hidden_at) { await guard(() => API.setQuestionHidden(qid, false), "Shown again."); route(); return; }
        const u = await API.questionUsage(qid).catch(() => ({ answers: 0, reviews: 0, exams: 0 }));
        if (+u.answers > 0 || +u.reviews > 0) {
          modal("Students have used this question", el("p", null, `It has ${+u.answers} answer${+u.answers === 1 ? "" : "s"} and ${+u.reviews} review${+u.reviews === 1 ? "" : "s"}. Only questions no student has done can be hidden. Retire it instead to take it out of every pool.`));
          return;
        }
        if (+u.exams > 0) { modal("In an exam", el("p", null, "Remove it from the exam first, then hide it.")); return; }
        const ok = await confirmBox("Hide this question?", "It leaves student practice and exam picking. Nothing is deleted, and you can show it again at any time.", "Hide", true);
        if (!ok) return;
        await guard(() => API.setQuestionHidden(qid, true), "Hidden."); route();
      } }, item.hidden_at ? "Show again" : "Hide"));
    }
    if (!isNew && (item.author_id === S.me || S.isAdmin)) {
      actions.push(el("button", { class: "btn danger", type: "button", onclick: async () => {
        if (await deleteQuestionFlow(qid)) location.hash = "questions";
      } }, "Delete"));
    }
    let poolAdmin = null;
    if (!isNew && S.isAdmin && !retired) {
      const ps = el("select", null, POOLS.map((p) => el("option", { value: p, selected: p === pool }, p)));
      ps.addEventListener("change", async () => {
        try { await guard(() => API.setQuestionPool(qid, ps.value), `Moved to the ${ps.value} pool.`); route(); }
        catch (e) { ps.value = pool; }
      });
      poolAdmin = field("Pool (admin)", ps, false, "Pretest and monthly items are never shown in student practice.");
    }

    // ---- banners ----
    const banners = [
      retired ? el("div", { class: "banner bad" }, `Retired ${fmtDay(item.retired_at)}. Out of all student pools; its data is kept.`) : null,
      !retired && item && item.hidden_at ? el("div", { class: "banner info" }, `Hidden since ${fmtDay(item.hidden_at)}: out of student practice and exam picking. Click “Show again” to bring it back.`) : null,
      willCreateVersion && live ? el("div", { class: "banner warn" },
        `Version ${live.version} is live. Saving creates version ${versions[0].version + 1} as a draft; students keep seeing version ${live.version} until you publish the new one. Past answers stay linked to the version each student saw.`) : null,
      !canEdit && !retired && !isNew ? el("div", { class: "banner info" },
        pool !== "practice" ? `This is a ${pool} item; only admins can edit it.` : "Read only — another instructor has an open version of this item.") : null,
      item && item.source === "ai" && work && work.status !== "live" ? el("div", { class: "banner info" }, "AI-generated item — check the facts and the key carefully before publishing.") : null
    ];

    const history = versions.length ? el("div", { class: "panel" }, el("h3", null, "Versions"),
      el("ul", { class: "history" }, versions.map((v) => el("li", null, statusChip(v.status), ` v${v.version} · `, fmtDate(v.updated_at),
        v.live_at ? ` · published ${fmtDay(v.live_at)}` : "")))) : null;

    fill($main,
      backlink("#questions", "Question bank"),
      pagehead(isNew ? "New question" : qCode(qid),
        isNew ? "Save it as a draft, preview it, then publish. Drafts are visible only to you."
              : `Version ${work.version} · ${pool} pool · ${vlabel("topic", work.topic)}`,
        work ? statusChip(work.status) : statusChip("draft")),
      banners,
      el("div", { class: "split" },
        el("div", null,
          el("div", { class: "panel" },
            field("Stem", stem, true), dupBox,
            el("label", { class: "f" }, el("span", null, "Options", el("b", null, " *")), optBox),
            field("Explanation", expl, true, "Shown to students after they answer.")),
          el("div", { class: "panel" }, el("h3", null, "Tags"),
            el("div", { class: "grid2" },
              field("Niche", tags.niche, true), field("Topic", tags.topic, true), field("Lecture", tags.lecture, true),
              field("Tier", tags.tier), field("Failure mode", tags.failure_mode), field("Bloom level", tags.bloom),
              field("Expected difficulty", tags.difficulty),
              isNew ? field("Pool", poolSel, false, S.isAdmin ? "Admins may place items in pretest or monthly." : "New items go to practice. Only admins can choose pretest or monthly.") : null),
            el("div", { class: "grid2" }, field("Organisms", orgs.node), field("Diseases", dis.node))),
          errBox),
        el("div", { class: "sidebar" },
          el("div", { class: "panel" }, el("div", { class: "row" }, actions), poolAdmin),
          history)));
    drawOptions();
  }

  // ------------------------------------------------------------------
  // Import
  // ------------------------------------------------------------------
  const CSV_COLS = ["stem", "option_a", "option_b", "option_c", "option_d", "option_e", "correct", "explanation",
                    "niche", "topic", "lecture_number", "organisms", "diseases", "tier", "failure_mode", "bloom", "difficulty"];
  function csvRowToItem(r) {
    const options = ["a", "b", "c", "d", "e"].map((x) => r["option_" + x] ?? r[x] ?? "").filter((t) => t !== "");
    let correct = (r.correct || r.correct_option_id || "").trim().toUpperCase();
    if (/^[1-5]$/.test(correct)) correct = LETTERS[+correct - 1];
    const list = (s) => (s || "").split(/[;|]/).map((x) => x.trim()).filter(Boolean);
    return {
      stem: r.stem || "", options, correct_option_id: correct, explanation: r.explanation || "",
      niche: r.niche || "", topic: r.topic || "", lecture_number: r.lecture_number || r.lecture || "",
      lecture_id: r.lecture_id || "", organism_ids: list(r.organisms || r.organism_ids), disease_ids: list(r.diseases || r.disease_ids),
      tier: r.tier || "", failure_mode: r.failure_mode || "", bloom: r.bloom || "", difficulty: r.difficulty || "", pool: r.pool || ""
    };
  }
  function jsonToItem(o) {
    const it = { ...o };
    if (!it.correct_option_id && it.correct != null) {
      const c = String(it.correct).toUpperCase();
      it.correct_option_id = /^[1-5]$/.test(c) ? LETTERS[+c - 1] : c;
    }
    if (Array.isArray(it.options)) it.options = it.options.map((x) => (typeof x === "string" ? x : x.text));
    return it;
  }
  function importDialog() {
    const file = el("input", { type: "file", accept: ".csv,.json,application/json,text/csv" });
    const srcHuman = el("input", { type: "radio", name: "src", checked: true });
    const srcAI = el("input", { type: "radio", name: "src" });
    const info = el("div");
    let items = null;
    file.addEventListener("change", async () => {
      clear(info); items = null;
      const f = file.files[0]; if (!f) return;
      try {
        const text = await f.text();
        items = /\.json$/i.test(f.name) || /^\s*[[{]/.test(text)
          ? [].concat(JSON.parse(text)).map(jsonToItem)
          : parseCSV(text).map(csvRowToItem);
        const local = items.map((it) => validateLocal({ ...it, options: (it.options || []).map((t, i) => ({ id: LETTERS[i], text: String(t || "") })),
          lecture_id: it.lecture_id || it.lecture_number, explanation: it.explanation || "", stem: it.stem || "" }));
        const bad = local.filter((e) => e.length).length;
        info.append(el("p", null, `${items.length} item${items.length === 1 ? "" : "s"} read.`,
          bad ? el("span", { class: "bad" }, ` ${bad} look incomplete and will be reported, not saved.`) : null));
      } catch (e) { info.append(el("p", { class: "err" }, "Could not read the file: " + errMsg(e))); }
    });
    const tmplCSV = el("button", { class: "btn small", type: "button", onclick: () => download("question-template.csv", toCSV([{
      stem: "Which component deficiency predisposes to recurrent Neisseria infection?", option_a: "C1 esterase inhibitor", option_b: "C3",
      option_c: "C5–C9 (membrane attack complex)", option_d: "Myeloperoxidase", correct: "C",
      explanation: "Neisseria is killed mainly by MAC lysis, so terminal complement defects cause recurrent infection.",
      niche: "extra", topic: "host-defect", lecture_number: "3", organisms: "neisseria-meningitidis", diseases: "", tier: "1",
      failure_mode: "Host defect / opportunist", bloom: "understand", difficulty: "medium" }], CSV_COLS), "text/csv") }, "CSV template");
    const tmplJSON = el("button", { class: "btn small", type: "button", onclick: () => download("question-template.json", JSON.stringify([{
      stem: "…", options: ["…", "…", "…", "…"], correct: "B", explanation: "…", niche: "extra", topic: "evasion",
      lecture_number: 3, organism_ids: ["streptococcus-pneumoniae"], disease_ids: [], tier: "1", bloom: "apply", difficulty: "medium" }], null, 2), "application/json") }, "JSON template");
    const results = el("div");
    modal("Import questions", [
      el("div", { class: "banner info" }, "Every imported item becomes a draft owned by you; check it and publish it. Status and pool columns in the file are ignored", S.isAdmin ? " (admins: pool is honoured)." : ".",
        " Writing questions with an AI chat? ", el("button", { class: "linkbtn", type: "button", onclick: () => promptDialog() }, "Get the prompt"), "."),
      el("label", { class: "f" }, el("span", null, "File (.csv or .json)"), file),
      el("div", { class: "row" }, el("label", null, srcHuman, " Written by people"), el("label", null, srcAI, " AI-generated (marked so you check it carefully)")),
      el("div", { class: "row", style: { margin: "10px 0" } }, el("span", { class: "dim" }, "Templates:"), tmplCSV, tmplJSON),
      el("p", { class: "hint" }, "CSV columns: " + CSV_COLS.join(", ") + ". Lists use “;”. Use lecture_number or lecture_id; tag ids must match the vocabularies."),
      info, results
    ], [
      { label: "Close", onClick: (c) => { c(); route(); } },
      { label: "Import as drafts", cls: "primary", onClick: async () => {
        if (!items || !items.length) { toast("Choose a file first.", true); return; }
        const res = await guard(() => API.importQuestions(items, srcAI.checked ? "ai" : "import"));
        const ok = res.filter((r) => r.ok).length;
        fill(results, el("div", { class: ok === res.length ? "banner info" : "banner warn" },
          `${ok} of ${res.length} imported as drafts.`,
          res.some((r) => !r.ok) ? el("ul", null, res.filter((r) => !r.ok).map((r) => el("li", null, `Row ${r.index}: ${r.errors}`))) : null));
      } }
    ]);
  }

  // ------------------------------------------------------------------
  // Students
  // ------------------------------------------------------------------
  async function students() {
    const rows = await API.studentSummary(S.cohort, S.days);
    let roleFilter = "student", showNames = true;
    const body = el("tbody");
    const rf = el("select", null, [["student", "Students"], ["instructor", "Instructors"], ["admin", "Admins"], ["", "Everyone"]]
      .map(([v, l]) => el("option", { value: v, selected: v === roleFilter }, l)));
    rf.addEventListener("change", () => { roleFilter = rf.value; draw(); });
    function roleCell(r) {
      if (!S.isAdmin) return r.role;
      const s = el("select", { disabled: r.user_id === S.me, title: r.user_id === S.me ? "You cannot change your own role" : "" },
        ["student", "instructor", "admin"].map((x) => el("option", { value: x, selected: x === r.role }, x)));
      s.addEventListener("change", async () => {
        const ok = await confirmBox("Change role?", `Make ${r.display_name || r.email} ${s.value === "admin" ? "an admin" : s.value === "instructor" ? "an instructor" : "a student"}?`, "Change role");
        if (!ok) { s.value = r.role; return; }
        try { await guard(() => API.setUserRole(r.user_id, s.value), "Role updated."); r.role = s.value; draw(); }
        catch (e) { s.value = r.role; }
      });
      return s;
    }
    function cohortCell(r) {
      const s = el("select", { "aria-label": "Cohort" }, el("option", { value: "" }, "—"),
        S.cohorts.map((c) => el("option", { value: c.id, selected: c.id === r.cohort_id }, c.name)));
      s.addEventListener("change", async () => {
        try { await guard(() => API.setStudentCohort(r.user_id, s.value || null), "Cohort updated."); r.cohort_id = s.value || null; await loadCohorts(); }
        catch (e) { s.value = r.cohort_id || ""; }
      });
      return s;
    }
    function draw() {
      const list = rows.filter((r) => !roleFilter || r.role === roleFilter);
      fill(body, list.length ? list.map((r) => el("tr", null,
        el("td", null, el("div", null, showNames ? (r.display_name || "—") : r.code), el("div", { class: "hint", style: { marginTop: 0 } }, showNames ? r.code : "")),
        el("td", null, showNames ? (r.email || "—") : "hidden"), el("td", null, cohortCell(r)), el("td", null, roleCell(r)),
        el("td", { class: "num" }, String(r.answers || 0)), el("td", { class: "num" }, pct(r.pct_correct)),
        el("td", { class: "num" }, String(r.active_days || 0)), el("td", { class: "num" }, String(r.lectures_viewed || 0)),
        el("td", { class: "mono" }, r.last_active ? fmtDay(r.last_active) : "—"),
        el("td", null, r.research_consent ? "Yes" : "No")))
        : el("tr", null, el("td", { colspan: 10, class: "empty" }, "Nobody here yet.")));
    }
    const namesBtn = el("button", { class: "btn small", type: "button" }, "Hide names");
    namesBtn.addEventListener("click", () => { showNames = !showNames; namesBtn.textContent = showNames ? "Hide names" : "Show names"; if (showNames) API.logNamesShown().catch(() => {}); draw(); });
    const newCohort = el("button", { class: "btn", type: "button", onclick: () => {
      const name = el("input", { type: "text", placeholder: "e.g. 2567" });
      const start = el("input", { type: "text", placeholder: "YYYY-MM-DD (optional)" });
      modal("New cohort", [field("Name", name, true), field("Start date", start)], [
        { label: "Cancel" },
        { label: "Create cohort", cls: "primary", onClick: async (close) => {
          if (!name.value.trim()) { toast("Give the cohort a name.", true); return; }
          if (start.value && !/^\d{4}-\d{2}-\d{2}$/.test(start.value.trim())) { toast("Use YYYY-MM-DD for the date.", true); return; }
          await guard(() => API.saveCohort(name.value.trim(), start.value.trim() || null), "Cohort created.");
          close(); await loadCohorts(); route();
        } }]);
    } }, "New cohort");
    API.logNamesShown().catch(() => {});   // this page shows names by default
    fill($main,
      pagehead("Students", `Activity over ${periodText()}. ${S.isAdmin ? "You can grant roles here; nobody can change their own role." : "Only admins can grant roles."}`,
        scopeControls(), control("Show", rf), newCohort),
      el("div", { class: "panel" }, el("h3", { style: { marginBottom: "4px" } }, "Class codes"),
        el("p", { class: "dim", style: { margin: "0 0 12px" } }, "Share a class code with your students. They type it when they create their account (or later in Settings) and land in the right cohort."),
        S.cohorts.length ? el("div", { class: "tablewrap" }, el("table", null,
          el("thead", null, el("tr", null, ["Cohort", "Class code", "Students", ""].map((h, i) => el("th", { class: i === 2 ? "num" : null }, h)))),
          el("tbody", null, S.cohorts.map((c) => el("tr", null, el("td", null, c.name),
            el("td", { class: "mono", style: { fontSize: "17px", letterSpacing: "2px", fontWeight: 700 } }, c.join_code || "—"),
            el("td", { class: "num" }, String(c.students != null ? c.students : (S.cohortSize[c.id] || 0))),
            el("td", null, el("div", { class: "row", style: { gap: "6px" } },
              el("button", { class: "btn small", type: "button", onclick: async () => {
                try { await navigator.clipboard.writeText(c.join_code); toast("Code copied."); } catch (e) { toast(c.join_code); } } }, "Copy"),
              el("button", { class: "btn small", type: "button", onclick: async () => {
                const ok = await confirmBox("Make a new code?", "The old code stops working. Students already in the class stay in it.", "New code");
                if (!ok) return;
                await guard(() => API.newCohortCode(c.id), "New code made."); await loadCohorts(); route();
              } }, "New code")))))))) : el("p", { class: "dim", style: { margin: 0 } }, "No cohorts yet. Click New cohort above.")),
      el("div", { class: "panel" },
        el("div", { class: "row", style: { justifyContent: "space-between", marginBottom: "8px" } },
          el("span", { class: "dim" }, "Students with a class code are placed automatically. You can still move anyone here."), namesBtn),
        el("div", { class: "tablewrap" }, el("table", null,
          el("thead", null, el("tr", null, ["Student", "Email", "Cohort", "Role", "Answers", "Correct", "Active days", "Lectures", "Last active", "Research"]
            .map((h, i) => el("th", { class: i >= 4 && i <= 7 ? "num" : null }, h)))),
          body))),
      S.isAdmin ? studentCardsPanel() : null);
    draw();
  }

  /* Admins only: every flashcard students wrote for themselves (deleted ones included).
     Students are told in the app that admins can read their cards and that changes are logged. */
  function studentCardsPanel() {
    const box = el("div", { class: "panel" });
    const body = el("tbody");
    const q = el("input", { type: "search", placeholder: "Search card text or student…", "aria-label": "Search student flashcards" });
    const showDeleted = el("input", { type: "checkbox" });
    const countEl = el("span", { class: "dim" });
    let rows = [];
    const draw = () => {
      const t = q.value.trim().toLowerCase();
      const list = rows.filter((r) => (showDeleted.checked || !r.deleted_at) &&
        (!t || [r.front, r.back, r.name, r.code].some((x) => (x || "").toLowerCase().includes(t))));
      countEl.textContent = `${list.length} of ${rows.length} cards`;
      fill(body, list.length ? list.slice(0, 500).map((r) => el("tr", { class: r.deleted_at ? "ishidden" : null },
        el("td", null, el("div", null, r.name || r.code), el("div", { class: "hint", style: { marginTop: 0 } }, [r.code, r.cohort].filter(Boolean).join(" · "))),
        el("td", { style: { whiteSpace: "pre-wrap", maxWidth: "280px" }, translate: "no" }, r.front),
        el("td", { style: { whiteSpace: "pre-wrap", maxWidth: "340px" }, translate: "no" }, r.back),
        el("td", null, [r.topic ? vlabel("topic", r.topic) : null, r.organism_id ? vlabel("organism", r.organism_id) : null].filter(Boolean).join(" · ") || "—"),
        el("td", { class: "num" }, String(r.reviews || 0)),
        el("td", { class: "mono" }, fmtDay(r.created_at)),
        el("td", null, r.deleted_at ? el("span", { class: "status retired" }, "Deleted " + fmtDay(r.deleted_at))
          : r.updated_at && r.updated_at !== r.created_at ? "Edited " + fmtDay(r.updated_at) : "—")))
        : el("tr", null, el("td", { colspan: 7, class: "empty" }, rows.length ? "No cards match." : "No student has written a flashcard yet.")));
    };
    q.addEventListener("input", draw);
    showDeleted.addEventListener("change", draw);
    const csvBtn = el("button", { class: "btn small", type: "button", onclick: () => download(`student-flashcards-${new Date().toISOString().slice(0, 10)}.csv`,
      toCSV(rows.map((r) => ({ code: r.code, name: r.name, cohort: r.cohort, front: r.front, back: r.back, topic: r.topic, organism_id: r.organism_id,
        reviews: r.reviews, created_at: r.created_at, updated_at: r.updated_at, deleted_at: r.deleted_at }))), "text/csv") }, "Download CSV");
    fill(box,
      el("div", { class: "row", style: { justifyContent: "space-between", marginBottom: "4px" } },
        el("h3", { style: { margin: 0 } }, "Students' own flashcards"), el("span", { class: "pill" }, "Admins only")),
      el("p", { class: "dim", style: { margin: "0 0 12px" } }, "Cards students wrote for their own study, in the cohort chosen above. Every create, edit and delete is also in the audit log (Export)."),
      el("div", { class: "searchrow" }, el("div", { style: { flex: "1" } }, q),
        el("label", { class: "row", style: { gap: "6px", flexWrap: "nowrap" } }, showDeleted, "Show deleted"), countEl, csvBtn),
      el("div", { class: "tablewrap" }, el("table", null,
        el("thead", null, el("tr", null, ["Student", "Front", "Back", "Tags", "Reviews", "Written", "Changes"].map((h, i) => el("th", { class: i === 4 ? "num" : null }, h)))),
        body)));
    fill(body, el("tr", null, el("td", { colspan: 7, class: "empty" }, "Loading…")));
    API.studentCardList(S.cohort).then((r) => { rows = r || []; draw(); })
      .catch((e) => fill(body, el("tr", null, el("td", { colspan: 7, class: "empty err" }, errMsg(e)))));
    return box;
  }

  // ------------------------------------------------------------------
  // Items — item analysis
  // ------------------------------------------------------------------
  async function items() {
    const [stats, qs, exams] = await Promise.all([API.itemStats(S.cohort, S.days), API.questionList(), API.examList(S.cohort).catch(() => [])]);
    const pre = exams.find((e) => e.kind === "pretest" && e.submitted > 1);
    const preDetail = pre ? await API.examDetail(pre.id).catch(() => null) : null;
    const byQ = Object.fromEntries(qs.map((q) => [q.question_id, q]));
    const flagOf = (s) => {
      if (s.n < 10) return { t: "Too few answers", rank: 1 };
      if (s.pct_correct <= 30) return { t: "Too hard", rank: 5 };
      if (s.n >= 20 && s.discrimination != null && s.discrimination < 0.2) return { t: "Weak discrimination", rank: 4 };
      if (s.pct_correct >= 90) return { t: "Too easy", rank: 3 };
      if (s.pct_correct < 50 && (s.discrimination || 0) >= 0.3) return { t: "Hard, works well", rank: 0 };
      return { t: "Works well", rank: 0 };
    };
    const wrongNote = (s) => {
      const counts = s.option_counts || {};
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const wrong = Object.entries(counts).filter(([k]) => k !== s.correct_option_id).sort((a, b) => b[1] - a[1]);
      if (!total || !wrong.length || !wrong[0][1]) return "Nobody chose a wrong option";
      if (wrong[1] && wrong[1][1] === wrong[0][1]) return `${wrong[0][0]} and ${wrong[1][0]} split evenly`;
      return `${wrong[0][0]} chosen by ${Math.round(100 * wrong[0][1] / total)}%`;
    };
    const rows = stats.filter((s) => s.n > 0).map((s) => ({ ...s, flag: flagOf(s) }))
      .sort((a, b) => b.flag.rank - a.flag.rank || b.n - a.n);
    const flagged = rows.filter((r) => r.flag.rank >= 3).length;
    const answers = rows.reduce((a, r) => a + r.n, 0);
    const discs = rows.filter((r) => r.n >= 20 && r.discrimination != null).map((r) => +r.discrimination).sort((a, b) => a - b);
    const median = discs.length ? discs[Math.floor(discs.length / 2)] : null;
    const live = qs.filter((q) => q.live_version_id && !q.retired_at).length;

    fill($main,
      pagehead("Item analysis", `Which questions work and which need review. First attempts over ${periodText()}.`, scopeControls()),
      el("div", { class: "cards" },
        stat("Live items", live.toLocaleString(), `of ${qs.length.toLocaleString()} in the bank`, "#questions"),
        stat("Flagged for review", flagged, "Sorted by priority"),
        stat("Pre-test reliability", preDetail && preDetail.kr20 != null ? Number(preDetail.kr20).toFixed(2) : "—",
          preDetail ? `KR-20, ${preDetail.items.length} items` : "Shown once a pre-test has results", pre ? "#exams/" + pre.id : null),
        stat("Median discrimination", median == null ? "—" : median.toFixed(2), `${answers.toLocaleString()} answers analysed`)),
      el("div", { class: "cols" },
        el("div", { class: "panel" }, el("h3", null, "Items to review first"),
          rows.length ? el("div", { class: "tablewrap" }, el("table", null,
            el("thead", null, el("tr", null, ["Item", "Topic", "Correct", "Discrimination", "Flag", "Most chosen wrong option"]
              .map((h, i) => el("th", { class: i === 2 || i === 3 ? "num" : null }, h)))),
            el("tbody", null, rows.map((s) => el("tr", { class: "click", title: s.stem, onclick: () => (location.hash = "questions/" + s.question_id) },
              el("td", { class: "mono" }, qCode(s.question_id), el("div", { class: "hint" }, "v" + s.version + " · n=" + s.n)),
              el("td", null, byQ[s.question_id] ? vlabel("topic", byQ[s.question_id].topic) : "—"),
              el("td", { class: "num" }, pct(s.pct_correct)),
              el("td", { class: "num" }, s.discrimination != null ? Number(s.discrimination).toFixed(2) : "—"),
              el("td", null, el("span", { class: "flag" }, s.flag.t)),
              el("td", { class: "dim", style: { minWidth: "150px" } }, wrongNote(s)))))))
            : el("p", { class: "dim", style: { margin: 0 } }, "No answers yet. Statistics appear once students answer live items."),
          el("p", { class: "foot" }, "Correct = share of students who answered right. Discrimination = how well the item separates strong from weak students; below 0.20 needs review. Open an item to edit, retire or delete it.")),
        el("div", { class: "panel" }, el("h3", null, "Reading the flags"),
          el("ul", { class: "history" },
            el("li", null, el("b", null, "Too hard"), " — 30% or fewer correct. Check the key first."),
            el("li", null, el("b", null, "Weak discrimination"), " — strong students do no better than weak ones. Look for ambiguous options."),
            el("li", null, el("b", null, "Too easy"), " — 90% or more correct. Fine for practice; weak for exams."),
            el("li", null, el("b", null, "Too few answers"), " — under 10 answers; wait before judging.")),
          el("a", { class: "btn", href: "#export", style: { marginTop: "8px" } }, "Export item statistics"))));
  }

  // ------------------------------------------------------------------
  // Exams — pre-test and monthly check-ins
  // ------------------------------------------------------------------
  const KIND = { pretest: "Pre-test", monthly: "Monthly check-in" };
  const toLocalInput = (d) => { if (!d) return ""; const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
  const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

  function examForm(e) {
    const f = {
      kind: el("select", { disabled: e && e.status !== "draft" }, Object.entries(KIND).map(([v, t]) => el("option", { value: v, selected: e ? e.kind === v : v === "monthly" }, t))),
      title: el("input", { type: "text", value: e ? e.title : "" }),
      cohort: el("select", { disabled: e && e.status !== "draft" }, el("option", { value: "" }, "Every student"),
        S.cohorts.map((c) => el("option", { value: c.id, selected: e ? e.cohort_id === c.id : c.id === S.cohort }, c.name))),
      opens: el("input", { type: "datetime-local", value: toLocalInput(e ? e.opens_at : new Date()) }),
      closes: el("input", { type: "datetime-local", value: toLocalInput(e && e.closes_at) }),
      duration: el("input", { type: "number", min: 5, max: 240, value: e ? e.duration_min : 30 })
    };
    const node = el("div", { class: "grid2" }, field("Kind", f.kind, true), field("Title", f.title, true), field("Cohort", f.cohort),
      field("Opens", f.opens, true), field("Closes", f.closes, false, "Leave empty to keep it open until you close it."), field("Minutes allowed", f.duration, true));
    const payload = () => ({ id: e ? e.id : null, kind: f.kind.value, title: f.title.value, cohort_id: f.cohort.value || null,
      opens_at: fromLocalInput(f.opens.value), closes_at: fromLocalInput(f.closes.value), duration_min: f.duration.value });
    return { node, payload };
  }

  async function exams() {
    const list = await API.examList(S.cohort);
    const newBtn = el("button", { class: "btn primary", type: "button", onclick: () => {
      const form = examForm(null);
      modal("New exam", form.node, [{ label: "Cancel" }, { label: "Create", cls: "primary", onClick: async (close) => {
        const p = form.payload();
        if (!p.title.trim()) { toast("Give the exam a title.", true); return; }
        const id = await guard(() => API.saveExam(p), "Exam created as a draft.");
        close(); location.hash = "exams/" + id;
      } }]);
    } }, "New exam");
    fill($main,
      pagehead("Exams", "The pre-test opens the course for each student. Monthly check-ins show how far they have come. Scores never count toward grades.",
        scopeControls(false), newBtn),
      el("div", { class: "panel" }, list.length ? el("div", { class: "tablewrap" }, el("table", null,
        el("thead", null, el("tr", null, ["Exam", "Kind", "Cohort", "Opens", "Closes", "Items", "Submitted", "Average", "Status"]
          .map((h, i) => el("th", { class: i >= 5 && i <= 7 ? "num" : null }, h)))),
        el("tbody", null, list.map((e) => el("tr", { class: "click", onclick: () => (location.hash = "exams/" + e.id) },
          el("td", { translate: "no" }, e.title), el("td", null, KIND[e.kind]), el("td", null, e.cohort || "Everyone"),
          el("td", { class: "mono" }, fmtDay(e.opens_at)), el("td", { class: "mono" }, e.closes_at ? fmtDay(e.closes_at) : "—"),
          el("td", { class: "num" }, String(e.n_items)), el("td", { class: "num" }, `${e.submitted} of ${e.eligible}`),
          el("td", { class: "num" }, pct(e.avg_score)), el("td", null, el("span", { class: "status " + (e.status === "open" ? "live" : e.status === "closed" ? "retired" : "draft") }, e.status)))))))
        : el("div", { class: "empty" }, "No exams yet. Create the pre-test first: students take it right after they sign in.")),
      await schedulePanel(),
      el("div", { class: "panel" }, el("h3", null, "How exams work"),
        el("ul", { class: "history" },
          el("li", null, "Items come from the pre-test or monthly pool. Only admins can place questions in those pools (Question bank → item → Pool)."),
          el("li", null, "When an open pre-test exists for a student's cohort, they record consent and take it before the rest of the app opens."),
          el("li", null, "Students never see pre-test or monthly questions anywhere else, and they see only their score and niche breakdown afterwards."),
          el("li", null, "Opening an exam pins each item to its live version, so later edits do not change a running exam."))));
  }

  async function schedulePanel() {
    const list = await API.scheduleList().catch(() => []);
    const form = (x) => {
      const f = {
        cohort: el("select", { disabled: !!x }, S.cohorts.map((c) => el("option", { value: c.id, selected: x ? x.cohort_id === c.id : c.id === S.cohort }, c.name))),
        title: el("input", { type: "text", value: x ? x.title : "Monthly check-in" }),
        day: el("input", { type: "number", min: 1, max: 28, value: x ? x.day_of_month : 1 }),
        n: el("input", { type: "number", min: 1, max: 200, value: x ? x.n_items : 20 }),
        mins: el("input", { type: "number", min: 5, max: 240, value: x ? x.duration_min : 30 }),
        open: el("input", { type: "number", min: 1, max: 28, value: x ? x.open_days : 7 }),
        active: el("input", { type: "checkbox", checked: x ? x.active : true })
      };
      const node = [el("div", { class: "grid2" }, field("Cohort", f.cohort, true), field("Title", f.title, true),
        field("Day of the month", f.day, true, "1 to 28. It opens at midnight (Bangkok time) that day."), field("Questions", f.n, true, "Picked from the monthly pool, spread across niches."),
        field("Minutes allowed", f.mins, true), field("Days it stays open", f.open, true)),
        el("label", { style: { display: "flex", gap: "8px", alignItems: "center" } }, f.active, "Active")];
      const payload = () => ({ id: x ? x.id : null, cohort_id: f.cohort.value, title: f.title.value, day_of_month: f.day.value,
        n_items: f.n.value, duration_min: f.mins.value, open_days: f.open.value, active: f.active.checked });
      return { node, payload };
    };
    const open = (x) => {
      if (!S.cohorts.length) { toast("Create a cohort first (Students tab).", true); return; }
      const fm = form(x);
      modal(x ? "Edit schedule" : "New monthly schedule", fm.node, [{ label: "Cancel" }, { label: "Save", cls: "primary", onClick: async (close) => {
        await guard(() => API.saveSchedule(fm.payload()), "Schedule saved.");
        await API.runDueSchedules().catch(() => {});
        close(); route();
      } }]);
    };
    return el("div", { class: "panel" },
      el("div", { class: "row", style: { justifyContent: "space-between", marginBottom: "6px" } },
        el("h3", { style: { margin: 0 } }, "Monthly check-in schedule"),
        el("button", { class: "btn small", type: "button", onclick: () => open(null) }, "New schedule")),
      el("p", { class: "dim", style: { margin: "0 0 12px" } }, "Set it once: each month on the chosen day the check-in is created, filled from the monthly pool and opened for the cohort. No clicks needed."),
      list.length ? el("div", { class: "tablewrap" }, el("table", null,
        el("thead", null, el("tr", null, ["Cohort", "Title", "Day", "Questions", "Minutes", "Open for", "Last made", "Status"].map((h) => el("th", null, h)))),
        el("tbody", null, list.map((x) => el("tr", { class: "click", onclick: () => open(x) },
          el("td", null, x.cohort), el("td", null, x.title), el("td", { class: "mono" }, `${x.day_of_month}${["st", "nd", "rd"][((x.day_of_month + 90) % 100 - 10) % 10 - 1] || "th"}`),
          el("td", { class: "num" }, String(x.n_items)), el("td", { class: "num" }, String(x.duration_min)), el("td", null, `${x.open_days} days`),
          el("td", { class: "mono" }, x.last_period || "—"), el("td", null, el("span", { class: "status " + (x.active ? "live" : "retired") }, x.active ? "active" : "paused")))))))
        : el("p", { class: "dim", style: { margin: 0 } }, "No schedule yet."));
  }

  async function examEditor(id) {
    const d = await API.examDetail(id);
    const e = d.exam;
    const draft = e.status === "draft";
    const form = examForm(e);
    const saveBtn = el("button", { class: "btn primary", type: "button", onclick: async () => { await guard(() => API.saveExam(form.payload()), "Saved."); route(); } }, "Save settings");
    const delBtn = el("button", { class: "btn danger", type: "button", onclick: async () => {
      const started = d.attempts.length;
      if (started && !S.isAdmin) {
        modal("Students have started this exam", el("p", null, `${started} student${started === 1 ? " has" : "s have"} started it. Deleting it would erase their results, so only an admin can. You can close it instead.`));
        return;
      }
      const ok = await confirmBox(started ? "Delete this exam and its results?" : "Delete this exam?",
        started ? [el("div", { class: "banner bad" }, `${started} student attempt${started === 1 ? "" : "s"} and scores will be deleted. This cannot be undone.`)]
                : (e.schedule_id ? "It will not be created again this month by the schedule." : "Its questions stay in the question bank."), "Delete", true);
      if (!ok) return;
      await guard(() => API.deleteExam(id, started > 0), "Exam deleted.");
      location.hash = "exams";
    } }, "Delete");
    const statusBtn = e.status === "draft"
      ? el("button", { class: "btn good", type: "button", onclick: async () => {
          const ok = await confirmBox("Open this exam?", `${d.items.length} items. Students in ${e.cohort || "every cohort"} can start it from ${fmtDate(e.opens_at)}. Items are pinned to their current live versions.`, "Open exam");
          if (ok) { await guard(() => API.setExamStatus(id, "open"), "Exam is open."); route(); } } }, "Open exam")
      : e.status === "open"
        ? el("button", { class: "btn danger", type: "button", onclick: async () => {
            const ok = await confirmBox("Close this exam?", "Students who have not started can no longer start. Answers already submitted are kept.", "Close", true);
            if (ok) { await guard(() => API.setExamStatus(id, "closed"), "Closed."); route(); } } }, "Close exam")
        : el("button", { class: "btn", type: "button", onclick: async () => { await guard(() => API.setExamStatus(id, "open"), "Reopened."); route(); } }, "Reopen");

    // items
    const pickN = el("input", { type: "number", min: 1, max: 200, value: Math.min(25, d.pool_live || 25), style: { width: "90px" } });
    const itemTools = draft ? el("div", { class: "row", style: { marginBottom: "14px" } },
      el("span", { class: "dim" }, `${d.pool_live} live item${d.pool_live === 1 ? "" : "s"} in the ${e.kind} pool.`),
      pickN,
      el("button", { class: "btn", type: "button", onclick: async () => { await guard(() => API.pickExamItems(id, +pickN.value), "Items picked, spread across niches."); route(); } }, "Auto-pick"),
      el("button", { class: "btn", type: "button", onclick: () => addItems(e, d) }, "Choose items")) : null;
    const removeItem = async (qid) => { await guard(() => API.setExamItems(id, d.items.filter((x) => x.question_id !== qid).map((x) => x.question_id))); route(); };

    let showNames = false;
    const attBody = el("tbody");
    const drawAtt = () => fill(attBody, d.attempts.length ? d.attempts.map((a) => el("tr", null,
      el("td", { class: "mono" }, showNames ? a.name : a.code), el("td", { class: "mono" }, fmtDay(a.started_at)),
      el("td", { class: "mono" }, a.submitted_at ? fmtDay(a.submitted_at) : "In progress"), el("td", { class: "num" }, pct(a.score))))
      : el("tr", null, el("td", { colspan: 4, class: "empty" }, "No attempts yet.")));
    const namesBtn = el("button", { class: "btn small", type: "button" }, "Show names");
    namesBtn.addEventListener("click", () => { showNames = !showNames; if (showNames) API.logNamesShown().catch(() => {}); namesBtn.textContent = showNames ? "Hide names" : "Show names"; drawAtt(); });
    drawAtt();
    const submitted = d.attempts.filter((a) => a.submitted_at);
    const avg = submitted.length ? submitted.reduce((s, a) => s + +a.score, 0) / submitted.length : null;

    fill($main,
      backlink("#exams", "Exams"),
      pagehead(e.title, `${KIND[e.kind]} · ${e.cohort || "every student"} · ${e.duration_min} minutes`,
        el("span", { class: "status " + (e.status === "open" ? "live" : e.status === "closed" ? "retired" : "draft") }, e.status), statusBtn, delBtn),
      el("div", { class: "cards" },
        stat("Items", d.items.length, draft ? "Edit the list below" : "Pinned to versions"),
        stat("Submitted", submitted.length, `${d.attempts.length - submitted.length} in progress`),
        stat("Average score", pct(avg), submitted.length ? `${submitted.length} student${submitted.length === 1 ? "" : "s"}` : "No results yet"),
        stat(e.kind === "pretest" ? "Pre-test reliability" : "Reliability", d.kr20 != null ? Number(d.kr20).toFixed(2) : "—", "KR-20; 0.7 and above is good")),
      el("div", { class: "cols" },
        el("div", { class: "panel" }, el("h3", null, "Items"), itemTools,
          d.items.length ? el("div", { class: "tablewrap" }, el("table", null,
            el("thead", null, el("tr", null, ["#", "Item", "Topic", "Niche", "Correct", ""].map((h, i) => el("th", { class: i === 4 ? "num" : null }, h)))),
            el("tbody", null, d.items.map((it) => el("tr", null,
              el("td", { class: "mono" }, String(it.position)),
              el("td", { class: "stemcell", translate: "no" }, el("a", { href: "#questions/" + it.question_id }, qCode(it.question_id)), " ", el("span", { class: "dim" }, (it.stem || "").slice(0, 90))),
              el("td", null, vlabel("topic", it.topic)), el("td", null, Render.shortNiche(S.vocab, it.niche)),
              el("td", { class: "num" }, it.n ? pct(it.pct) : "—"),
              el("td", null, draft ? el("button", { class: "btn small", type: "button", onclick: () => removeItem(it.question_id) }, "Remove") : null))))))
            : el("p", { class: "dim", style: { margin: 0 } }, d.pool_live ? "No items yet. Auto-pick or choose them." : `The ${e.kind} pool is empty. An admin needs to move published questions into it first.`)),
        el("div", null,
          el("div", { class: "panel" }, el("h3", null, "Settings"), form.node, saveBtn),
          el("div", { class: "panel" }, el("h3", null, "Attempts"),
            el("div", { class: "tablewrap" }, el("table", null,
              el("thead", null, el("tr", null, ["Student", "Started", "Submitted", "Score"].map((h, i) => el("th", { class: i === 3 ? "num" : null }, h)))), attBody)),
            el("div", { class: "row", style: { marginTop: "12px" } }, namesBtn)))));
  }

  async function addItems(e, d) {
    const qs = (await API.questionList()).filter((q) => q.pool === e.kind && q.live_version_id && !q.retired_at && !q.hidden_at);
    const chosen = new Set(d.items.map((x) => x.question_id));
    const list = el("div", { style: { maxHeight: "50vh", overflow: "auto" } }, qs.length ? qs.map((q) => {
      const cb = el("input", { type: "checkbox", checked: chosen.has(q.question_id) });
      cb.addEventListener("change", () => (cb.checked ? chosen.add(q.question_id) : chosen.delete(q.question_id)));
      return el("label", { style: { display: "flex", gap: "10px", padding: "8px 0", borderBottom: "1px solid var(--line)", cursor: "pointer" } }, cb,
        el("span", null, el("b", { style: { fontWeight: 600 } }, qCode(q.question_id) + " "), (q.stem || "").slice(0, 120),
          el("div", { class: "hint", style: { marginTop: "2px" } }, `${vlabel("topic", q.topic)} · ${Render.shortNiche(S.vocab, q.niche)}`)));
    }) : el("p", { class: "dim" }, `No live items in the ${e.kind} pool.`));
    modal(`Choose ${KIND[e.kind].toLowerCase()} items`, list, [{ label: "Cancel" }, { label: "Use selected", cls: "primary", onClick: async (close) => {
      const keep = d.items.map((x) => x.question_id).filter((q) => chosen.has(q));
      const added = qs.map((q) => q.question_id).filter((q) => chosen.has(q) && !keep.includes(q));
      await guard(() => API.setExamItems(e.id, [...keep, ...added]), "Items updated.");
      close(); route();
    } }]);
  }

  // ------------------------------------------------------------------
  // Export
  // ------------------------------------------------------------------
  async function exportTab() {
    const stamp = () => new Date().toISOString().slice(0, 10);
    const flat = (q) => ({
      stem: q.stem, option_a: q.options[0] && q.options[0].text, option_b: q.options[1] && q.options[1].text,
      option_c: q.options[2] && q.options[2].text, option_d: q.options[3] && q.options[3].text, option_e: q.options[4] && q.options[4].text,
      correct: q.correct_option_id, explanation: q.explanation, niche: q.niche, topic: q.topic, lecture_number: q.lecture_number,
      organisms: q.organism_ids, diseases: q.disease_ids, tier: q.tier, failure_mode: q.failure_mode, bloom: q.bloom,
      difficulty: q.difficulty, pool: q.pool, status: q.status, version: q.version, question_id: q.question_id, source: q.source
    });
    const sets = [
      { id: "questions", label: "Questions with answer keys", hint: "Newest version you can see. CSV uses the import columns, so it can be edited and re-imported as drafts.",
        get: async (fmt) => { const q = await API.exportQuestions();
          return fmt === "json" ? q : { rows: q.map(flat), cols: [...CSV_COLS, "pool", "status", "version", "question_id", "source"] }; } },
      { id: "items", label: "Item statistics", get: async () => ({ rows: await API.itemStats(S.cohort, S.days),
          cols: ["question_id", "version", "stem", "topic", "niche", "n", "pct_correct", "discrimination", "correct_option_id", "option_counts"] }) },
      { id: "research-events", label: "Pseudonymized answer events", hint: "Research use. Only students who agreed; short IDs instead of names.",
        get: async () => ({ rows: (await research()).answers, cols: ["student", "question_id", "version", "topic", "niche", "correct", "confidence", "answered_at"] }) },
      { id: "research-exams", label: "Exam scores with form IDs", hint: "Research use. Only students who agreed.",
        get: async () => ({ rows: (await research()).exams, cols: ["student", "exam_id", "kind", "title", "score", "n_correct", "n_total", "submitted_at"] }) },
      { id: "students", label: "Student summary (includes names)", hint: "Staff only. Not for research files.", get: async () => ({ rows: await API.studentSummary(S.cohort, S.days),
          cols: ["code", "display_name", "email", "role", "cohort", "answers", "pct_correct", "confidently_wrong_pct", "active_days", "lectures_viewed", "last_active", "joined", "research_consent"] }) },
      { id: "audit", label: "Audit log (latest 1,000 changes)", get: async () => ({ rows: await API.auditLog(1000),
          cols: ["created_at", "actor_id", "action", "table_name", "row_id", "old_values", "new_values"] }) }
    ];
    let researchData = null;
    async function research() { if (!researchData) researchData = await API.researchExport(S.cohort); return researchData; }
    const consentLine = el("p", { class: "dim", style: { margin: "0 0 16px" } }, "Checking research consent…");
    research().then((r) => { consentLine.textContent = `${r.consented} of ${r.students} students agreed to research use. Only their data is included in the research files.`; })
      .catch(() => { consentLine.textContent = ""; });
    const checks = Object.fromEntries(sets.map((x) => [x.id, el("input", { type: "checkbox", checked: ["questions", "items"].includes(x.id) })]));
    const fmt = el("select", { style: { width: "auto" } }, el("option", { value: "csv" }, "CSV"), el("option", { value: "json" }, "JSON"));
    const go = el("button", { class: "btn primary", type: "button" }, "Export data");
    go.addEventListener("click", async () => {
      const chosen = sets.filter((x) => checks[x.id].checked);
      if (!chosen.length) { toast("Choose at least one dataset.", true); return; }
      go.disabled = true;
      try {
        for (const x of chosen) {
          const d = await x.get(fmt.value);
          const rows = Array.isArray(d) ? d : d.rows;
          if (fmt.value === "json") download(`${x.id}-${stamp()}.json`, JSON.stringify(rows, null, 2), "application/json");
          else download(`${x.id}-${stamp()}.csv`, toCSV(rows, d.cols), "text/csv");
        }
        toast(`Exported ${chosen.length} file${chosen.length === 1 ? "" : "s"}.`);
      } catch (e) { toast(errMsg(e), true); }
      go.disabled = false;
    });
    fill($main,
      pagehead("Export", `Download questions, results and the audit trail. Results cover ${periodText()}.`, scopeControls()),
      el("div", { class: "cols" },
        el("div", { class: "panel" }, el("h3", null, "Choose what to export"), consentLine,
          sets.map((x) => el("label", { style: { display: "flex", gap: "12px", alignItems: "flex-start", marginBottom: "14px", cursor: "pointer" } },
            checks[x.id], el("span", null, x.label, x.hint ? el("div", { class: "hint", style: { marginTop: "2px" } }, x.hint) : null))),
          el("label", { class: "control", style: { margin: "6px 0 18px" } }, "Format", fmt),
          go),
        el("div", { class: "panel" }, el("h3", null, "Before you share"),
          el("p", { class: "dim", style: { margin: 0 } }, "Question exports include answer keys and explanations, and the student summary includes names and emails. Keep both away from students and outside the course team."))));
  }

  API.onAuth((event) => {
    if (event === "PASSWORD_RECOVERY") { document.body.classList.add("nonav"); Shell.newPasswordScreen($main); return; }
    if (event === "SIGNED_OUT") { location.reload(); return; }
    boot();
  });
  boot();
})();
