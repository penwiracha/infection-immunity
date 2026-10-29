/* ============================================================
   student.js — the signed-in student app (views/app.html)
     Home · Learn · Explore · Practice · Progress
     + first-visit consent and pre-test, monthly check-ins,
       spaced review with flashcards and confidence-rated questions.
   Instructors who open this page are sent to the instructor dashboard
   (add ?preview=1 to see the student view).
   All text goes through Safe.el (textContent), never innerHTML.
   ============================================================ */
;(function () {
  "use strict";
  const { el, fill, fmtDay } = Safe;
  const { renderLecture, renderQuestion, confidencePicker, NICHE_COL, shortNiche, cascadeLabel, label } = Render;
  const { toast, modal, confirmBox, signInScreen, avatarMenu } = Shell;

  const $main = document.getElementById("main");
  const $tabs = document.getElementById("tabs");
  const $streak = document.getElementById("streak");
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const PREVIEW = /[?&]preview=1/.test(location.search);
  const TABS = [["home", "Home"], ["learn", "Learn"], ["explore", "Explore"], ["practice", "Practice"], ["progress", "Progress"]];
  const VIEWS = [["niche-map.html", "Niche map"], ["immune-map.html", "Immune map"], ["cascade.html?b=extracellular", "Where it breaks"],
                 ["taxonomy.html", "Taxonomy"], ["drugs.html", "Antimicrobials"]];
  const S = { me: null, profile: {}, status: null, vocab: {}, lectures: [], lstatus: {}, gate: false, timer: null, session: null,
              practice: { mode: "due", format: "both", topics: null }, learnTab: "lectures", explore: { q: "", niche: null, sel: null, tier: "", fail: "", sys: "", filters: false } };

  const V = (kind, id) => label(S.vocab, kind, id);
  const nicheName = (id) => shortNiche(S.vocab, id);
  const pct = (x) => (x == null ? "—" : `${Math.round(x)}%`);
  const errMsg = (e) => (e && e.message) || String(e);
  const cascadeHref = (step) => (step && /^extracellular:/.test(step) ? "cascade.html?b=extracellular" : "niche-map.html");
  const head = (title, sub, ...right) => el("div", { class: "pagehead" },
    el("div", null, el("h1", null, title), sub ? el("p", { class: "sub" }, sub) : null),
    right.flat().filter(Boolean).length ? el("div", { class: "controls" }, right) : null);
  const stat = (l, n, s, sCls) => el("div", { class: "stat" }, el("div", { class: "l" }, l), el("div", { class: "n" }, String(n)),
    s ? el("div", { class: "s " + (sCls || "") }, s) : null);
  const meter = (value, color) => el("div", { class: "meter", style: { "--c": color || "var(--accent)" } },
    el("span", { style: { width: Math.max(0, Math.min(100, value || 0)) + "%" } }));
  const chips = (pairs) => el("div", { class: "row", style: { gap: "8px" } },
    pairs.map(([href, t]) => el("a", { class: "chip", href }, t)));
  async function guard(fn, okMsg) {
    try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(errMsg(e), true); throw e; }
  }
  const SVGNS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs, ...kids) {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, String(v));
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) n.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }
  // Organism prose in data/ may carry HTML entities; decode them as text, never as markup.
  const decode = (s) => new DOMParser().parseFromString(String(s || ""), "text/html").documentElement.textContent;

  // ------------------------------------------------------------------
  // Boot, header, routing
  // ------------------------------------------------------------------
  async function boot() {
    const sess = await API.session().catch(() => null);
    if (!sess) {
      $tabs.hidden = true;
      signInScreen($main, "Use your university email.", "After you sign in, you will take a short pre-test. The course content opens when you finish.");
      return;
    }
    if (S.me === sess.user.id) return;
    S.me = sess.user.id;
    S.profile = sess.profile || {};
    const staff = S.profile.role === "instructor" || S.profile.role === "admin";
    if (staff && !PREVIEW) { location.replace("instructor.html"); return; }
    avatarMenu(document.getElementById("avatar"), S.profile, sess.user.email,
      [staff ? { label: "Instructor dashboard", href: "instructor.html" } : null, { label: "Revision tool", href: "../index.html" }].filter(Boolean));
    for (const v of await API.vocab()) (S.vocab[v.kind] ||= {})[v.id] = v.label;
    await refreshStatus();
    window.addEventListener("hashchange", route);
    route();
  }

  async function refreshStatus() {
    S.status = await API.myStatus();
    const staff = S.profile.role !== "student";
    const pre = S.status.pretest || { state: "none" };
    S.gate = !staff && (!S.status.consent || pre.state === "todo" || pre.state === "in_progress");
    $streak.textContent = S.status.streak > 0 ? `${S.status.streak}-day streak` : "";
  }

  function setTabs(active) {
    if (S.gate) { $tabs.hidden = true; return; }
    $tabs.hidden = false;
    fill($tabs, TABS.map(([id, name]) => el("a", { class: "tab", href: "#" + id, "aria-selected": String(id === active) }, name)));
  }

  async function route() {
    clearInterval(S.timer); S.timer = null;
    if (!S.gate) $streak.textContent = S.status && S.status.streak > 0 ? `${S.status.streak}-day streak` : "";
    const [tab, a, b] = location.hash.slice(1).split("/");
    try {
      if (S.gate && tab !== "exam") return await gate();
      if (tab === "exam" && UUID.test(a || "")) { setTabs(null); return await runExam(a); }
      const t = TABS.some(([id]) => id === tab) ? tab : "home";
      setTabs(t);
      if (t === "home") await home();
      else if (t === "learn") await learn(a, b);
      else if (t === "explore") explore();
      else if (t === "practice") a === "session" ? await sessionView() : await practice();
      else if (t === "progress") await progress();
      window.scrollTo(0, 0);
    } catch (e) {
      fill($main, el("div", { class: "banner bad" }, errMsg(e)));
    }
  }

  // ------------------------------------------------------------------
  // First visit: consent, then the pre-test (if one is open), then unlock
  // ------------------------------------------------------------------
  const steps = (on) => el("div", { class: "steps" },
    ["1 Consent", "2 Pre-test", "3 Unlock"].map((t, i) => el("span", { class: i === on ? "on" : null }, t)));

  function infoSheet() {
    modal("Information sheet", [
      el("p", null, "This platform records your study activity: which lectures you open, the questions you answer, how sure you said you were, and your flashcard ratings. It uses this to choose what you review next and to show your progress."),
      el("p", null, "Your instructors can see your activity and scores to support you. Lists shown on screen use short IDs instead of names."),
      el("p", null, "Research use is separate and optional. If you agree, your answers can be included in a medical-education study with your name and email removed. Saying no does not change your access or your grades. You can change your choice later by asking your course admin."),
      el("p", { class: "dim" }, "Pre-test and check-in scores do not count toward your grade.")
    ]);
  }

  async function gate() {
    const st = S.status, pre = st.pretest || { state: "none" };
    if (st.consent && pre.state === "in_progress") { location.hash = "exam/" + pre.exam_id; return; }
    const hasPre = pre.state === "todo" || pre.state === "in_progress";
    const platform = el("input", { type: "checkbox", checked: !!st.consent });
    const research = el("input", { type: "checkbox", checked: !!(st.consent && st.consent.research) });
    const go = el("button", { class: "btn primary", type: "button", disabled: !st.consent }, hasPre ? "Start pre-test" : "Continue");
    platform.addEventListener("change", () => { go.disabled = !platform.checked; });
    go.addEventListener("click", async () => {
      go.disabled = true;
      try {
        if (!st.consent || research.checked !== !!(st.consent && st.consent.research)) await API.setConsent(true, research.checked);
        await refreshStatus();
        if (hasPre) location.hash = "exam/" + pre.exam_id;
        else { location.hash = "home"; route(); }
      } catch (e) { toast(errMsg(e), true); go.disabled = false; }
    });
    fill($main, el("div", { class: "narrow" }, hasPre ? steps(0) : null,
      el("div", { class: "panel" },
        el("h2", { style: { margin: "0 0 6px", fontSize: "26px" } }, "Before you start"),
        el("p", { class: "sub", style: { color: "var(--ink2)" } }, hasPre ? "A short diagnostic so the platform knows where to begin." : "Two quick choices before you begin."),
        hasPre ? el("ul", { class: "bullets" },
          el("li", null, `${pre.n_items} question${pre.n_items === 1 ? "" : "s"}, about ${pre.duration_min} minutes.`),
          el("li", null, "It is low-stakes: your score does not count toward your grade."),
          el("li", null, "You can flag a question and come back to it before you submit.")) : null,
        el("label", { class: "consentbox" }, platform, el("span", null,
          "I agree to use the platform and have my study activity recorded to personalize my practice.",
          el("small", null, "Required to continue."))),
        el("label", { class: "consentbox" }, research, el("span", null,
          "I agree that my anonymized results may be used in a medical education research study.",
          el("small", null, "Optional. Saying no does not change your access or your grades."))),
        el("div", { class: "row", style: { marginTop: "18px" } }, go,
          el("button", { class: "linkbtn", type: "button", onclick: infoSheet }, "Read the full information sheet")))));
  }

  // ------------------------------------------------------------------
  // Exam runner (pre-test and monthly check-in)
  // ------------------------------------------------------------------
  async function runExam(examId) {
    const data = await API.startExam(examId);
    const items = data.items || [];
    const resp = {};
    for (const r of data.responses || []) resp[r.position] = { option: r.option, confidence: r.confidence, flagged: r.flagged };
    let cur = (items.find((i) => !(resp[i.position] && resp[i.position].option)) || items[0] || {}).position || 1;
    const started = new Date(data.started_at).getTime();
    const deadline = new Date(data.deadline).getTime();
    const kindLabel = data.kind === "pretest" ? "Pre-test" : "Check-in";
    let submitting = false;

    const tick = () => {
      const used = Math.max(0, Math.floor((Date.now() - started) / 1000));
      const mm = String(Math.floor(used / 60)).padStart(2, "0"), ss = String(used % 60).padStart(2, "0");
      $streak.textContent = `Time used ${mm}:${ss} · Progress is saved`;
      if (Date.now() > deadline && !submitting) { toast("Time is up — submitting your answers."); submit(); }
    };
    tick(); S.timer = setInterval(tick, 1000);

    const left = el("div", { class: "panel" });
    const grid = el("div", { class: "qgrid", role: "group", "aria-label": "Questions" });
    const right = el("div", { class: "panel" }, el("h3", null, "Questions"), grid,
      el("p", { class: "hint", style: { marginBottom: "16px" } }, "Purple outline: answered. Dashed amber: flagged. Filled: current."),
      el("button", { class: "btn", type: "button", onclick: () => review() }, "Review and submit"));

    async function save(pos) {
      const r = resp[pos] || {};
      try { await API.saveExamResponse(data.attempt_id, pos, r.option, r.confidence, r.flagged); }
      catch (e) { toast(errMsg(e), true); }
    }
    function drawGrid() {
      fill(grid, items.map((it) => {
        const r = resp[it.position] || {};
        const cls = [r.option ? "answered" : "", r.flagged ? "flagged" : "", it.position === cur ? "current" : ""].join(" ");
        return el("button", { type: "button", class: cls, "aria-label": `Question ${it.position}${r.flagged ? ", flagged" : ""}${r.option ? ", answered" : ""}`,
          onclick: () => { cur = it.position; draw(); } }, String(it.position));
      }));
    }
    function draw() {
      const it = items.find((x) => x.position === cur);
      const r = (resp[cur] ||= {});
      const name = "ex" + cur;
      const opts = el("div", { class: "options", role: "radiogroup" }, (it.options || []).map((o) => {
        const input = el("input", { type: "radio", name, value: o.id, checked: r.option === o.id });
        const row = el("label", { class: "opt" + (r.option === o.id ? " chosen" : ""), dataset: { opt: o.id } }, input, el("span", { class: "opttext" }, o.text));
        input.addEventListener("change", () => { r.option = o.id; opts.querySelectorAll(".opt").forEach((x) => x.classList.toggle("chosen", x === row)); drawGrid(); save(cur); });
        return row;
      }));
      const idx = items.indexOf(it);
      const flagBtn = el("button", { class: "btn", type: "button", "aria-pressed": String(!!r.flagged) }, r.flagged ? "Unflag" : "Flag for later");
      flagBtn.addEventListener("click", () => { r.flagged = !r.flagged; save(cur); draw(); });
      const last = idx === items.length - 1;
      fill(left,
        el("div", { class: "qhead" }, el("span", null, `${kindLabel} · Question ${cur} of ${items.length}`), el("span", null, data.title)),
        el("div", { class: "progress" }, el("span", { style: { width: Math.round(100 * (idx + 1) / items.length) + "%" } })),
        el("p", { class: "stem" }, it.stem),
        opts,
        confidencePicker((c) => { r.confidence = c; save(cur); }, r.confidence),
        el("div", { class: "examnav" },
          el("button", { class: "btn", type: "button", disabled: idx === 0, onclick: () => { cur = items[idx - 1].position; draw(); } }, "Previous"),
          flagBtn,
          el("button", { class: "btn primary", type: "button", onclick: () => { if (last) review(); else { cur = items[idx + 1].position; draw(); } } },
            last ? "Review and submit" : "Next")));
      drawGrid();
    }
    async function review() {
      const unanswered = items.filter((i) => !(resp[i.position] && resp[i.position].option)).map((i) => i.position);
      const flagged = items.filter((i) => resp[i.position] && resp[i.position].flagged).map((i) => i.position);
      const ok = await confirmBox("Submit your answers?", [
        el("p", null, `You have answered ${items.length - unanswered.length} of ${items.length} questions.`),
        unanswered.length ? el("p", { class: "dim" }, `Unanswered: ${unanswered.join(", ")}. They will count as wrong.`) : null,
        flagged.length ? el("p", { class: "dim" }, `Flagged for later: ${flagged.join(", ")}.`) : null,
        el("p", { class: "dim" }, "You cannot change your answers after submitting.")
      ], "Submit");
      if (ok) submit();
    }
    async function submit() {
      if (submitting) return;
      submitting = true; clearInterval(S.timer); S.timer = null;
      let res;
      try { res = await API.submitExam(data.attempt_id); }
      catch (e) { submitting = false; toast(errMsg(e), true); return; }
      await refreshStatus();
      showResult(res);
    }
    if (!items.length) { fill($main, el("div", { class: "panel" }, "This exam has no questions yet.")); return; }
    fill($main, data.kind === "pretest" ? el("div", { style: { maxWidth: "1120px", margin: "0 auto" } }, el("div", { class: "cols" }, left, right))
                                        : el("div", null, head(data.title, `${items.length} questions · ${data.duration_min} minutes · progress is saved as you go`),
                                                         el("div", { class: "cols" }, left, right)));
    draw();
  }

  function nicheBars(byNiche, lowLabel) {
    const list = (byNiche || []).slice().sort((a, b) => b.pct - a.pct);
    return list.map((x, i) => el("div", null,
      el("div", { class: "bar3" }, el("span", null, nicheName(x.niche)),
        el("span", null, `${pct(x.pct)}${list.length > 1 && i === 0 ? ", strongest" : list.length > 1 && i === list.length - 1 ? ", " + (lowLabel || "weakest") : ""}`)),
      meter(x.pct, NICHE_COL[x.niche])));
  }

  async function showResult(res) {
    setTabs("home");
    $streak.textContent = S.status.streak > 0 ? `${S.status.streak}-day streak` : "";
    const exams = await API.myExams().catch(() => []);
    const next = exams.find((e) => e.kind === "monthly" && !e.submitted_at && new Date(e.opens_at) > new Date());
    const pre = res.kind === "pretest";
    fill($main, el("div", { class: "narrow" }, pre ? steps(2) : null,
      el("div", { class: "panel accent" },
        el("h2", { style: { margin: "0 0 6px", fontSize: "26px" } }, pre ? "Pre-test complete" : "Check-in complete"),
        el("p", { style: { color: "var(--ink2)", margin: 0 } }, pre ? "Your starting point. This is a baseline, not a grade." : "Compare it with your pre-test on the Progress page."),
        el("div", { class: "bignum" }, pct(res.score)),
        el("p", { class: "hint", style: { marginTop: 0 } }, `${res.n_correct} of ${res.n_total} correct.`),
        nicheBars(res.by_niche, pre ? "start here" : "weakest"),
        pre ? [el("p", { class: "label", style: { marginTop: "20px" } }, "Now open"),
               chips(TABS.map(([id, t]) => ["#" + id, t]))] : null,
        el("div", { class: "row", style: { marginTop: "20px" } },
          el("a", { class: "btn primary", href: pre ? "#home" : "#progress" }, pre ? "Open my home page" : "See my progress")),
        next ? el("p", { class: "hint" }, `Your next monthly check-in opens ${fmtDay(next.opens_at)}.`) : null)));
  }

  // ------------------------------------------------------------------
  // Home
  // ------------------------------------------------------------------
  async function home() {
    const [p, exams] = await Promise.all([API.myProgress(30), API.myExams().catch(() => [])]);
    const st = S.status;
    const due = (st.cards_due || 0) + Math.min(st.new_cards || 0, 20);
    const topics = (p.by_topic || []).filter((t) => t.n >= 3);
    const weakest = topics[0];
    const first = (S.profile.display_name || "").split(/\s+/)[0];

    let next;
    if (weakest && weakest.pct < 80) {
      const r = p.recent || {};
      next = el("div", { class: "panel accent" },
        el("div", { class: "eyebrow" }, "Study this next"),
        el("h2", { style: { margin: "0 0 8px", fontSize: "21px" } }, `${V("topic", weakest.topic)} · ${nicheName(weakest.niche)}`),
        el("p", { style: { color: "var(--ink2)", margin: 0 } },
          r.n ? `You missed ${r.wrong} of your last ${r.n} questions on this topic.` : `You are at ${pct(weakest.pct)} on this topic.`),
        el("div", { class: "row", style: { marginTop: "18px" } },
          el("button", { class: "btn primary", type: "button", onclick: () => startSession({ mode: "topics", topics: [weakest.topic], format: "both", title: V("topic", weakest.topic) }) }, "Start 15-minute session"),
          el("a", { class: "btn", href: cascadeHref(weakest.cascade_step) }, weakest.cascade_step ? "Open the cascade" : "Open the niche map")),
        p.last_lecture ? [el("hr", { class: "rule", style: { border: "none", borderTop: "1px solid var(--line)", margin: "20px 0 14px" } }),
          el("p", { style: { margin: 0, color: "var(--ink2)" } }, "Continue where you left off: ",
            el("a", { href: "#learn/" + p.last_lecture.id }, `Lecture ${p.last_lecture.number}, ${p.last_lecture.title}`))] : null);
    } else {
      next = el("div", { class: "panel accent" },
        el("div", { class: "eyebrow" }, "Study this next"),
        el("h2", { style: { margin: "0 0 8px", fontSize: "21px" } }, due ? `Today's review: ${due} card${due === 1 ? "" : "s"}` : "Start with a lecture"),
        el("p", { style: { color: "var(--ink2)", margin: 0 } }, due ? "Spaced review brings back each card just before you would forget it." : "Read a lecture summary, then practise its questions."),
        el("div", { class: "row", style: { marginTop: "18px" } },
          due ? el("button", { class: "btn primary", type: "button", onclick: () => startSession({ mode: "due", format: "both" }) }, "Start session")
              : el("a", { class: "btn primary", href: "#learn" }, "Open Learn"),
          el("a", { class: "btn", href: "cascade.html?b=extracellular" }, "Open the cascade")),
        p.last_lecture ? el("p", { style: { margin: "16px 0 0", color: "var(--ink2)" } }, "Continue where you left off: ",
          el("a", { href: "#learn/" + p.last_lecture.id }, `Lecture ${p.last_lecture.number}, ${p.last_lecture.title}`)) : null);
    }

    const weak = el("div", { class: "panel" }, el("h3", null, "Weak spots"),
      topics.length ? [topics.slice(0, 3).map((t) => el("div", { style: { marginBottom: "10px" } },
          el("div", { class: "bar3", style: { marginTop: 0 } }, el("span", null, V("topic", t.topic)), el("span", null, pct(t.pct))),
          meter(t.pct, NICHE_COL[t.niche]), el("div", { class: "hint", style: { marginTop: "4px" } }, nicheName(t.niche)))),
        el("p", { class: "foot" }, "Your accuracy over the last 30 days. Colours match the niche map.")]
        : el("p", { class: "dim", style: { margin: 0 } }, "Answer a few questions and your weakest topics will show up here."));

    const monthly = exams.filter((e) => e.kind === "monthly");
    const openNow = monthly.find((e) => !e.submitted_at && e.status === "open" && new Date(e.opens_at) <= new Date() && (!e.closes_at || new Date(e.closes_at) > new Date()));
    const upcoming = monthly.find((e) => !e.submitted_at && new Date(e.opens_at) > new Date());
    const lastDone = monthly.filter((e) => e.submitted_at).pop();
    const days = (d) => Math.max(1, Math.ceil((new Date(d) - Date.now()) / 864e5));
    const check = el("div", { class: "panel" }, el("h3", null, "Monthly check-in"),
      openNow ? [el("p", { class: "muted", style: { margin: "0 0 14px", color: "var(--ink2)" } },
                    `Open now${openNow.closes_at ? " until " + fmtDay(openNow.closes_at) : ""}. A ${openNow.duration_min}-minute practice exam to see how far you have come.`),
                 el("a", { class: "btn primary", href: "#exam/" + openNow.exam_id }, openNow.attempt_id ? "Continue check-in" : "Start check-in")]
      : upcoming ? el("p", { style: { margin: 0, color: "var(--ink2)" } }, `Opens in ${days(upcoming.opens_at)} day${days(upcoming.opens_at) === 1 ? "" : "s"}. A ${upcoming.duration_min}-minute practice exam to see how far you have come.`)
      : lastDone ? el("p", { style: { margin: 0, color: "var(--ink2)" } }, `Last check-in: ${pct(lastDone.score)}. The next one has not been scheduled yet.`)
      : el("p", { style: { margin: 0, color: "var(--ink2)" } }, "A short practice exam each month to see how far you have come. Your instructors will open the first one."));

    fill($main,
      head(first ? `Welcome back, ${first}` : "Welcome back", "One thing to do today, then explore as you like."),
      el("div", { class: "cols" },
        el("div", null, next, weak),
        el("div", null,
          el("div", { class: "panel" }, el("div", { class: "statrow" },
            el("div", null, el("b", null, String(due)), el("span", null, "Cards due")),
            el("div", null, el("b", null, String(S.status.streak || 0)), el("span", null, "Day streak")),
            el("div", null, el("b", null, pct(p.avg)), el("span", null, "Average")))),
          el("div", { class: "panel" }, el("h3", { style: { marginBottom: "4px" } }, "Explore"),
            el("p", { style: { margin: "0 0 14px", color: "var(--ink2)" } }, "Five ways to see the same organisms."),
            chips(VIEWS)),
          check)));
  }

  // ------------------------------------------------------------------
  // Learn
  // ------------------------------------------------------------------
  async function learn(id, mode) {
    const [lecs, ls] = await Promise.all([API.publishedLectures(), API.myLectureStatus().catch(() => [])]);
    S.lectures = lecs; S.lstatus = Object.fromEntries((ls || []).map((r) => [r.lecture_id, r]));
    const lec = UUID.test(id || "") ? lecs.find((l) => l.id === id) : null;
    if (lec && mode === "practice") return lecturePractice(lec);
    const statusOf = (l) => { const r = S.lstatus[l.id]; return r && r.completed ? "Done" : r && r.viewed ? "In progress" : "Not started"; };
    const seg = el("div", { class: "row", style: { gap: "8px", marginBottom: "18px" } },
      [["lectures", "Lectures"], ["diseases", "Diseases"]].map(([k, t]) => el("button", { class: "btn chipbtn", type: "button", "aria-pressed": String(S.learnTab === k),
        onclick: () => { S.learnTab = k; learn(id, mode); } }, t)));
    const headEl = head("Learn", "Lecture summaries and disease pages, linked to the maps.");

    if (S.learnTab === "diseases") {
      const map = {};
      for (const l of lecs) for (const d of l.disease_ids || []) (map[d] ||= []).push(l);
      const ids = Object.keys(map).sort((a, b) => V("disease", a).localeCompare(V("disease", b)));
      fill($main, headEl, seg, el("div", { class: "panel" }, el("h3", null, "Diseases in published lectures"),
        ids.length ? el("div", { class: "diseasecards" }, ids.map((d) => el("div", null, el("b", null, V("disease", d)),
          map[d].map((l) => el("a", { href: "#learn/" + l.id, style: { display: "block" } }, `Lecture ${l.number}: ${l.title}`)))))
          : el("p", { class: "dim", style: { margin: 0 } }, "No lecture has linked diseases yet.")));
      return;
    }

    const current = lec || lecs.find((l) => statusOf(l) === "In progress") || lecs[0];
    const list = el("div", { class: "panel" }, el("h3", null, "Lectures"),
      lecs.length ? el("nav", { class: "lecturelist", "aria-label": "Lectures" }, lecs.map((l) =>
        el("a", { class: "lecitem", href: "#learn/" + l.id, "aria-current": String(!!current && l.id === current.id) },
          el("span", null, `${l.number} ${l.title}`), el("span", { class: "st" }, statusOf(l)))))
        : el("p", { class: "dim", style: { margin: 0 } }, "No lectures have been published yet."));
    let detail = el("div", { class: "panel" }, el("p", { class: "dim", style: { margin: 0 } }, "Lectures appear here when your instructors publish them."));
    if (UUID.test(id || "") && !lec) detail = el("div", { class: "panel" }, el("p", { style: { margin: 0 } }, "This lecture is not available."));
    else if (current) {
      API.logLectureView(current.id).catch(() => {});
      const qs = await API.practiceQuestions(current.id);
      const done = statusOf(current) === "Done";
      const readBtn = el("button", { class: "btn", type: "button", disabled: done }, done ? "Read" : "Mark as read");
      readBtn.addEventListener("click", async () => { await guard(() => API.markLectureRead(current.id), "Marked as read."); learn(current.id); });
      detail = el("div", null,
        el("div", { class: "panel accent", style: { "--c": "var(--accent)" } },
          renderLecture(current, S.vocab, { actions: [
            qs.length ? el("a", { class: "btn primary", href: `#learn/${current.id}/practice` }, "Practice this lecture")
                      : el("button", { class: "btn primary", type: "button", disabled: true }, "No practice questions yet"),
            readBtn] })),
        (current.disease_ids || []).length ? el("div", { class: "panel" }, el("h3", null, "Diseases in this lecture"),
          el("div", { class: "diseasecards" }, current.disease_ids.map((d) => el("div", null, el("b", null, V("disease", d)),
            el("span", { class: "dim" }, (current.organism_ids || []).map((o) => V("organism", o)).join(", ") || "—"))))) : null);
    }
    fill($main, headEl, seg, el("div", { class: "learn-grid" }, list, detail));
  }

  async function lecturePractice(lec) {
    const qs = await API.practiceQuestions(lec.id);
    let i = 0, right = 0;
    const box = el("div", { class: "panel" });
    function show() {
      if (i >= qs.length) {
        fill(box, el("div", { class: "eyebrow" }, "Session complete"),
          el("h2", { style: { margin: "0 0 8px" } }, `${right} of ${qs.length} correct`),
          el("p", { class: "dim" }, "Missed questions come back in your spaced review."),
          el("div", { class: "row", style: { marginTop: "18px" } },
            el("button", { class: "btn primary", type: "button", onclick: () => { i = 0; right = 0; show(); } }, "Practice again"),
            el("a", { class: "btn", href: "#learn/" + lec.id }, "Back to the lecture")));
        return;
      }
      const v = qs[i];
      fill(box, renderQuestion(v, {
        confidence: true,
        meta: { left: nicheName(v.niche || lec.niche), right: `Question ${i + 1} of ${qs.length}`, progress: (i + 1) / qs.length },
        onAnswer: async (opt, conf) => { const r = await API.submitAnswer(v.id, opt, conf); if (r.correct) right++; return r; },
        onNext: () => { i++; show(); }, nextLabel: i + 1 < qs.length ? "Next question" : "See results"
      }));
    }
    fill($main, el("a", { class: "backlink", href: "#learn/" + lec.id }, `← Lecture ${lec.number}: ${lec.title}`),
      head(`Practice · Lecture ${lec.number}`, `${qs.length} question${qs.length === 1 ? "" : "s"}`),
      el("div", { class: "cols" }, qs.length ? box : el("div", { class: "panel" }, "No practice questions for this lecture yet."), whyWeAsk()));
    if (qs.length) show();
  }
  const whyWeAsk = () => el("div", { class: "panel" }, el("h3", null, "Why we ask"),
    el("p", { style: { margin: 0, color: "var(--ink2)" } }, "Questions are scored. Your confidence tap helps find topics you feel sure about but get wrong, which are the most useful ones to review."));

  // ------------------------------------------------------------------
  // Explore (reads the static data layer: data/organisms.js)
  // ------------------------------------------------------------------
  function explore() {
    const E = S.explore;
    const ORGS = (window.ORGANISMS || []).filter((o) => !o.reference);
    const ENUMS = window.ENUMS || { niches: [], failureModes: [], systems: [] };
    const search = el("input", { type: "search", placeholder: "e.g. pneumoniae", value: E.q, "aria-label": "Search organisms" });
    const body = el("div");
    const filt = (key, labelText, options) => {
      const s = el("select", { style: { width: "auto" } }, el("option", { value: "" }, "Any " + labelText.toLowerCase()),
        options.map(([v, t]) => el("option", { value: v, selected: String(E[key]) === String(v) }, t)));
      s.addEventListener("change", () => { E[key] = s.value; draw(); });
      return el("label", { class: "control" }, labelText, s);
    };
    const filters = el("div", { class: "row", style: { margin: "0 0 18px", alignItems: "flex-end" }, hidden: !E.filters },
      filt("tier", "Tier", [[1, "Tier 1"], [2, "Tier 2"]]),
      filt("fail", "Failure mode", ENUMS.failureModes.map((f) => [f, f])),
      filt("sys", "System", ENUMS.systems.map((s) => [s, s])));
    const filterBtn = el("button", { class: "btn", type: "button", "aria-expanded": String(E.filters) }, "Filters: tier, failure mode, system");
    filterBtn.addEventListener("click", () => { E.filters = !E.filters; filters.hidden = !E.filters; filterBtn.setAttribute("aria-expanded", String(E.filters)); });
    search.addEventListener("input", () => { E.q = search.value; draw(); });

    const subtitle = (o) => {
      const t = o.taxonomy || {};
      const kind = o.kingdom === "bacteria" && t.gram ? `Gram-${t.gram}${t.morphology ? " " + t.morphology.split(/[;/,(]/)[0].trim() : ""}`
        : o.kingdom ? o.kingdom.charAt(0).toUpperCase() + o.kingdom.slice(1) : "";
      return [(o.niche || []).map((n) => nicheName(n)).join(", "), kind].filter(Boolean).join(" · ");
    };
    function orgPanel(o) {
      if (!o) return el("div", { class: "panel" }, el("div", { class: "eyebrow" }, "Selected organism"),
        el("p", { class: "dim", style: { margin: 0 } }, "Pick an organism to see how the immune system responds and why it fails."));
      const p = o.panels || {};
      const n0 = (o.niche || [])[0];
      return el("div", { class: "panel accent orgpanel", style: { "--c": NICHE_COL[n0] || "var(--accent)" } },
        el("div", { class: "eyebrow" }, "Selected organism"),
        el("h2", { style: { margin: "0 0 2px", fontSize: "21px" } }, o.name),
        el("div", { class: "hint", style: { marginTop: 0 } }, subtitle(o)),
        p.resp ? [el("span", { class: "k" }, "Immune response"), el("p", null, decode(p.resp))] : null,
        p.evade ? [el("span", { class: "k" }, "Why it fails"), el("p", null, decode(p.evade))] : null,
        p.dis ? [el("span", { class: "k" }, "Disease"), el("p", null, decode(p.dis))] : null,
        el("div", { class: "row", style: { marginTop: "16px", gap: "8px" } },
          el("a", { class: "chip", href: "immune-map.html" }, "See it on the immune map"),
          el("a", { class: "chip", href: (o.niche || []).includes("extra") ? "cascade.html?b=extracellular" : "niche-map.html" },
            (o.niche || []).includes("extra") ? "See where it breaks" : "See it on the niche map")));
    }
    function draw() {
      const q = E.q.trim().toLowerCase();
      const match = (o) => (!q || o.name.toLowerCase().includes(q) || o.id.includes(q)) &&
        (!E.tier || String(o.tier) === String(E.tier)) && (!E.fail || o.fail === E.fail) && (!E.sys || (o.sys || []).includes(E.sys)) &&
        (!E.niche || (o.niche || []).includes(E.niche));
      const sel = ORGS.find((o) => o.id === E.sel);
      const filtering = q || E.tier || E.fail || E.sys || E.niche;
      let leftSide;
      if (filtering) {
        const hits = ORGS.filter(match).sort((a, b) => a.name.localeCompare(b.name));
        leftSide = el("div", { class: "panel" },
          el("div", { class: "row", style: { justifyContent: "space-between", marginBottom: "6px" } },
            el("h3", { style: { margin: 0 } }, E.niche ? `${nicheName(E.niche)} · ${hits.length} organisms` : `${hits.length} match${hits.length === 1 ? "" : "es"}`),
            el("button", { class: "linkbtn", type: "button", onclick: () => { Object.assign(E, { q: "", niche: null, tier: "", fail: "", sys: "" }); search.value = ""; explore(); } }, "Clear")),
          hits.length ? el("div", { class: "orglist" }, hits.map((o) => el("button", { type: "button", "aria-current": String(o.id === E.sel),
            onclick: () => { E.sel = o.id; draw(); } }, o.name, el("span", { class: "dim" }, " · " + subtitle(o)))))
            : el("p", { class: "dim" }, "No organisms match."));
      } else {
        leftSide = el("div", { class: "nichecards" }, ENUMS.niches.map((n) => {
          const list = ORGS.filter((o) => (o.niche || []).includes(n.id));
          return el("div", { class: "nichecard", style: { "--c": NICHE_COL[n.id] } },
            el("h3", null, nicheName(n.id)), el("div", { class: "hint", style: { marginTop: 0 } }, `${list.length} organisms`),
            el("p", null, list.slice(0, 3).map((o) => o.name).join(", ")),
            el("button", { class: "linkbtn", type: "button", onclick: () => { E.niche = n.id; draw(); } }, "Browse " + nicheName(n.id).toLowerCase()));
        }));
      }
      fill(body, el("div", { class: "cols" }, leftSide, orgPanel(sel)));
    }
    fill($main, head("Explore", `Five ways to see the same ${ORGS.length} organisms.`),
      el("div", { style: { marginBottom: "18px" } }, chips(VIEWS)),
      el("div", { class: "row", style: { alignItems: "flex-end", marginBottom: "18px" } },
        el("label", { class: "control", style: { flex: "1", minWidth: "220px", maxWidth: "360px" } }, "Search organisms", search), filterBtn),
      filters, body);
    draw();
  }

  // ------------------------------------------------------------------
  // Practice: spaced review, bookmarks, mixed · flashcards and questions
  // ------------------------------------------------------------------
  const MODE_TITLE = { due: "Spaced review", topics: "Bookmarked topics", mixed: "Mixed review" };
  async function practice() {
    await refreshStatus();
    const P = S.practice, st = S.status;
    const bookmarks = st.bookmarks || [];
    const due = (st.cards_due || 0) + Math.min(st.new_cards || 0, 20);
    const pickCard = (mode, title, sub) => el("button", { class: "pickcard", type: "button", "aria-pressed": String(P.mode === mode),
      onclick: () => { P.mode = mode; if (mode === "topics" && !P.topics) P.topics = bookmarks.slice(); practice(); } }, el("b", null, title), el("span", null, sub));
    const fmt = (k, t) => el("button", { class: "btn chipbtn", type: "button", "aria-pressed": String(P.format === k), onclick: () => { P.format = k; practice(); } }, t);
    const count = P.mode === "due" ? Math.min(24, due) : 24;
    const nQ = P.format === "flash" ? 0 : P.format === "mcq" ? count : Math.floor(count / 3);
    const nF = count - nQ;
    const mins = Math.max(1, Math.round((nF * 40 + nQ * 75) / 60));
    const checks = bookmarks.map((t) => {
      const cb = el("input", { type: "checkbox", checked: !P.topics || P.topics.includes(t) });
      cb.addEventListener("change", () => { P.topics = checks.filter((c) => c.cb.checked).map((c) => c.t); });
      return { t, cb };
    });
    fill($main,
      head("Practice", "Choose what to review and how."),
      el("p", { class: "label" }, "What to review"),
      el("div", { class: "pick" },
        pickCard("due", "Spaced review", due ? `${due} card${due === 1 ? "" : "s"} due today` : "Nothing due right now"),
        pickCard("topics", "My bookmarked topics", `${bookmarks.length} topic${bookmarks.length === 1 ? "" : "s"} saved`),
        pickCard("mixed", "Mixed", "Random across every topic")),
      el("p", { class: "label" }, "Format"),
      el("div", { class: "row", style: { gap: "8px" } }, fmt("flash", "Flashcards"), fmt("mcq", "Multiple choice"), fmt("both", "Both")),
      el("p", { style: { color: "var(--ink2)", margin: "10px 0 22px" } }, "Flashcards train recall. Questions check it and give you a score you can trust."),
      el("div", { class: "cols" },
        el("div", { class: "panel accent" },
          el("div", { class: "eyebrow" }, "Today's session"),
          P.mode === "due" && !due
            ? [el("h2", { style: { margin: "0 0 8px", fontSize: "21px" } }, "You're all caught up"),
               el("p", { style: { color: "var(--ink2)" } }, "No cards are due. Try a mixed session or your bookmarked topics.")]
            : [el("h2", { style: { margin: "0 0 8px", fontSize: "21px" } }, P.mode === "due" ? `${count} cards, about ${mins} minutes` : `Up to ${count} cards, about ${mins} minutes`),
               el("p", { style: { color: "var(--ink2)", margin: "0 0 18px" } }, [nF ? `${nF} flashcards` : null, nQ ? `${nQ} questions` : null].filter(Boolean).join("   ·   "))],
          el("button", { class: "btn primary", type: "button", disabled: (P.mode === "due" && !due) || (P.mode === "topics" && !(P.topics || bookmarks).length),
            onclick: () => startSession({ mode: P.mode, topics: P.mode === "topics" ? (P.topics || bookmarks) : null, format: P.format }) }, "Start session")),
        el("div", { class: "panel" }, el("h3", null, "Bookmarked topics"),
          bookmarks.length ? [checks.map(({ t, cb }) => el("label", { style: { display: "flex", gap: "10px", alignItems: "center", marginBottom: "8px", cursor: "pointer" } }, cb, V("topic", t))),
            el("button", { class: "btn", type: "button", style: { marginTop: "8px" },
              onclick: () => { P.mode = "topics"; startSession({ mode: "topics", topics: P.topics || bookmarks, format: P.format }); } }, "Review these instead")]
            : el("p", { class: "dim", style: { margin: 0 } }, "Bookmark a topic from the back of a flashcard and it will appear here."))));
  }

  async function startSession(opts) {
    let cards;
    try {
      if (opts.ids) {
        const all = await API.sessionCards("mixed", null, 200);
        cards = all.filter((c) => opts.ids.includes(c.question_id));
      } else cards = await API.sessionCards(opts.mode, opts.topics, 24);
    } catch (e) { toast(errMsg(e), true); return; }
    if (!cards.length) { toast("No cards to review here right now.", true); return; }
    const kinds = cards.map((_, i) => (opts.format === "flash" ? "flash" : opts.format === "mcq" ? "mcq" : i % 3 === 2 ? "mcq" : "flash"));
    S.session = { ...opts, cards, kinds, i: 0, done: { flash: 0, mcq: 0, right: 0 }, title: opts.title || MODE_TITLE[opts.mode] || "Review" };
    if (location.hash === "#practice/session") route(); else location.hash = "practice/session";
  }

  function nextIntervals(c) {
    const d = (n) => (n <= 1 ? "1 day" : n < 60 ? `${Math.round(n)} days` : `${Math.round(n / 30)} months`);
    if (!c.reps) return ["10 min", "1 day", "3 days", "7 days"];
    const i = c.interval_days, e = c.ease;
    return ["10 min", d(Math.max(1, Math.round(i * 1.2))), d(Math.max(i + 1, Math.round(i * e))), d(Math.max(i + 2, Math.round(i * e * 1.3)))];
  }

  async function sessionView() {
    const ss = S.session;
    if (!ss) { location.hash = "practice"; return; }
    const N = ss.cards.length;
    if (ss.i >= N) {
      await refreshStatus();
      fill($main, head("Session complete", ss.title),
        el("div", { class: "cols" }, el("div", { class: "panel accent" },
          el("div", { class: "statrow", style: { marginBottom: "18px" } },
            el("div", null, el("b", null, String(ss.done.flash)), el("span", null, "Flashcards")),
            el("div", null, el("b", null, ss.done.mcq ? `${ss.done.right}/${ss.done.mcq}` : "—"), el("span", null, "Questions right")),
            el("div", null, el("b", null, String(S.status.streak || 0)), el("span", null, "Day streak"))),
          el("p", { style: { color: "var(--ink2)" } }, "Cards you found hard will come back sooner. Easy ones wait longer."),
          el("div", { class: "row" }, el("a", { class: "btn primary", href: "#home" }, "Back to home"), el("a", { class: "btn", href: "#practice" }, "Another session")))));
      S.session = null;
      return;
    }
    const c = ss.cards[ss.i], kind = ss.kinds[ss.i];
    const meta = `${nicheName(c.niche)}${c.cascade_step ? " · " + cascadeLabel(c.cascade_step).replace("Cascade, step", "cascade step") : ""}`;
    const nextCard = () => { ss.i++; sessionView(); };
    const top = [head(`${kind === "flash" ? "Flashcards" : "Questions"} · ${ss.title}`, `Card ${ss.i + 1} of ${N}`),
      el("div", { class: "progress" }, el("span", { style: { width: Math.round(100 * (ss.i + 1) / N) + "%" } }))];

    if (kind === "mcq") {
      fill($main, top, el("div", { class: "cols" },
        el("div", { class: "panel" }, renderQuestion({ stem: c.stem, options: c.options }, {
          confidence: true, meta: { left: meta, right: c.is_new ? "New card" : "" },
          onAnswer: async (opt, conf) => { const r = await API.submitAnswer(c.version_id, opt, conf); ss.done.mcq++; if (r.correct) ss.done.right++; return r; },
          onNext: nextCard, nextLabel: ss.i + 1 < N ? "Next card" : "Finish"
        })), whyWeAsk()));
      return;
    }

    // flashcard
    const card = el("div", { class: "panel" });
    let bookmarked = (S.status.bookmarks || []).includes(c.topic);
    function front() {
      fill(card, el("div", { class: "flash-front" },
        el("div", { class: "cardmeta" }, el("span", null, meta), el("span", null, c.is_new ? "New card" : "")),
        el("p", { class: "stem" }, c.stem),
        el("div", { class: "row", style: { justifyContent: "space-between", marginTop: "18px" } },
          el("span", { class: "dim" }, "Think of your answer first."),
          el("button", { class: "btn primary", type: "button", onclick: back }, "Show answer"))));
    }
    async function back() {
      let a;
      try { a = await API.revealCard(c.version_id); } catch (e) { toast(errMsg(e), true); return; }
      const labels = nextIntervals(c);
      const bm = el("button", { class: "chip", type: "button", style: { background: "transparent", cursor: "pointer" } }, bookmarked ? "Bookmarked" : "Bookmark this topic");
      bm.addEventListener("click", async () => {
        bookmarked = await guard(() => API.toggleBookmark(c.topic));
        bm.textContent = bookmarked ? "Bookmarked" : "Bookmark this topic";
        S.status.bookmarks = bookmarked ? [...new Set([...(S.status.bookmarks || []), c.topic])] : (S.status.bookmarks || []).filter((t) => t !== c.topic);
      });
      fill(card,
        el("div", { class: "cardmeta" }, el("span", null, meta), el("span", null, V("topic", c.topic))),
        el("p", { class: "dim", style: { margin: "0 0 8px" } }, c.stem),
        el("div", { class: "answer" }, a.answer || ""),
        el("p", { class: "explain", style: { margin: "0 0 16px" } }, a.explanation || ""),
        el("div", { class: "row", style: { gap: "8px" } }, el("a", { class: "chip", href: cascadeHref(c.cascade_step) }, c.cascade_step ? "Open in the cascade" : "Open the niche map"), bm),
        el("p", { class: "k", style: { margin: "20px 0 4px" } }, "How well did you know it?"),
        el("div", { class: "rate" }, [["again", "Again"], ["hard", "Hard"], ["good", "Good"], ["easy", "Easy"]].map(([r, t], i) =>
          el("button", { type: "button", onclick: async (ev) => {
            ev.currentTarget.disabled = true;
            try { await API.reviewCard(c.question_id, r); ss.done.flash++; nextCard(); }
            catch (e) { toast(errMsg(e), true); ev.currentTarget.disabled = false; }
          } }, t, el("small", null, labels[i])))));
    }
    fill($main, top, el("div", { style: { maxWidth: "720px" } }, card));
    front();
  }

  // ------------------------------------------------------------------
  // Progress
  // ------------------------------------------------------------------
  function scoreChart(points) {
    if (points.length < 2) return el("p", { class: "dim", style: { margin: 0 } }, "Answer questions over a couple of weeks to see your trend here.");
    const W = 620, H = 230, L = 40, R = 40, T = 14, B = 34;
    const vals = points.map((p) => +p.pct);
    const lo = Math.max(0, Math.floor((Math.min(...vals) - 10) / 20) * 20), hi = Math.min(100, Math.ceil((Math.max(...vals) + 10) / 20) * 20);
    const x = (i) => L + (W - L - R) * (points.length === 1 ? 0.5 : i / (points.length - 1));
    const y = (v) => T + (H - T - B) * (1 - (v - lo) / Math.max(1, hi - lo));
    const ticks = [lo, (lo + hi) / 2, hi];
    const short = (s) => s.replace(/^Wk of /, "");
    return svg("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Score over time: " + points.map((p) => `${p.label} ${Math.round(p.pct)}%`).join(", ") },
      ticks.map((t) => [svg("line", { x1: L, x2: W - R, y1: y(t), y2: y(t), stroke: "#2a2f3a" }), svg("text", { x: 4, y: y(t) + 4 }, String(Math.round(t)))]),
      svg("polyline", { points: points.map((p, i) => `${x(i)},${y(+p.pct)}`).join(" "), fill: "none", stroke: "#9d8cf7", "stroke-width": 2.5 }),
      points.map((p, i) => [
        svg("circle", { cx: x(i), cy: y(+p.pct), r: p.kind === "exam" ? 6 : 4.5, fill: p.kind === "exam" ? "#9d8cf7" : "#171a21", stroke: "#9d8cf7", "stroke-width": 2 },
          svg("title", null, `${p.label}: ${Math.round(p.pct)}%`)),
        svg("text", { x: x(i), y: H - 10, "text-anchor": "middle" }, short(p.label))]));
  }

  async function progress() {
    const [p] = await Promise.all([API.myProgress(30)]);
    const delta = p.avg != null && p.prev_avg != null ? p.avg - p.prev_avg : null;
    const covered = p.covered || { seen: 0, total: 0 };
    const tl = (p.timeline || []).slice(-8);
    const exams = tl.filter((t) => t.kind === "exam");
    const wk = p.week || [];
    const activeDays = wk.filter((d) => d.active).length;
    const todayIdx = wk.map((d) => !d.future).lastIndexOf(true);
    const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const conf = p.confidence || {};
    const topics = (p.by_topic || []).filter((t) => t.n >= 2).slice(0, 3);
    const byNiche = p.by_niche || [];

    fill($main,
      head("Your progress", "Last 30 days."),
      el("div", { class: "cards" },
        stat("Average score", pct(p.avg), delta == null ? "No earlier month to compare" : `${delta >= 0 ? "+" : ""}${delta} points vs last month`, delta == null ? "" : delta >= 0 ? "ok" : "bad"),
        stat("Study streak", `${p.streak || 0} day${p.streak === 1 ? "" : "s"}`, `Best: ${p.best_streak || 0} days`),
        stat("Questions answered", (p.answered || 0).toLocaleString(), `About ${Math.round((p.answered || 0) / 30)} a day`),
        stat("Content covered", covered.total ? pct(100 * covered.seen / covered.total) : "—", `${covered.seen} of ${covered.total} organisms`)),
      el("div", { class: "cols" },
        el("div", { class: "panel" }, el("h3", null, "Score over time"), scoreChart(tl),
          exams.length ? el("p", { class: "foot" }, "Filled dots are exams: " + exams.map((e) => `${pct(e.pct)} at the ${e.label.toLowerCase()}`).join(", ") + ".")
                       : el("p", { class: "foot" }, "Hollow dots are your weekly practice accuracy. Exams appear as filled dots.")),
        el("div", { class: "panel" }, el("h3", null, "This week"),
          el("div", { class: "week" }, wk.map((d, i) => el("div", null,
            el("i", { class: d.active ? "on" : i === todayIdx ? "today" : null, "aria-label": `${DOW[i]}: ${d.active ? "studied" : d.future ? "upcoming" : "no study"}` }), DOW[i]))),
          el("p", { style: { color: "var(--ink2)", margin: 0 } },
            `Weekly goal: 5 days. You have done ${activeDays}. Missing a day pauses your streak instead of resetting it.`))),
      el("div", { class: "cols" },
        el("div", { class: "panel" }, el("h3", null, "Strengths and weaknesses by niche"),
          byNiche.length ? nicheBars(byNiche) : el("p", { class: "dim", style: { margin: 0 } }, "No answers in the last 30 days yet.")),
        el("div", { class: "panel" }, el("h3", { style: { marginBottom: "4px" } }, "Confidence check"),
          el("p", { style: { color: "var(--ink2)", margin: "0 0 6px" } }, "How often you were right at each confidence level."),
          conf.sure_n || conf.guess_n ? [
            el("div", { class: "bar3" }, el("span", null, "When you felt sure"), el("span", null, pct(conf.sure_pct))), meter(conf.sure_pct),
            el("div", { class: "bar3" }, el("span", null, "When you guessed"), el("span", null, pct(conf.guess_pct))), meter(conf.guess_pct),
            conf.confidently_wrong_pct != null ? el("p", { style: { margin: "16px 0 0" } }, `${pct(conf.confidently_wrong_pct)} of your answers were confidently wrong. `,
              (p.confidently_wrong || []).length ? el("button", { class: "linkbtn", type: "button",
                onclick: () => startSession({ ids: p.confidently_wrong, format: "mcq", title: "Confidently wrong" }) }, "Review them first") : null) : null]
            : el("p", { class: "dim", style: { margin: "8px 0 0" } }, "Tap Guess, Unsure or Sure when you answer and this fills in."))),
      el("div", { class: "panel accent" }, el("h3", null, "Study this next"),
        topics.length ? topics.map((t) => el("div", { class: "listrow" },
          el("span", null, el("b", { style: { fontWeight: 600 } }, V("topic", t.topic)),
            el("span", { class: "dim" }, ` · ${nicheName(t.niche)}${t.cascade_step ? " · " + cascadeLabel(t.cascade_step).toLowerCase().replace("cascade, ", "cascade ") : ""} · ${t.wrong} missed`)),
          t.cascade_step && /^extracellular:/.test(t.cascade_step)
            ? el("a", { href: "cascade.html?b=extracellular" }, "Open the cascade")
            : el("button", { class: "linkbtn", type: "button", onclick: () => startSession({ mode: "topics", topics: [t.topic], format: "both", title: V("topic", t.topic) }) }, "Practice these")))
          : el("p", { class: "dim", style: { margin: 0 } }, "Once you have answered a few questions, your three weakest topics appear here.")));
  }

  API.onAuth((event) => {
    if (event === "PASSWORD_RECOVERY") { document.getElementById("tabs").hidden = true; Shell.newPasswordScreen($main); return; }
    if (event === "SIGNED_OUT") { location.reload(); return; }
    boot();
  });
  boot();
})();
