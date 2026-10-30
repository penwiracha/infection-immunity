/* ============================================================
   generate-questions — AI question DRAFTS for instructors.

   Called from the instructor dashboard (Generate questions) with the
   signed-in instructor's session. It:
     1. checks the caller and the daily limit   (ai_generation_begin)
     2. asks the AI for questions from a lecture summary or from text the
        instructor extracted from their own PDF
     3. saves the reply as AI-generated drafts   (import_questions(..., 'ai'))
     4. records the outcome                      (ai_generation_finish)
   Every database call runs AS THE INSTRUCTOR (their JWT), so all the usual
   role checks and validation apply. Nothing reaches students until an
   instructor publishes a draft. Only course content is sent to the AI.

   Secrets (Supabase → Edge Functions → Secrets):
     TYPHOON_API_KEY   required
     AI_MODEL          optional, default typhoon-v2.5-30b-a3b-instruct
     AI_BASE_URL       optional, default https://api.opentyphoon.ai/v1
                       (any OpenAI-compatible API works: change these two)
   ============================================================ */
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const LETTERS = "ABCDE";
const MAX_SOURCE = 60000;
const MIXES: Record<string, string> = {
  medium: "mostly medium, a few easy and hard",
  easy: "mostly easy (for practice)",
  hard: "mostly hard (for exams)",
};

type Vocab = Record<string, { id: string; label: string }[]>;

function publishableKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    if (keys.default) return keys.default;
  } catch { /* fall back */ }
  return Deno.env.get("SUPABASE_ANON_KEY") || "";
}

function buildPrompt(o: { n: number; options: number; mix: string; focus: string; lecture: any; vocab: Vocab; source: string; sourceName: string }) {
  const ids = (k: string) => (o.vocab[k] || []).map((v) => v.id).join(", ");
  const list = (k: string) => (o.vocab[k] || []).map((v) => `${v.id} (${v.label})`).join("; ");
  const bullets = String(o.lecture.summary || "").split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean);
  return [
    `You are writing single-best-answer multiple-choice questions for an Infection & Immunity course for Thai medical students (ศรว. 2567 licensing level). Write in English.`,
    ``,
    `Write ${o.n} questions for Lecture ${o.lecture.number}: ${o.lecture.title}${o.focus ? `, focusing on: ${o.focus}` : ""}.`,
    bullets.length ? `Lecture summary:\n${bullets.map((b) => "- " + b).join("\n")}` : null,
    o.source ? `\nSource material from the instructor (${o.sourceName || "uploaded document"}). Base every question on this material; do not test facts it does not support.\n<source>\n${o.source}\n</source>` : null,
    ``,
    `Rules`,
    `- Each stem is a short clinical vignette or a mechanism question with one clear best answer.`,
    `- ${o.options} options per question, exactly one correct. Options are similar in length and style. Wrong options must be plausible to a student who half-knows the topic.`,
    `- Do not use "all of the above", "none of the above" or negatives such as "EXCEPT" or "NOT".`,
    `- explanation: 2 to 4 sentences saying why the answer is right and why the most tempting wrong option is wrong.`,
    `- Use only well-established facts. If you are not sure of a fact, leave that question out rather than guess.`,
    `- Mix of difficulty: ${o.mix}.`,
    `- Tag every question using ONLY the ids listed under "Allowed values". Never invent an id; leave a list empty if nothing fits.`,
    ``,
    `Output`,
    `Return ONLY a JSON array, with no text before or after it and no code fences, in exactly this shape:`,
    `[{"stem": "...", "options": ["...", "...", "...", "..."], "correct": "B", "explanation": "...", "niche": "${o.lecture.niche}", "topic": "...", "organism_ids": [], "disease_ids": [], "tier": "1", "failure_mode": "...", "bloom": "...", "difficulty": "..."}]`,
    `"correct" is the letter of the right option: A is the first option, B the second, and so on.`,
    ``,
    `Allowed values`,
    `niche (where the pathogen lives): ${list("niche")}`,
    `topic: ${ids("topic")}`,
    `tier: 1 (diagnose and manage independently), 2 (diagnose, start treatment, refer)`,
    `bloom: ${ids("bloom")}`,
    `difficulty: ${ids("difficulty")}`,
    `failure_mode (copy the text exactly, or leave empty): ${ids("failure_mode")}`,
    `organism_ids: ${ids("organism")}`,
    `disease_ids: ${ids("disease") || "(none yet: use [])"}`,
  ].filter((x) => x !== null).join("\n");
}

function parseArray(text: string): any[] {
  let t = String(text || "").replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/gi, "").trim();
  const a = t.indexOf("["), b = t.lastIndexOf("]");
  if (a < 0 || b <= a) throw new Error("The AI did not return a list of questions.");
  t = t.slice(a, b + 1);
  try { return JSON.parse(t); }
  catch { return JSON.parse(t.replace(/,\s*([\]}])/g, "$1")); }   // forgive trailing commas
}

