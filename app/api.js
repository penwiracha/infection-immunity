/* ============================================================
   api.js — thin wrapper over Supabase. Every write is an RPC to a
   SECURITY DEFINER function that checks the caller's role; the
   browser never writes tables directly. Tests swap in window.__MOCK_API__.
   ============================================================ */
;(function (root) {
  "use strict";
  if (root.__MOCK_API__) { root.API = root.__MOCK_API__; return; }

  const cfg = root.APP_CONFIG || {};
  const configured = cfg.SUPABASE_URL && !/YOUR-PROJECT/.test(cfg.SUPABASE_URL);
  const sb = configured && root.supabase ? root.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  const need = () => { if (!sb) throw new Error("Supabase is not configured — edit app/config.js."); };
  const unwrap = ({ data, error }) => { if (error) throw new Error(error.message || String(error)); return data; };
  const rpc = async (fn, args) => { need(); return unwrap(await sb.rpc(fn, args || {})); };
  const from = (t) => { need(); return sb.from(t); };

  const API = {
    configured: !!sb,

    // ---- auth ----
    async session() {
      if (!sb) return null;
      const { data } = await sb.auth.getSession();
      const user = data.session && data.session.user;
      if (!user) return null;
      const profile = unwrap(await sb.from("profiles").select("*").eq("id", user.id).maybeSingle());
      return { user, profile };
    },
    async signIn(email) {
      need();
      const redirect = location.href.split("#")[0];
      unwrap(await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } }));
    },
    async signOut() { if (sb) await sb.auth.signOut(); },
    onAuth(cb) { if (sb) sb.auth.onAuthStateChange(() => cb()); },

    // ---- vocab ----
    async vocab() { return unwrap(await from("vocab").select("*").eq("active", true).order("kind").order("sort")); },
    upsertVocab: (kind, id, label) => rpc("upsert_vocab", { p_kind: kind, p_id: id, p_label: label }),

    // ---- lectures ----
    lectureList: () => rpc("lecture_list"),
    async getLecture(id) { return unwrap(await from("lectures").select("*").eq("id", id).single()); },
    saveLecture: (p) => rpc("save_lecture", { p }),
    publishLecture: (id) => rpc("publish_lecture", { p_id: id }),
    unpublishLecture: (id) => rpc("unpublish_lecture", { p_id: id }),
    lectureViewCount: (id) => rpc("lecture_view_count", { p_id: id }),
    async publishedLectures() {
      return unwrap(await from("lectures").select("*").eq("status", "published").order("number"));
    },
    logLectureView: (id) => rpc("log_lecture_view", { p_id: id }),

    // ---- questions ----
    questionList: () => rpc("question_list"),
    async getQuestion(qid) {
      const versions = unwrap(await from("question_versions").select("*").eq("question_id", qid).order("version", { ascending: false }));
      const ids = versions.map((v) => v.id);
      const keys = ids.length ? unwrap(await from("question_keys").select("*").in("version_id", ids)) : [];
      const reviews = ids.length ? unwrap(await from("question_reviews").select("*").in("version_id", ids).order("created_at", { ascending: false })) : [];
      const item = unwrap(await from("questions").select("*").eq("id", qid).single());
      return { item, versions, keys, reviews };
    },
    saveQuestion: (p) => rpc("save_question", { p }),
    validateQuestion: (p) => rpc("validate_question", { p }),
    submitQuestion: (v) => rpc("submit_question", { p_version: v }),
    reviewQuestion: (v, decision, comment) => rpc("review_question", { p_version: v, p_decision: decision, p_comment: comment || null }),
    publishQuestion: (v) => rpc("publish_question", { p_version: v }),
    retireQuestion: (q) => rpc("retire_question", { p_question: q }),
    duplicateQuestion: (q) => rpc("duplicate_question", { p_question: q }),
    setQuestionPool: (q, pool) => rpc("set_question_pool", { p_question: q, p_pool: pool }),
    importQuestions: (items, source) => rpc("import_questions", { p_items: items, p_source: source }),
    similarStems: (stem, exclude) => rpc("similar_stems", { p_stem: stem, p_exclude_question: exclude || null }),

    // ---- student practice ----
    async practiceQuestions(lectureId) {
      return unwrap(await from("question_versions").select("id,question_id,version,stem,options,lecture_id,niche")
        .eq("status", "live").eq("lecture_id", lectureId));
    },
    submitAnswer: (v, opt, conf) => rpc("submit_answer", { p_version: v, p_option: opt, p_confidence: conf || null }),

    // ---- student app ----
    myStatus: () => rpc("my_status"),
    setConsent: (platform, research) => rpc("set_consent", { p_platform: platform, p_research: research }),
    myProgress: (days) => rpc("my_progress", { p_days: days || 30 }),
    myLectureStatus: () => rpc("my_lecture_status"),
    markLectureRead: (id) => rpc("mark_lecture_read", { p_id: id }),
    sessionCards: (mode, topics, limit) => rpc("session_cards", { p_mode: mode, p_topics: topics || null, p_limit: limit || 24 }),
    revealCard: (v) => rpc("reveal_card", { p_version: v }),
    reviewCard: (q, rating) => rpc("review_card", { p_question: q, p_rating: rating }),
    toggleBookmark: (topic) => rpc("toggle_bookmark", { p_topic: topic }),
    myExams: () => rpc("my_exams"),
    startExam: (id) => rpc("start_exam", { p_exam: id }),
    saveExamResponse: (att, pos, opt, conf, flagged) =>
      rpc("save_exam_response", { p_attempt: att, p_position: pos, p_option: opt || null, p_confidence: conf || null, p_flagged: !!flagged }),
    submitExam: (att) => rpc("submit_exam", { p_attempt: att }),
    examResult: (att) => rpc("exam_result", { p_attempt: att }),

    // ---- cohorts, exams, cohort reporting (instructors) ----
    async cohorts() { return unwrap(await from("cohorts").select("*").order("name", { ascending: false })); },
    saveCohort: (name, startsOn, id) => rpc("save_cohort", { p_name: name, p_starts_on: startsOn || null, p_id: id || null }),
    setStudentCohort: (uid, cid) => rpc("set_student_cohort", { p_user: uid, p_cohort: cid || null }),
    cohortOverview: (cid, days) => rpc("cohort_overview", { p_cohort: cid || null, p_days: days || 30 }),
    logNamesShown: () => rpc("log_names_shown"),
    examList: (cid) => rpc("exam_list", { p_cohort: cid || null }),
    examDetail: (id) => rpc("exam_detail", { p_exam: id }),
    saveExam: (p) => rpc("save_exam", { p }),
    setExamItems: (id, qids) => rpc("set_exam_items", { p_exam: id, p_questions: qids }),
    pickExamItems: (id, n) => rpc("pick_exam_items", { p_exam: id, p_n: n }),
    setExamStatus: (id, st) => rpc("set_exam_status", { p_exam: id, p_status: st }),
    researchExport: (cid) => rpc("research_export", { p_cohort: cid || null }),

    // ---- reporting ----
    studentSummary: (cid, days) => rpc("student_summary", { p_cohort: cid || null, p_days: days || null }),
    setUserRole: (uid, role) => rpc("set_user_role", { p_user: uid, p_role: role }),
    itemStats: (cid, days) => rpc("item_stats", { p_cohort: cid || null, p_days: days || null }),
    exportQuestions: () => rpc("export_questions"),
    async auditLog(limit) {
      return unwrap(await from("audit_log").select("*").order("created_at", { ascending: false }).limit(limit || 1000));
    }
  };
  root.API = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
