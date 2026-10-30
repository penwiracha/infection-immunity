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
    // Email + password, typed on the site. No email is sent for normal sign-in.
    async signInPassword(email, password) {
      need();
      unwrap(await sb.auth.signInWithPassword({ email, password }));
    },
    // Returns true when the account is ready to use now (email confirmation is off in Supabase),
    // false when Supabase has emailed a confirmation link first.
    async signUp(email, password, displayName, classCode) {
      need();
      const data = unwrap(await sb.auth.signUp({ email, password,
        options: { data: { display_name: displayName || "", class_code: (classCode || "").trim() }, emailRedirectTo: location.href.split("#")[0] } }));
      return !!(data && data.session);
    },
    async resetPassword(email) {
      need();
      unwrap(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split("#")[0] }));
    },
    async updatePassword(password) {
      need();
      unwrap(await sb.auth.updateUser({ password }));
    },
    async signOut() { if (sb) await sb.auth.signOut(); },

    // ---- account settings ----
    async updateDisplayName(name) {
      need();
      const { data } = await sb.auth.getSession();
      const uid = data.session && data.session.user.id;
      unwrap(await sb.from("profiles").update({ display_name: name }).eq("id", uid));
    },
    // "en" | "th" — the interface language, saved on the profile.
    async updateLang(lang) {
      need();
      const { data } = await sb.auth.getSession();
      const uid = data.session && data.session.user.id;
      unwrap(await sb.from("profiles").update({ lang }).eq("id", uid));
    },
    // "system" | "light" | "dark" — saved on the profile so it follows the account to other devices.
    async updateTheme(theme) {
      need();
      const { data } = await sb.auth.getSession();
      const uid = data.session && data.session.user.id;
      unwrap(await sb.from("profiles").update({ theme }).eq("id", uid));
    },
    // Re-checks the current password first, so a borrowed signed-in laptop cannot change it.
    async reauth(email, password) {
      need();
      const r = await sb.auth.signInWithPassword({ email, password });
      if (r.error) throw new Error(/invalid login/i.test(r.error.message) ? "Your current password is not correct." : r.error.message);
    },
    // Returns true if the change is done, false if Supabase emailed a confirmation link first.
    async changeEmail(newEmail) {
      need();
      const data = unwrap(await sb.auth.updateUser({ email: newEmail }, { emailRedirectTo: location.href.split("#")[0] }));
      return !!(data && data.user && data.user.email === newEmail);
    },
    // cb(event): event is "PASSWORD_RECOVERY" when someone arrives from a reset-password email.
    onAuth(cb) { if (sb) sb.auth.onAuthStateChange((event) => cb(event)); },

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
    setLectureHidden: (id, hidden) => rpc("set_lecture_hidden", { p_id: id, p_hidden: !!hidden }),
    async publishedLectures() {
      // hidden lectures are filtered out by RLS for students; staff previewing the student view see the same list
      return unwrap(await from("lectures").select("*").eq("status", "published").is("hidden_at", null).order("number"));
    },
    logLectureView: (id) => rpc("log_lecture_view", { p_id: id }),

    // ---- questions ----
    questionList: () => rpc("question_list"),
    async getQuestion(qid) {
      const versions = unwrap(await from("question_versions").select("*").eq("question_id", qid).order("version", { ascending: false }));
      const ids = versions.map((v) => v.id);
      const keys = ids.length ? unwrap(await from("question_keys").select("*").in("version_id", ids)) : [];
      const item = unwrap(await from("questions").select("*").eq("id", qid).single());
      return { item, versions, keys };
    },
    saveQuestion: (p) => rpc("save_question", { p }),
    validateQuestion: (p) => rpc("validate_question", { p }),
    publishQuestionNow: (v) => rpc("publish_question_now", { p_version: v }),
    questionUsage: (q) => rpc("question_usage", { p_question: q }),
    deleteQuestion: (q, force) => rpc("delete_question", { p_question: q, p_force: !!force }),
    deleteExam: (id, force) => rpc("delete_exam", { p_exam: id, p_force: !!force }),
    retireQuestion: (q) => rpc("retire_question", { p_question: q }),
    setQuestionHidden: (q, hidden) => rpc("set_question_hidden", { p_question: q, p_hidden: !!hidden }),
    duplicateQuestion: (q) => rpc("duplicate_question", { p_question: q }),
    setQuestionPool: (q, pool) => rpc("set_question_pool", { p_question: q, p_pool: pool }),
    importQuestions: (items, source) => rpc("import_questions", { p_items: items, p_source: source }),
    similarStems: (stem, exclude) => rpc("similar_stems", { p_stem: stem, p_exclude_question: exclude || null }),
    // AI drafts, generated by the server function (the AI key never reaches the browser)
    async generateQuestions(p) {
      need();
      const { data, error } = await sb.functions.invoke("generate-questions", { body: p });
      if (error) {
        let msg = error.message;
        try { const b = await error.context.json(); if (b && b.error) msg = b.error; } catch (e) { /* keep the generic message */ }
        throw new Error(msg);
      }
      return data;
    },
    aiGenerationList: (limit) => rpc("ai_generation_list", { p_limit: limit || 50 }),

    // ---- student practice ----
    async practiceQuestions(lectureId) {
      return unwrap(await from("question_versions").select("id,question_id,version,stem,options,lecture_id,niche")
        .eq("status", "live").eq("lecture_id", lectureId));
    },
    submitAnswer: (v, opt, conf) => rpc("submit_answer", { p_version: v, p_option: opt, p_confidence: conf || null }),
    // "Report a problem" on a question (students), and the instructors' side
    reportQuestion: (v, reason, comment) => rpc("report_question", { p_version: v, p_reason: reason, p_comment: comment || null }),
    reportList: (status, qid) => rpc("question_report_list", { p_status: status || "open", p_question: qid || null }),
    resolveReport: (id, status, note) => rpc("resolve_question_report", { p_id: id, p_status: status, p_note: note || null }),

    // ---- student app ----
    myStatus: () => rpc("my_status"),
    setConsent: (platform, research) => rpc("set_consent", { p_platform: platform, p_research: research }),
    myProgress: (days) => rpc("my_progress", { p_days: days || 30 }),
    myLectureStatus: () => rpc("my_lecture_status"),
    markLectureRead: (id) => rpc("mark_lecture_read", { p_id: id }),
    sessionCards: (mode, topics, limit, saved) => rpc("session_cards", { p_mode: mode, p_topics: topics || null, p_limit: limit || 24, p_saved: saved || null }),
    revealCard: (v) => rpc("reveal_card", { p_version: v }),
    reviewCard: (q, rating) => rpc("review_card", { p_question: q, p_rating: rating }),
    toggleBookmark: (topic) => rpc("toggle_bookmark", { p_topic: topic }),
    // kind: "topic" | "lecture" | "organism" | "disease"
    toggleSaved: (kind, ref) => rpc("toggle_saved", { p_kind: kind, p_ref: ref }),
    // students' own flashcards
    myCards: () => rpc("my_cards"),
    saveMyCard: (p) => rpc("save_my_card", { p }),
    deleteMyCard: (id) => rpc("delete_my_card", { p_id: id }),
    reviewMyCard: (id, rating) => rpc("review_my_card", { p_id: id, p_rating: rating }),
    myCardSession: (mode, limit, saved) => rpc("my_card_session", { p_mode: mode, p_limit: limit || 24, p_saved: saved || null }),
    studentCardList: (cid) => rpc("student_card_list", { p_cohort: cid || null }),
    myExams: () => rpc("my_exams"),
    startExam: (id) => rpc("start_exam", { p_exam: id }),
    saveExamResponse: (att, pos, opt, conf, flagged) =>
      rpc("save_exam_response", { p_attempt: att, p_position: pos, p_option: opt || null, p_confidence: conf || null, p_flagged: !!flagged }),
    submitExam: (att) => rpc("submit_exam", { p_attempt: att }),
    examResult: (att) => rpc("exam_result", { p_attempt: att }),

    // ---- cohorts, exams, cohort reporting (instructors) ----
    async cohorts() { return unwrap(await from("cohorts").select("id,name,starts_on,created_at").order("name", { ascending: false })); },
    cohortList: () => rpc("cohort_list"),
    newCohortCode: (id) => rpc("new_cohort_code", { p_cohort: id }),
    joinCohort: (code) => rpc("join_cohort", { p_code: code }),
    scheduleList: () => rpc("schedule_list"),
    saveSchedule: (p) => rpc("save_schedule", { p }),
    runDueSchedules: () => rpc("run_due_schedules"),
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
    peopleList: () => rpc("people_list"),
    createStaffInvite: (email, role) => rpc("create_staff_invite", { p_email: email, p_role: role }),
    revokeStaffInvite: (id) => rpc("revoke_staff_invite", { p_id: id }),
    staffInviteList: () => rpc("staff_invite_list"),
    itemStats: (cid, days) => rpc("item_stats", { p_cohort: cid || null, p_days: days || null }),
    exportQuestions: () => rpc("export_questions"),
    async auditLog(limit) {
      return unwrap(await from("audit_log").select("*").order("created_at", { ascending: false }).limit(limit || 1000));
    }
  };
  root.API = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
