/* In-memory stand-in for app/api.js used by tests/ui/run.mjs. Injected as
   window.__MOCK_API__ before the page scripts; window.__ROLE__ picks the user. */
(function () {
  const XSS_SUMMARY = 'Capsule blocks C3b deposition\n<script>window.__xss = "lecture"</script>\n<img src=x onerror="window.__xss=\'img\'"> stays as text';
  const XSS_STEM = '<script>window.__xss = "stem"</script> Which feature lets S. pneumoniae resist phagocytosis?';
  const now = new Date().toISOString();
  const role = window.__ROLE__ || "instructor";
  const ME = { instructor: "u-i1", admin: "u-ad", student: "u-s1" }[role];
  const GATE = window.__GATE__ || "";   // "", "consent", "pretest"
  const profiles = [
    { user_id: "u-ad", display_name: "Dr Admin", email: "admin@uni.ac.th", role: "admin" },
    { user_id: "u-i1", display_name: "Dr Somchai", email: "somchai@uni.ac.th", role: "instructor" },
    { user_id: "u-i2", display_name: "Dr Malee", email: "malee@uni.ac.th", role: "instructor" },
    { user_id: "u-s1", display_name: "Nok", email: "nok@student.ac.th", role: "student" }
  ];
  const vocab = [
    ["niche", "extra", "EXTRACELLULAR — interstitium, blood, mucosal lumen"], ["niche", "vesic", "INTRACELLULAR — vesicular (phagosome)"],
    ["niche", "cyto", "INTRACELLULAR — cytosolic"], ["niche", "surf", "SURFACE / MULTICELLULAR — too large to phagocytose"],
    ["topic", "immune-response", "Immune response"], ["topic", "transmission", "Transmission and life cycle"],
    ["topic", "evasion", "Immune evasion / why defence fails"], ["topic", "host-defect", "Host defects / immunodeficiency"],
    ["organism", "streptococcus-pneumoniae", "Streptococcus pneumoniae"], ["organism", "neisseria-meningitidis", "Neisseria meningitidis"],
    ["disease", "asplenia", "Asplenia / splenectomy"], ["tier", "1", "ศรว. group 1"], ["tier", "2", "ศรว. group 2"],
    ["bloom", "understand", "Understand"], ["bloom", "apply", "Apply"], ["difficulty", "easy", "Easy"], ["difficulty", "medium", "Medium"],
    ["failure_mode", "Capsule / anti-phagocytic", "Capsule / anti-phagocytic"],
    ["cascade_step", "extracellular:S3", "extracellular S3 — Opsonisation — C3b and IgG coat the surface"]
  ].map(([kind, id, label], i) => ({ kind, id, label, sort: i, active: true }));
  const lectures = [
    { id: "11111111-1111-1111-1111-111111111111", number: 3, title: "Extracellular bacteria", niche: "extra", summary: XSS_SUMMARY,
      disease_ids: ["asplenia"], organism_ids: ["streptococcus-pneumoniae"], cascade_step: "extracellular:S3",
      status: "published", author_id: "u-i1", updated_at: now, published_at: now },
    { id: "22222222-2222-2222-2222-222222222222", number: 4, title: "Vesicular pathogens", niche: "vesic", summary: "Macrophage activation\nIFN-γ",
      disease_ids: [], organism_ids: [], cascade_step: null, status: "draft", author_id: "u-i1", updated_at: now, published_at: null }
  ];
  const opt = (a) => a.map((t, i) => ({ id: "ABCDE"[i], text: t }));
  const versions = [
    { id: "v1", question_id: "q1", version: 1, status: "live", stem: XSS_STEM, options: opt(["C3b opsonisation", "Polysaccharide capsule", "IgA protease", "<b>Antigenic</b> variation"]),
      niche: "extra", topic: "evasion", lecture_id: lectures[0].id, organism_ids: ["streptococcus-pneumoniae"], disease_ids: [], tier: "1",
      failure_mode: "Capsule / anti-phagocytic", bloom: "understand", difficulty: "medium", author_id: "u-i1", approved_by: "u-i2", updated_at: now, approved_at: now },
    { id: "v2", question_id: "q2", version: 1, status: "in_review", stem: "Which complement deficiency predisposes to recurrent Neisseria bacteraemia?",
      options: opt(["C1 inhibitor", "C3", "C5–C9", "MPO"]), niche: "extra", topic: "host-defect", lecture_id: lectures[0].id,
      organism_ids: ["neisseria-meningitidis"], disease_ids: [], tier: "1", failure_mode: null, bloom: "apply", difficulty: "easy",
      author_id: "u-i2", updated_at: now }
  ];
  const keys = [
    { version_id: "v1", correct_option_id: "B", explanation: 'The capsule blocks C3b. <script>window.__xss="expl"</script>' },
    { version_id: "v2", correct_option_id: "C", explanation: "MAC lysis kills Neisseria." }
  ];
  const items = { q1: { id: "q1", pool: "practice", author_id: "u-i1", source: "manual", retired_at: null },
                  q2: { id: "q2", pool: "practice", author_id: "u-i2", source: "ai", retired_at: null } };
  const reviews = [{ id: "r1", version_id: "v1", reviewer_id: "u-i2", decision: "approved", comment: "Good", created_at: now }];
  const log = (window.__CALLS__ = []);
  const call = (name, ...args) => { log.push([name, ...args]); };
  const lecFor = (id) => lectures.find((l) => l.id === id);

  window.__MOCK_API__ = {
    configured: true,
    async session() { if (role === "anon") return null; const p = profiles.find((x) => x.user_id === ME); return { user: { id: ME, email: p.email }, profile: { ...p, id: ME } }; },
    async signOut() {}, onAuth() {},
    async signInPassword(e, p) { call("signInPassword", e, p); if (p !== "correct-horse") throw new Error("Invalid login credentials"); },
    async signUp(e, p, n) { call("signUp", e, p, n); return false; },
    async resetPassword(e) { call("resetPassword", e); },
    async updatePassword(p) { call("updatePassword", p); },
    async updateDisplayName(n) { call("updateDisplayName", n); },
    async reauth(e, p) { call("reauth", e); if (p !== "correct-horse") throw new Error("Your current password is not correct."); },
    async changeEmail(e) { call("changeEmail", e); return false; },
    async vocab() { return vocab; }, async upsertVocab(...a) { call("upsertVocab", ...a); },
    async lectureList() {
      return lectures.filter((l) => l.status === "published" || l.author_id === ME || role === "admin").map((l) => ({
        ...l, author_name: profiles.find((p) => p.user_id === l.author_id).display_name, viewers: l.status === "published" ? 12 : 0, questions: 1 }));
    },
    async getLecture(id) { return { ...lecFor(id) }; },
    async saveLecture(p) { call("saveLecture", p); return p.id || "33333333-3333-3333-3333-333333333333"; },
    async publishLecture(id) { call("publishLecture", id); lecFor(id).status = "published"; },
    async unpublishLecture(id) { call("unpublishLecture", id); lecFor(id).status = "draft"; },
    async lectureViewCount(id) { return lecFor(id).status === "published" ? 12 : 0; },
    async publishedLectures() { return lectures.filter((l) => l.status === "published"); },
    async logLectureView(id) { call("logLectureView", id); },
    async myViewedLectures() { return [lectures[0].id]; },
    async questionList() {
      return versions.filter((v) => v.status !== "draft" || v.author_id === ME).map((v) => {
        const l = lecFor(v.lecture_id);
        return { question_id: v.question_id, pool: items[v.question_id].pool, item_author: items[v.question_id].author_id, source: items[v.question_id].source,
          retired_at: null, version_id: v.id, version: v.version, status: v.status, stem: v.stem, niche: v.niche, topic: v.topic, lecture_id: v.lecture_id,
          lecture_number: l.number, lecture_title: l.title, tier: v.tier, difficulty: v.difficulty, bloom: v.bloom, failure_mode: v.failure_mode,
          organism_ids: v.organism_ids, disease_ids: v.disease_ids, version_author: v.author_id,
          author_name: profiles.find((p) => p.user_id === v.author_id).display_name,
          live_version_id: v.status === "live" ? v.id : null, live_version: v.status === "live" ? 1 : null,
          answers: v.status === "live" ? 40 : 0, pct_correct: v.status === "live" ? 62.5 : null, updated_at: now, last_return_comment: null };
      });
    },
    async getQuestion(qid) {
      const vs = versions.filter((v) => v.question_id === qid);
      return { item: items[qid], versions: vs, keys: keys.filter((k) => vs.some((v) => v.id === k.version_id)),
               reviews: reviews.filter((r) => vs.some((v) => v.id === r.version_id)) };
    },
    async saveQuestion(p) { call("saveQuestion", p); return { question_id: p.question_id || "q9", version_id: "v9", version: 2, new_version: true }; },
    async validateQuestion() { return []; },
    async submitQuestion(v) { call("submitQuestion", v); },
    async reviewQuestion(...a) { call("reviewQuestion", ...a); },
    async publishQuestion(v) { call("publishQuestion", v); },
    async retireQuestion(q) { call("retireQuestion", q); },
    async duplicateQuestion(q) { call("duplicateQuestion", q); return { question_id: "q9" }; },
    async setQuestionPool(...a) { call("setQuestionPool", ...a); },
    async importQuestions(items, source) { call("importQuestions", items, source); return items.map((_, i) => ({ index: i + 1, ok: i === 0, errors: i ? "Tag a topic." : null })); },
    async similarStems(stem) { return stem.toLowerCase().includes("pneumoniae") ? [{ question_id: "q1", stem: XSS_STEM, score: 0.81, status: "live" }] : []; },
    async practiceQuestions(lid) { return versions.filter((v) => v.status === "live" && v.lecture_id === lid); },
    async submitAnswer(vid, o) { call("submitAnswer", vid, o); const k = keys.find((x) => x.version_id === vid); return { correct: k.correct_option_id === o, ...k }; },
    async studentSummary() {
      return profiles.map((p, i) => ({ ...p, answers: p.role === "student" ? 40 : 0, pct_correct: p.role === "student" ? 71.4 : null,
        lectures_viewed: p.role === "student" ? 3 : 0, last_active: now, joined: now }));
    },
    async setUserRole(...a) { call("setUserRole", ...a); },
    async itemStats() {
      return [{ question_id: "q1", version_id: "v1", version: 1, stem: XSS_STEM, n: 40, pct_correct: 62.5, discrimination: 0.41,
                option_counts: { A: 8, B: 25, C: 4, D: 3 }, correct_option_id: "B" },
              { question_id: "q2", version_id: "v2", version: 1, stem: versions[1].stem, n: 24, pct_correct: 95.8, discrimination: 0.12,
                option_counts: { A: 1, C: 23 }, correct_option_id: "C" }];
    },
    async exportQuestions() { return []; }, async auditLog() { return []; }
  };
})();

