/* ============================================================
   learn.js — the student Learn tab: published lectures and their
   live practice questions. Uses the same renderers as the instructor
   preview, so what instructors preview is what students get.
   Routes:  #<lectureId>            read a lecture
            #<lectureId>/practice   one question at a time
   ============================================================ */
;(function () {
  "use strict";
  const { el, fill } = Safe;
  const { renderLecture, renderQuestion, NICHE_COL, shortNiche } = Render;
  const $main = document.getElementById("main");
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const vocab = {};
  let me = null, lectures = [], viewed = new Set();

  async function boot() {
    const sess = await API.session().catch(() => null);
    if (!sess) {
      Shell.signInScreen($main, "Use your university email.", "Lecture summaries and practice questions for Infection & Immunity.");
      return;
    }
    if (me === sess.user.id) return;
    me = sess.user.id;
    const p = sess.profile || {};
    const links = [{ label: "Revision tool", href: "../index.html" }];
    if (p.role === "instructor" || p.role === "admin") links.unshift({ label: "Instructor dashboard", href: "instructor.html" });
    Shell.avatarMenu(document.getElementById("avatar"), p, sess.user.email, links);
    for (const v of await API.vocab()) (vocab[v.kind] ||= {})[v.id] = v.label;
    [lectures, viewed] = await Promise.all([API.publishedLectures(),
      API.myViewedLectures().then((a) => new Set(a)).catch(() => new Set())]);
    window.addEventListener("hashchange", route);
    route();
  }

  async function route() {
    const [id, mode] = location.hash.slice(1).split("/");
    const asked = UUID.test(id || "");
    try {
      const lec = asked ? lectures.find((l) => l.id === id) : lectures[0];
      if (lec && mode === "practice") await practice(lec);
      else await page(lec, asked && !lec);
    } catch (e) { fill($main, el("div", { class: "banner bad" }, e.message || String(e))); }
  }

  const head = (title, sub) => el("div", { class: "pagehead" },
    el("div", null, el("h1", null, title), sub ? el("p", { class: "sub" }, sub) : null));

  function lectureList(current) {
    return el("div", { class: "panel" }, el("h3", null, "Lectures"),
      lectures.length ? el("nav", { class: "lecturelist", "aria-label": "Lectures" }, lectures.map((l) =>
        el("a", { class: "lecitem", href: "#" + l.id, "aria-current": String(!!current && l.id === current.id) },
          el("span", null, `${l.number} ${l.title}`),
          el("span", { class: "st" }, viewed.has(l.id) ? "Opened" : "Not started"))))
        : el("p", { class: "dim" }, "No lectures have been published yet."));
  }

  async function page(lec, missing) {
    let detail;
    if (missing) {
      detail = el("div", { class: "panel" }, el("p", null, "This lecture is not available."));
    } else if (!lec) {
      detail = el("div", { class: "panel" }, el("p", { class: "dim" }, "Lectures appear here when your instructors publish them."));
    } else {
      API.logLectureView(lec.id).then(() => viewed.add(lec.id)).catch(() => {});
      const qs = await API.practiceQuestions(lec.id);
      const practiceBtn = qs.length
        ? el("a", { class: "btn primary", href: `#${lec.id}/practice` }, `Practice this lecture (${qs.length})`)
        : el("button", { class: "btn primary", type: "button", disabled: true }, "No practice questions yet");
      detail = el("div", { class: "panel accent", style: { "--c": NICHE_COL[lec.niche] || "var(--accent)" } },
        renderLecture(lec, vocab, { actions: [practiceBtn, el("a", { class: "btn", href: "niche-map.html" }, "Open the niche map")] }));
    }
    fill($main, head("Learn", "Lecture summaries linked to the maps, with practice questions."),
      el("div", { class: "learn-grid" }, lectureList(lec), detail));
  }

  async function practice(lec) {
    const qs = await API.practiceQuestions(lec.id);
    let i = 0, right = 0;
    const box = el("div", { class: "panel" });
    const why = el("div", { class: "panel" }, el("h3", null, "How this works"),
      el("p", { class: "dim", style: { margin: 0 } },
        "Pick an answer, then check it. Answers are saved so your instructors can see which topics the class finds hard and adjust their teaching."));
    function show() {
      if (i >= qs.length) {
        fill(box, el("div", { class: "eyebrow" }, "Session complete"),
          el("h2", { style: { margin: "0 0 8px" } }, `${right} of ${qs.length} correct`),
          el("p", { class: "dim" }, "Questions you missed are worth another look in the lecture summary."),
          el("div", { class: "row", style: { marginTop: "18px" } },
            el("button", { class: "btn primary", type: "button", onclick: () => { i = 0; right = 0; show(); } }, "Practice again"),
            el("a", { class: "btn", href: "#" + lec.id }, "Back to the lecture")));
        return;
      }
      const v = qs[i];
      fill(box, renderQuestion(v, {
        meta: { left: shortNiche(vocab, v.niche || lec.niche), right: `Question ${i + 1} of ${qs.length}`, progress: (i + 1) / qs.length },
        onAnswer: async (opt) => { const r = await API.submitAnswer(v.id, opt); if (r.correct) right++; return r; },
        onNext: () => { i++; show(); },
        nextLabel: i + 1 < qs.length ? "Next question" : "See results"
      }));
    }
    fill($main,
      el("a", { class: "backlink", href: "#" + lec.id }, `← Lecture ${lec.number}: ${lec.title}`),
      head(`Practice · Lecture ${lec.number}`, qs.length ? `${qs.length} question${qs.length === 1 ? "" : "s"}` : "No questions yet"),
      el("div", { class: "cols" }, qs.length ? box : el("div", { class: "panel" }, el("p", { class: "dim" }, "No practice questions for this lecture yet.")), why));
    if (qs.length) show();
  }

  API.onAuth(() => boot());
  boot();
})();