function normalise(x: any, lecture: any, vocab: Vocab) {
  const has = (k: string, id: unknown) => (vocab[k] || []).some((v) => v.id === id);
  const options = Array.isArray(x.options) ? x.options.map((o: any) => String(typeof o === "string" ? o : o && o.text || "").trim()) : [];
  let c = String(x.correct ?? x.correct_option_id ?? "").trim().toUpperCase();
  if (/^[1-5]$/.test(c)) c = LETTERS[+c - 1];
  const pick = (k: string, v: unknown) => (has(k, v) ? v : null);
  return {
    stem: String(x.stem || "").trim(),
    options,
    correct_option_id: c,
    explanation: String(x.explanation || "").trim(),
    niche: has("niche", x.niche) ? x.niche : lecture.niche,
    topic: x.topic,
    lecture_id: lecture.id,
    organism_ids: (Array.isArray(x.organism_ids) ? x.organism_ids : []).filter((id: unknown) => has("organism", id)),
    disease_ids: (Array.isArray(x.disease_ids) ? x.disease_ids : []).filter((id: unknown) => has("disease", id)),
    tier: pick("tier", String(x.tier ?? "")),
    failure_mode: pick("failure_mode", x.failure_mode),
    bloom: pick("bloom", x.bloom),
    difficulty: pick("difficulty", x.difficulty),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign in first." }, 401);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, publishableKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: who, error: whoErr } = await sb.auth.getUser(token);
  if (whoErr || !who?.user) return json({ error: "Your session has expired. Sign in again." }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
  const n = Math.max(1, Math.min(20, Math.round(+body.n || 10)));
  const options = [3, 4, 5].includes(+body.options) ? +body.options : 4;
  const mix = MIXES[body.difficulty] || MIXES.medium;
  const focus = String(body.focus || "").slice(0, 300);
  const source = String(body.source_text || "").replace(/\u0000/g, "").slice(0, MAX_SOURCE);
  const sourceName = String(body.source_name || "").slice(0, 200);

  const { data: ctx, error: beginErr } = await sb.rpc("ai_generation_begin", {
    p_lecture: body.lecture_id || null, p_n: n, p_source: source ? "pdf" : "lecture",
    p_source_name: sourceName || null, p_source_chars: source ? source.length : null,
  });
  if (beginErr) return json({ error: beginErr.message }, 400);

  const model = Deno.env.get("AI_MODEL") || "typhoon-v2.5-30b-a3b-instruct";
  const base = (Deno.env.get("AI_BASE_URL") || "https://api.opentyphoon.ai/v1").replace(/\/+$/, "");
  const finish = (status: string, saved = 0, rejected = 0, error: string | null = null) =>
    sb.rpc("ai_generation_finish", { p_id: ctx.id, p_status: status, p_model: model, p_saved: saved, p_rejected: rejected, p_error: error });

  try {
    const key = Deno.env.get("TYPHOON_API_KEY");
    if (!key) throw new Error("The AI key is not set up yet (TYPHOON_API_KEY in Supabase → Edge Functions → Secrets).");
    if (!source && !String(ctx.lecture.summary || "").trim()) throw new Error("This lecture has no summary yet. Add one, or generate from a PDF.");

    const prompt = buildPrompt({ n, options, mix, focus, lecture: ctx.lecture, vocab: ctx.vocab || {}, source, sourceName });
    const ai = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are a careful medical educator who writes exam questions. You reply with valid JSON only." },
          { role: "user", content: prompt },
        ],
        temperature: 0.4,
        max_tokens: Math.min(16000, 700 * n + 800),
      }),
      signal: AbortSignal.timeout(140_000),
    });
    if (!ai.ok) {
      const detail = (await ai.text()).slice(0, 300);
      throw new Error(ai.status === 429 ? "The AI service is busy (rate limit). Try again in a minute."
        : ai.status === 401 ? "The AI key was refused. Check TYPHOON_API_KEY." : `The AI service returned an error (${ai.status}). ${detail}`);
    }
    const out = await ai.json();
    const text = out?.choices?.[0]?.message?.content || "";
    const items = parseArray(text).slice(0, n).map((x) => normalise(x, ctx.lecture, ctx.vocab || {}));
    if (!items.length) throw new Error("The AI returned no questions.");

    const { data: res, error: impErr } = await sb.rpc("import_questions", { p_items: items, p_source: "ai" });
    if (impErr) throw new Error(impErr.message);
    const saved = (res || []).filter((r: any) => r.ok);
    const rejected = (res || []).filter((r: any) => !r.ok).map((r: any) => ({ index: r.index, stem: items[r.index - 1]?.stem?.slice(0, 120), errors: r.errors }));

    // flag likely duplicates of questions already in the bank
    const duplicates: any[] = [];
    for (const r of saved) {
      const it = items[r.index - 1];
      const { data: sim } = await sb.rpc("similar_stems", { p_stem: it.stem, p_exclude_question: r.question_id });
      if (sim && sim.length) duplicates.push({ question_id: r.question_id, similar_to: sim[0].question_id, score: sim[0].score });
    }

    await finish("done", saved.length, rejected.length);
    return json({ generation_id: ctx.id, model, saved: saved.length, question_ids: saved.map((r: any) => r.question_id),
                  rejected, duplicates, remaining: ctx.remaining });
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "TimeoutError" ? "The AI took too long. Try fewer questions." : e.message) : String(e);
    await finish("failed", 0, 0, msg);
    return json({ error: msg, generation_id: ctx.id }, 502);
  }
});