/* ---- student app, cohorts and exams ---- */
(function () {
  const M = window.__MOCK_API__;
  const log = window.__CALLS__;
  const call = (name, ...args) => log.push([name, ...args]);
  const GATE = window.__GATE__ || "";
  const days = (n) => new Date(Date.now() + n * 864e5).toISOString();
  const L1 = "11111111-1111-1111-1111-111111111111";
  const st = { consent: GATE === "consent" ? null : { platform: true, research: false }, pre: GATE ? "todo" : "done", bookmarks: ["evasion"] };
  const exam = { attempt_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", exam_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", kind: "pretest",
    title: "Pre-test 2567", started_at: new Date(Date.now() - 860e3).toISOString(), duration_min: 30, deadline: days(1 / 48),
    items: [
      { position: 1, stem: "Which effector is most important for clearing an established intracellular viral infection?", niche: "cyto",
        options: [{ id: "A", text: "Neutralizing IgG antibodies" }, { id: "B", text: "Cytotoxic T cells" }, { id: "C", text: "Complement" }, { id: "D", text: "Neutrophils" }] },
      { position: 2, stem: '<script>window.__xss="exam"</script> Which cytokine drives TH2 responses?', niche: "surf",
        options: [{ id: "A", text: "IL-4" }, { id: "B", text: "IFN-γ" }, { id: "C", text: "IL-17" }] },
      { position: 3, stem: "Which pathway deposits C3b first in a naive host?", niche: "extra",
        options: [{ id: "A", text: "Classical" }, { id: "B", text: "Alternative and lectin" }, { id: "C", text: "None" }] }],
    responses: [] };
  const cards = [
    { version_id: "v1", question_id: "q1", stem: "Which pneumococcal virulence factor blocks opsonization?", options: [{ id: "A", text: "Pili" }, { id: "B", text: "The polysaccharide capsule" }, { id: "C", text: "Pneumolysin" }],
      niche: "extra", topic: "evasion", lecture_id: L1, cascade_step: "extracellular:S3", reps: 0, interval_days: 0, ease: 2.5, is_new: true },
    { version_id: "v3", question_id: "q3", stem: "Which cell kills virus-infected cells displaying peptide on MHC I?", options: [{ id: "A", text: "CD8 T cell" }, { id: "B", text: "B cell" }, { id: "C", text: "Eosinophil" }],
      niche: "cyto", topic: "immune-response", lecture_id: L1, cascade_step: null, reps: 2, interval_days: 3, ease: 2.5, is_new: false },
    { version_id: "v4", question_id: "q4", stem: '<img src=x onerror="window.__xss=\'card\'"> Which is the decisive arm against extracellular bacteria?', options: [{ id: "A", text: "Antibody" }, { id: "B", text: "NK cells" }, { id: "C", text: "TH2" }],
      niche: "extra", topic: "immune-response", lecture_id: L1, cascade_step: "extracellular:S3", reps: 1, interval_days: 3, ease: 2.5, is_new: false }];
  const cardKeys = { v1: ["B", "The polysaccharide capsule", "It hides the bacterial surface from complement and phagocytes. Anti-capsule antibodies restore opsonization, which is the basis of pneumococcal vaccines."],
    v3: ["A", "CD8 T cell", "Cytotoxic T cells recognise peptide on MHC I and kill the infected cell."],
    v4: ["A", "Antibody", '<script>window.__xss="back"</script> Opsonising antibody and complement.'] };

  Object.assign(M, {
    async myStatus() {
      return { role: "student", cohort_id: "c1", cohort: "2567", consent: st.consent,
        pretest: st.pre === "none" ? { state: "none" } : { state: st.pre, exam_id: exam.exam_id, title: exam.title, n_items: 3, duration_min: 30, attempt_id: st.pre === "todo" ? null : exam.attempt_id, score: 52 },
        streak: 12, best_streak: 19, cards_due: 16, new_cards: 8, bookmarks: st.bookmarks.slice() };
    },
    async setConsent(p, r) { call("setConsent", p, r); st.consent = { platform: p, research: r }; },
    async myExams() {
      return [{ exam_id: exam.exam_id, kind: "pretest", title: exam.title, opens_at: days(-20), status: "open", n_items: 3, attempt_id: exam.attempt_id, submitted_at: st.pre === "done" ? days(-20) : null, score: 52 },
              { exam_id: "ffffffff-ffff-ffff-ffff-ffffffffffff", kind: "monthly", title: "Check-in 1", opens_at: days(6), status: "open", duration_min: 30, n_items: 20, attempt_id: null, submitted_at: null, score: null }];
    },
    async startExam(id) { call("startExam", id); if (st.pre === "todo") st.pre = "in_progress"; return JSON.parse(JSON.stringify(exam)); },
    async saveExamResponse(...a) { call("saveExamResponse", ...a); },
    async submitExam(a) { call("submitExam", a); st.pre = "done";
      return { attempt_id: a, kind: "pretest", score: 52, n_correct: 13, n_total: 25,
        by_niche: [{ niche: "surf", pct: 68 }, { niche: "extra", pct: 56 }, { niche: "vesic", pct: 40 }] }; },
    async myProgress() {
      return { days: 30, avg: 74, prev_avg: 68, answered: 640, streak: 12, best_streak: 19,
        week: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ date: days(i - 3).slice(0, 10), active: i < 4, future: i > 3 })),
        by_niche: [{ niche: "surf", pct: 83, n: 90 }, { niche: "cyto", pct: 68, n: 160 }, { niche: "extra", pct: 61, n: 250 }, { niche: "vesic", pct: 52, n: 140 }],
        by_topic: [{ topic: "evasion", niche: "extra", pct: 38, n: 40, wrong: 25, cascade_step: "extracellular:S3" },
                   { topic: "host-defect", niche: "vesic", pct: 52, n: 30, wrong: 14, cascade_step: null },
                   { topic: "immune-response", niche: "cyto", pct: 61, n: 60, wrong: 23, cascade_step: null }],
        confidence: { sure_pct: 82, sure_n: 300, guess_pct: 41, guess_n: 120, confidently_wrong_pct: 9 },
        covered: { seen: 52, total: 91 },
        timeline: [{ label: "Pre-test", kind: "exam", pct: 52 }, { label: "Wk of 05 Oct", kind: "week", pct: 58 }, { label: "Wk of 12 Oct", kind: "week", pct: 61 },
                   { label: "Wk of 19 Oct", kind: "week", pct: 66 }, { label: "Wk of 26 Oct", kind: "week", pct: 70 }, { label: "Check-in", kind: "exam", pct: 74 }],
        last_lecture: { id: L1, number: 3, title: "Extracellular bacteria" }, recent: { n: 8, wrong: 5, topic: "evasion" }, confidently_wrong: ["q1"] };
    },
    async myLectureStatus() { return [{ lecture_id: L1, viewed: true, completed: false }]; },
    async markLectureRead(id) { call("markLectureRead", id); },
    async sessionCards(mode, topics) { call("sessionCards", mode, topics); return JSON.parse(JSON.stringify(cards)); },
    async revealCard(v) { const k = cardKeys[v]; return { correct_option_id: k[0], answer: k[1], explanation: k[2] }; },
    async reviewCard(q, r) { call("reviewCard", q, r); return { interval_days: 3 }; },
    async toggleBookmark(t) { call("toggleBookmark", t); const on = !st.bookmarks.includes(t); st.bookmarks = on ? [...st.bookmarks, t] : st.bookmarks.filter((x) => x !== t); return on; },
    async submitAnswer(v, o, c) { call("submitAnswer", v, o, c); const k = cardKeys[v] || ["B", "", 'The capsule blocks C3b. <script>window.__xss="expl"</script>'];
      return { correct: o === k[0], correct_option_id: k[0], explanation: k[2] }; },

    // instructor
    async cohorts() { return [{ id: "c1", name: "2567" }, { id: "c2", name: "2568" }]; },
    async saveCohort(...a) { call("saveCohort", ...a); return "c3"; },
    async setStudentCohort(...a) { call("setStudentCohort", ...a); },
    async cohortOverview() {
      const t = (topic, pre, w) => ({ topic, pretest: pre, weeks: w });
      return { students: 84, active_week: 71, avg: 71, pretest_avg: 52, checkin: { title: "Check-in 1", opens_at: days(-6), done: 68 },
        weeks: [days(-27), days(-20), days(-13), days(-6)].map((d) => d.slice(0, 10)),
        topics: [t("evasion", 38, [41, 45, 48, 52]), t("host-defect", 55, [58, 60, 64, 66]), t("immune-response", 62, [64, 67, 69, 72]), t("transmission", 66, [70, 73, 76, 78])],
        monthly_exam_id: "ffffffff-ffff-ffff-ffff-ffffffffffff" };
    },
    async logNamesShown() { call("logNamesShown"); },
    async examList() {
      return [{ id: "ffffffff-ffff-ffff-ffff-ffffffffffff", kind: "monthly", title: "Check-in 1", cohort_id: "c1", cohort: "2567", opens_at: days(-6), closes_at: days(1), duration_min: 30, status: "open", n_items: 20, started: 70, submitted: 68, avg_score: 74, eligible: 84 },
              { id: exam.exam_id, kind: "pretest", title: "Pre-test 2567", cohort_id: "c1", cohort: "2567", opens_at: days(-30), closes_at: null, duration_min: 30, status: "open", n_items: 25, started: 84, submitted: 84, avg_score: 52, eligible: 84 }];
    },
    async examDetail(id) {
      const mon = id.startsWith("ffff");
      return { exam: { id, kind: mon ? "monthly" : "pretest", title: mon ? "Check-in 1" : "Pre-test 2567", cohort_id: "c1", cohort: "2567", opens_at: days(-6), closes_at: days(1), duration_min: 30, status: mon ? "draft" : "open" },
        kr20: 0.81, pool_live: 40,
        items: [{ position: 1, question_id: "q1", version_id: "v1", stem: "Which feature lets S. pneumoniae resist phagocytosis?", niche: "extra", topic: "evasion", n: 84, pct: 38 },
                { position: 2, question_id: "q2", version_id: "v2", stem: "Which complement deficiency…", niche: "extra", topic: "host-defect", n: 84, pct: 61 }],
        attempts: [{ attempt_id: "a1", code: "S-0412", name: "Nok", started_at: days(-5), submitted_at: days(-5), score: 72 },
                   { attempt_id: "a2", code: "S-0377", name: "Ploy", started_at: days(-4), submitted_at: null, score: null }] };
    },
    async saveExam(p) { call("saveExam", p); return p.id || "ffffffff-ffff-ffff-ffff-ffffffffffff"; },
    async setExamItems(...a) { call("setExamItems", ...a); return 2; },
    async pickExamItems(...a) { call("pickExamItems", ...a); return 25; },
    async setExamStatus(...a) { call("setExamStatus", ...a); },
    async researchExport() { return { consented: 61, students: 84, answers: [], exams: [] }; }
  });
  const baseSummary = M.studentSummary;
  M.studentSummary = async (...a) => (await baseSummary(...a)).map((p, i) => ({ ...p,
    code: "S-0" + (412 - i * 35), cohort_id: p.role === "student" ? "c1" : null, cohort: p.role === "student" ? "2567" : null,
    prev_pct: 80, confidently_wrong_pct: 24, active_days: 9, research_consent: i % 2 === 0,
    last_active: p.role === "student" ? new Date(Date.now() - 9 * 864e5).toISOString() : p.last_active }));
  const baseItems = M.itemStats;
  M.itemStats = async (...a) => (await baseItems(...a)).map((x, i) => ({ ...x, topic: i ? "host-defect" : "evasion", niche: "extra" }));
})();
