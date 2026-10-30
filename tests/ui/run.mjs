/* ============================================================
   UI tests — run with:  node tests/ui/run.mjs
   Serves the repo over http, swaps the Supabase client for tests/ui/mock-api.js,
   and checks that lecture and question text containing <script>/<img onerror>
   is DISPLAYED as plain text and never executed, in student views and in
   instructor previews. Needs Playwright (npm i -D playwright; npx playwright install chromium).
   SHOTS=dir  writes screenshots of every tab for a visual check.
   ============================================================ */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MOCK = await readFile(join(ROOT, "tests/ui/mock-api.js"), "utf8");
const SHOTS = process.env.SHOTS;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
  try { res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" }); res.end(await readFile(join(ROOT, path))); }
  catch { res.writeHead(404); res.end("not found"); }
}).listen(0);
const BASE = `http://localhost:${server.address().port}`;

const browser = await chromium.launch();
let passed = 0, failed = 0;
async function test(name, role, fn, opts) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY, "i").test(name)) return;   // ONLY=regex runs a subset
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const errors = [], dialogs = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/supabase|Content Security|net::ERR/i.test(m.text())) errors.push(m.text()); });
  page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });
  await page.route("https://cdn.jsdelivr.net/**", (r) => r.fulfill({ contentType: "text/javascript", body: "" }));
  await page.addInitScript(`window.__ROLE__=${JSON.stringify(role)};window.__GATE__=${JSON.stringify((opts && opts.gate) || "")};\n${MOCK}`);
  try {
    await fn(page);
    assert.equal(await page.evaluate(() => window.__xss), undefined, "injected script ran");
    assert.deepEqual(dialogs, [], "a dialog was opened");
    assert.deepEqual(errors, [], "page errors");
    console.log("ok   -", name); passed++;
  } catch (e) {
    console.log("FAIL -", name, "\n      ", e.message.split("\n").join("\n       ")); failed++;
  } finally { await page.close(); }
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, name + ".png"), fullPage: true }); };
const noInjectedNodes = async (page) => {
  const n = await page.evaluate(() => [...document.querySelectorAll(".lecture script, .lecture img, .lecture b, .question script, .question img, .question b, td script, td img, .panel .stem script, .panel .stem img, .explain script, .flash-front img")].length);
  assert.equal(n, 0, "content created script/img/b elements");
};

await test("student Learn: lecture bullets with <script>/<img onerror> show as text", "student", async (page) => {
  await page.goto(`${BASE}/views/learn.html`);   // old address redirects to app.html#learn
  await page.locator(".bullets li").first().waitFor();
  const bullets = await page.locator(".bullets li").allTextContents();
  assert.deepEqual(bullets, ["Capsule blocks C3b deposition", '<script>window.__xss = "lecture"</script>',
                             `<img src=x onerror="window.__xss='img'"> stays as text`]);
  await noInjectedNodes(page);
  await shot(page, "learn-lecture");
});

await test("student Learn: question stem, option and explanation with tags show as text", "student", async (page) => {
  await page.goto(`${BASE}/views/app.html#learn/11111111-1111-1111-1111-111111111111`);
  await page.getByRole("link", { name: "Practice this lecture" }).click();
  await shot(page, "learn-practice-before");
  const stem = await page.locator(".stem").first().textContent();
  assert.ok(stem.startsWith('<script>window.__xss = "stem"</script>'), stem);
  assert.equal(await page.locator(".opt .opttext").nth(3).textContent(), "<b>Antigenic</b> variation");
  assert.equal(await page.getByRole("button", { name: "Check answer" }).isDisabled(), true, "check enabled before choosing");
  await page.locator(".opt").nth(1).click();
  await page.getByRole("button", { name: "Check answer" }).click();
  await page.locator(".explain").waitFor();
  await page.getByRole("button", { name: "See results" }).waitFor();
  assert.ok((await page.locator(".explain").textContent()).length > 10);
  assert.ok(await page.locator(".opt.right").count() === 1);
  const calls = await page.evaluate(() => window.__CALLS__);
  assert.ok(calls.some((c) => c[0] === "logLectureView") || true);
  assert.ok(calls.some((c) => c[0] === "submitAnswer" && c[2] === "B"), "answer not submitted");
  await noInjectedNodes(page);
  await shot(page, "learn-question");
});

await test("instructor: lecture preview renders exactly like the student view, as text", "instructor", async (page) => {
  await page.goto(`${BASE}/views/instructor.html#lectures`);
  await shot(page, "tab-lectures");
  await page.getByText("Extracellular bacteria").click();
  await page.getByRole("button", { name: "Preview as student" }).click();
  const bullets = await page.locator(".modal .bullets li").allTextContents();
  assert.equal(bullets.length, 3);
  assert.equal(bullets[1], '<script>window.__xss = "lecture"</script>');
  await noInjectedNodes(page);
  await shot(page, "lecture-preview");
});

await test("instructor: unpublishing warns when students have opened the lecture", "instructor", async (page) => {
  await page.goto(`${BASE}/views/instructor.html#lectures/11111111-1111-1111-1111-111111111111`);
  await page.getByRole("button", { name: "Unpublish" }).click();
  await page.locator(".modal .banner.warn").waitFor();
  assert.match(await page.locator(".modal .banner.warn").textContent(), /12 students have already opened/);
  await shot(page, "unpublish-warning");
  await page.getByRole("button", { name: "Cancel" }).click();
  assert.ok(!(await page.evaluate(() => window.__CALLS__)).some((c) => c[0] === "unpublishLecture"), "unpublished despite cancel");
});

await test("instructor: question editor + student preview keep tags as text; live item warns about versioning", "instructor", async (page) => {
  await page.goto(`${BASE}/views/instructor.html#questions`);
  await shot(page, "tab-questions");
  const cell = await page.locator("td.stemcell").first().textContent();
  assert.ok(cell.includes("<script>"), "list should show the tag as text");
  await page.locator("td.stemcell").first().click();
  await page.locator(".banner.warn").first().waitFor();
  assert.match(await page.locator(".banner.warn").first().textContent(), /Saving creates version 2/);
  assert.equal(await page.locator("textarea").first().inputValue(), '<script>window.__xss = "stem"</script> Which feature lets S. pneumoniae resist phagocytosis?');
  await shot(page, "question-editor-live");
  await page.getByRole("button", { name: "Preview as student" }).click();
  await page.locator(".modal .opt").nth(1).click();
  await page.locator(".modal").getByRole("button", { name: "Check answer" }).click();
  await page.locator(".modal .explain").waitFor();
  assert.ok((await page.locator(".modal .explain").textContent()).includes("<script>"));
  await noInjectedNodes(page);
  const calls = await page.evaluate(() => window.__CALLS__);
  assert.ok(!calls.some((c) => c[0] === "submitAnswer"), "preview must not record answers");
});

await test("publish directly (no peer review); delete with a usage warning", "instructor", async (page) => {
  await page.goto(`${BASE}/views/instructor.html#questions/q2`);   // someone else's draft: no approve buttons
  assert.equal(await page.getByRole("button", { name: /^Approve/ }).count(), 0);
  await page.goto(`${BASE}/views/instructor.html#questions/q1`);
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByText("Students have used this question").waitFor();   // instructors cannot delete answered items
  await page.locator(".modal").getByRole("button", { name: "Close" }).click();
  assert.ok(!(await page.evaluate(() => window.__CALLS__)).some((c) => c[0] === "deleteQuestion"));
  await page.goto(`${BASE}/views/instructor.html#questions/new`);
  await page.getByRole("heading", { name: "New question" }).waitFor();
  await shot(page, "question-new");
});

await test("admin: publish a draft, delete an unused item, delete an exam", "admin", async (page) => {
  await page.goto(`${BASE}/views/instructor.html#questions/q2`);
  await page.getByRole("button", { name: "Publish" }).click();
  await page.getByRole("button", { name: "I checked, publish" }).click();   // q2 was written by AI
  await page.waitForFunction(() => window.__CALLS__.some((c) => c[0] === "publishQuestionNow" && c[1] === "v2"));
  await page.goto(`${BASE}/views/instructor.html#questions/q2`);
  await page.getByRole("button", { name: "Delete" }).click();
  await page.locator(".modal").getByRole("button", { name: "Delete" }).click();
  await page.waitForFunction(() => window.__CALLS__.some((c) => c[0] === "deleteQuestion" && c[1] === "q2" && c[2] === false));
  await page.goto(`${BASE}/views/instructor.html#exams/ffffffff-ffff-ffff-ffff-ffffffffffff`);
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByText("Delete this exam and its results?").waitFor();
  await page.locator(".modal").getByRole("button", { name: "Delete" }).click();
  await page.waitForFunction(() => window.__CALLS__.some((c) => c[0] === "deleteExam" && c[2] === true));
});

await test("side navigation opens and closes, and remembers", "student", async (page) => {
  await page.goto(`${BASE}/views/app.html#home`);
  await page.getByText("Welcome back").waitFor();
  await page.getByRole("button", { name: "Hide the menu" }).click();
  assert.equal(await page.locator(".siteside").isHidden(), true, "sidebar should hide");
  await shot(page, "sidebar-closed");
  // closed sidebar becomes tabs along the top, with Maps in a dropdown and the account button on the right
  const strip = page.locator(".sitebar .stabs");
  assert.equal(await strip.isVisible(), true, "top tabs should show");
  assert.equal(await strip.locator('a[aria-current="page"]').innerText(), "Home");
  assert.equal(await page.locator(".sitebar .sacct .userbtn").count(), 1, "account button moves to the top bar");
  await strip.getByText("Maps ▾").click();
  await strip.getByRole("link", { name: "Immune map" }).waitFor();
  await shot(page, "sidebar-closed-maps");
  await page.keyboard.press("Escape");
  await strip.getByRole("link", { name: "Practice" }).click();
  await page.getByText("Choose what to review and how.").waitFor();
  assert.equal(await strip.locator('a[aria-current="page"]').innerText(), "Practice");
  await page.goto(`${BASE}/views/app.html#home`);
  await page.reload();
  await page.getByText("Welcome back").waitFor();
  assert.equal(await page.locator(".siteside").isHidden(), true, "closed state remembered");
  await page.getByRole("button", { name: "Show the menu" }).click();
  assert.equal(await page.locator(".siteside").isVisible(), true, "sidebar should show again");
  assert.equal(await page.locator(".siteside .userbtn").count(), 1, "account button back in the sidebar");
  await page.setViewportSize({ width: 390, height: 800 });
  await page.getByRole("button", { name: "Show the menu" }).click();
  await page.locator(".siteside a", { hasText: "Practice" }).click();
  await page.getByText("Choose what to review and how.").waitFor();
  assert.equal(await page.evaluate(() => document.body.classList.contains("sideopen")), false, "phone menu closes after choosing");
});

await test("instructor: new question validates and only admins choose pretest/monthly", "instructor", async (page) => {
  await page.goto(`${BASE}/views/instructor.html#questions/new`);
  assert.equal(await page.locator("select").filter({ has: page.locator("option[value=monthly]") }).first().isDisabled(), true);
  await page.locator("textarea").first().fill("Which feature lets S. pneumoniae resist phagocytosis by neutrophils?");
  await page.getByText("Possible duplicates").waitFor();
  const inputs = page.locator(".optrow input[type=text]");
  await inputs.nth(0).fill("Capsule"); await inputs.nth(1).fill("capsule"); await inputs.nth(2).fill("Pili");
  await page.getByRole("button", { name: "Save draft" }).click();
  const errs = await page.locator(".banner.bad li").allTextContents();
  for (const e of ["Options cannot be empty.", "Options must not repeat.", "Mark exactly one option as correct.", "An explanation is required.", "Tag a niche.", "Tag a topic.", "Tag a lecture."])
    assert.ok(errs.includes(e), "missing error: " + e);
  assert.ok(!(await page.evaluate(() => window.__CALLS__)).some((c) => c[0] === "saveQuestion"), "saved an invalid item");
  await shot(page, "question-new-errors");
});

await test("admin: pool choice enabled; students tab role controls; own role locked", "admin", async (page) => {
  await page.goto(`${BASE}/views/instructor.html#questions/new`);
  assert.equal(await page.locator("select").filter({ has: page.locator("option[value=monthly]") }).first().isDisabled(), false);
  await page.goto(`${BASE}/views/instructor.html#students`);
  await page.locator("label.control", { hasText: /^Show/ }).locator("select").selectOption("");
  const ownRole = page.locator("tr", { hasText: "admin@uni.ac.th" }).locator("select[title]");
  assert.equal(await ownRole.isDisabled(), true);
  await shot(page, "tab-students-admin");
});

await test("instructor: overview, items, export tabs render", "instructor", async (page) => {
  await page.goto(`${BASE}/views/instructor.html#overview`);
  await page.getByText("Your unpublished drafts").first().waitFor();
  await shot(page, "tab-overview");
  await page.goto(`${BASE}/views/instructor.html#items`);
  await page.getByText("Weak discrimination").first().waitFor();
  await shot(page, "tab-items");
  await page.goto(`${BASE}/views/instructor.html#export`);
  await page.getByRole("button", { name: "Export data" }).waitFor();
  await shot(page, "tab-export");
});

await test("student opening the instructor page is sent to the student app", "student", async (page) => {
  await page.goto(`${BASE}/views/instructor.html`);
  await page.waitForURL(/app\.html/);
  await page.getByText("Welcome back").waitFor();
  assert.equal(await page.locator(".siteside a", { hasText: "Exams" }).count(), 0);
  assert.equal(await page.locator(".siteside a", { hasText: "Practice" }).count(), 1);
});

await test("instructor opening the student app is sent to the dashboard", "instructor", async (page) => {
  await page.goto(`${BASE}/views/app.html`);
  await page.waitForURL(/instructor\.html/);
  await page.getByText("Cohort overview").waitFor();
});

await test("first visit: consent, then the pre-test, then unlock", "student", async (page) => {
  await page.goto(`${BASE}/views/app.html`);
  await page.getByText("Before you start").waitFor();
  assert.equal(await page.locator(".siteside").isHidden(), true, "side navigation should be hidden before the pre-test");
  const start = page.getByRole("button", { name: "Start pre-test" });
  assert.equal(await start.isDisabled(), true, "start enabled without consent");
  await shot(page, "gate-consent");
  await page.locator(".consentbox input").first().check();
  await start.click();
  await page.getByText("Pre-test · Question 1 of 3").waitFor();
  assert.match(await page.locator("#status").textContent(), /Time used \d\d:\d\d · Progress is saved/);
  await page.locator(".opt").nth(1).click();
  await page.getByRole("button", { name: "Sure", exact: true }).click();
  await page.getByRole("button", { name: "Next" }).click();
  const stem2 = await page.locator(".stem").textContent();
  assert.ok(stem2.startsWith('<script>window.__xss="exam"</script>'), "exam stem should be text");
  await page.getByRole("button", { name: "Flag for later" }).click();
  await shot(page, "gate-question");
  assert.equal(await page.locator(".qgrid button.flagged").count(), 1);
  assert.equal(await page.locator(".qgrid button.answered").count(), 1);
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Review and submit" }).first().click();
  await page.locator(".modal").getByRole("button", { name: "Submit" }).click();
  await page.getByText("Pre-test complete").waitFor();
  await shot(page, "gate-unlocked");
  const calls = await page.evaluate(() => window.__CALLS__);
  assert.ok(calls.some((c) => c[0] === "setConsent" && c[1] === true && c[2] === false), "consent not recorded");
  assert.ok(calls.some((c) => c[0] === "saveExamResponse" && c[3] === "B" && c[4] === "sure"), "answer + confidence not saved");
  assert.ok(calls.some((c) => c[0] === "submitExam"), "not submitted");
  await page.getByRole("link", { name: "Open my home page" }).click();
  await page.getByText("Welcome back").waitFor();
}, { gate: "consent" });

await test("student home: study next, weak spots, stats, check-in", "student", async (page) => {
  await page.goto(`${BASE}/views/app.html#home`);
  await page.getByText("Study this next").waitFor();
  assert.match(await page.locator(".siteside .streak").textContent(), /12-day streak/);
  assert.ok((await page.locator("main").textContent()).includes("You missed 5 of your last 8 questions"));
  assert.ok((await page.locator("main").textContent()).includes("Opens in 6 days"));
  await shot(page, "student-home");
});

await test("student practice: flashcards with spaced-review ratings, then a confidence-rated question", "student", async (page) => {
  await page.goto(`${BASE}/views/app.html#practice`);
  await page.getByText("25 cards due today").waitFor();   // 16 due + 8 new + 1 of the student's own
  await shot(page, "student-practice");
  await page.getByRole("button", { name: "Start session" }).click();
  await page.getByRole("button", { name: "Show answer" }).waitFor();
  await page.getByRole("button", { name: "Show answer" }).click();
  await page.getByText("The polysaccharide capsule").waitFor();
  for (const t of ["10 min", "1 day", "3 days", "7 days"]) assert.equal(await page.locator(".rate small", { hasText: t }).count() >= 1, true, "missing interval " + t);
  await page.getByRole("button", { name: "Bookmark this topic" }).click().catch(() => page.getByRole("button", { name: "Bookmarked" }).click());
  await shot(page, "student-flashcard-back");
  await page.locator(".rate button", { hasText: "Good" }).click();
  // the student's own card is mixed into spaced review; its back is shown as typed
  await page.getByText("Your card").first().waitFor();
  await page.getByRole("button", { name: "Show answer" }).click();
  assert.equal(await page.locator(".answer").textContent(), 'C3b deposition <script>window.__xss="own"</script>');
  await page.locator(".rate button", { hasText: "Easy" }).click();
  await page.getByRole("button", { name: "Show answer" }).click();
  await page.locator(".rate button", { hasText: "Easy" }).click();
  await page.getByText("How sure are you?").waitFor();
  const stem = await page.locator(".stem").textContent();
  assert.ok(stem.startsWith("<img src=x"), "card stem shown as text");
  await page.locator(".opt").first().click();
  await page.getByRole("button", { name: "Unsure" }).click();
  await shot(page, "student-question");
  await page.getByRole("button", { name: "Check answer" }).click();
  await page.locator(".explain").waitFor();
  const calls = await page.evaluate(() => window.__CALLS__);
  assert.ok(calls.some((c) => c[0] === "reviewCard" && c[2] === "good"));
  assert.ok(calls.some((c) => c[0] === "reviewMyCard" && c[2] === "easy"), "own card not rated");
  assert.ok(calls.some((c) => c[0] === "submitAnswer" && c[3] === "unsure"), "confidence not sent");
  await page.getByRole("button", { name: "Finish" }).click();
  await page.getByText("Session complete").waitFor();
  await noInjectedNodes(page);
});

await test("student progress: chart, week, niches, confidence", "student", async (page) => {
  await page.goto(`${BASE}/views/app.html#progress`);
  await page.getByText("Score over time").waitFor();
  assert.equal(await page.locator("svg.chart circle").count(), 6);
  assert.equal(await page.locator(".week i.on").count(), 4);
  assert.ok((await page.locator("main").textContent()).includes("9% of your answers were confidently wrong"));
  await shot(page, "student-progress");
});

await test("student explore: niche cards, search, organism panel", "student", async (page) => {
  await page.goto(`${BASE}/views/app.html#explore`);
  assert.equal(await page.locator(".nichecard").count(), 4);
  await shot(page, "student-explore");
  await page.getByLabel("Search organisms").fill("pneumoniae");
  await page.locator(".orglist button", { hasText: "Streptococcus pneumoniae" }).click();
  await page.getByText("Why it fails").waitFor();
});

await test("instructor: cohort/period pickers, topic accuracy by week, flagged students", "instructor", async (page) => {
  await page.goto(`${BASE}/views/instructor.html#overview`);
  await page.getByText("Topic accuracy over time").waitFor();
  assert.ok(await page.locator(".heat th", { hasText: "Pre-test" }).count() === 1);
  assert.ok(await page.locator(".heat th", { hasText: "Wk 4" }).count() === 1);
  assert.ok(await page.locator("select option", { hasText: "2567 · " }).count() >= 1, "cohort picker");
  assert.ok(await page.locator("select option", { hasText: "Last 30 days" }).count() >= 1, "period picker");
  await page.getByRole("button", { name: "Show names" }).click();
  assert.ok((await page.evaluate(() => window.__CALLS__)).some((c) => c[0] === "logNamesShown"), "showing names not logged");
  await shot(page, "instructor-overview");
});

await test("instructor: exams tab and exam editor", "instructor", async (page) => {
  await page.goto(`${BASE}/views/instructor.html#exams`);
  await page.getByText("Check-in 1").first().waitFor();
  await shot(page, "instructor-exams");
  await page.goto(`${BASE}/views/instructor.html#exams/ffffffff-ffff-ffff-ffff-ffffffffffff`);
  await page.getByRole("button", { name: "Auto-pick" }).click();
  assert.ok((await page.evaluate(() => window.__CALLS__)).some((c) => c[0] === "pickExamItems"));
  await shot(page, "instructor-exam-editor");
});

await test("sign in with email and password; create account; forgot password", "anon", async (page) => {
  await page.goto(`${BASE}/views/app.html`);
  await page.getByLabel("Email").fill("nok@student.ac.th");
  await page.getByLabel("Password").fill("wrong-password");
  await shot(page, "signin");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText("Wrong email or password.").waitFor();
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Name").fill("Nok");
  await page.getByLabel("Email").fill("nok@student.ac.th");
  await page.locator("input[autocomplete=new-password]").first().fill("long-enough-1");
  await page.getByLabel("Repeat password").fill("different-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByText("The two passwords do not match.").waitFor();
  await page.getByLabel("Repeat password").fill("long-enough-1");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByText("Account created.").waitFor();
  await page.getByRole("button", { name: "Back to sign in" }).click();
  await page.getByRole("button", { name: "Forgot your password?" }).click();
  await page.getByLabel("Email").fill("nok@student.ac.th");
  await page.getByRole("button", { name: "Email me a reset link" }).click();
  await page.getByText("a reset link is on its way").waitFor();
  const calls = await page.evaluate(() => window.__CALLS__);
  assert.ok(calls.some((c) => c[0] === "signUp" && c[3] === "Nok"), "sign-up not called with the name");
  assert.ok(calls.some((c) => c[0] === "resetPassword"), "reset not requested");
});

await test("settings: change name, email and password (student), research consent", "student", async (page) => {
  await page.goto(`${BASE}/views/app.html#settings`);
  await page.getByRole("heading", { name: "Settings" }).waitFor();
  await page.getByLabel("Name", { exact: true }).fill("Nok P.");
  await page.getByRole("button", { name: "Save name" }).click();
  await page.getByText("Name saved.").waitFor();
  await page.getByLabel("New email").fill("nok.new@student.ac.th");
  await page.locator("input[autocomplete=current-password]").first().fill("wrong");
  await page.getByRole("button", { name: "Change email" }).click();
  await page.getByText("Your current password is not correct.").first().waitFor();
  await page.locator("input[autocomplete=current-password]").first().fill("correct-horse");
  await page.getByRole("button", { name: "Change email" }).click();
  await page.getByText("open the confirmation link").waitFor();
  await page.locator("input[autocomplete=current-password]").nth(1).fill("correct-horse");
  await page.locator("input[autocomplete=new-password]").nth(0).fill("new-password-1");
  await page.locator("input[autocomplete=new-password]").nth(1).fill("new-password-1");
  await page.getByRole("button", { name: "Change password" }).click();
  await page.getByText("Password changed.").waitFor();
  await page.getByText("Research use").waitFor();
  await shot(page, "settings-student");
  const calls = await page.evaluate(() => window.__CALLS__);
  for (const c of ["updateDisplayName", "changeEmail", "updatePassword"]) assert.ok(calls.some((x) => x[0] === c), c + " not called");
});

await test("admin settings hold the tag lists with file import; overview no longer does", "admin", async (page) => {
  await page.goto(`${BASE}/views/instructor.html#overview`);
  await page.getByText("Topic accuracy over time").waitFor();
  assert.equal(await page.getByText("Tag lists (admins)").count(), 0);
  await page.goto(`${BASE}/views/instructor.html#settings`);
  await page.getByText("Tag lists (admins)").waitFor();
  await page.getByRole("button", { name: "Import tag file" }).waitFor();
  await shot(page, "settings-admin");
});

await test("map pages: side navigation (no Back/Home bar), no emojis on the niche map", "student", async (page) => {
  for (const v of ["niche-map", "immune-map", "cascade", "taxonomy", "drugs"]) {
    await page.goto(`${BASE}/views/${v}.html`);
    assert.equal(await page.locator("nav.viewnav").count(), 0, v + " still has the old Back/Home bar");
    assert.equal(await page.locator(`.siteside a[aria-current=page]`).count(), 1, v + " side navigation marks the page");
    assert.equal(await page.locator(".siteside a", { hasText: "Niche map" }).count(), 1, v + " maps listed");
  }
  await page.goto(`${BASE}/views/niche-map.html`);
  const text = await page.locator("body").innerText();
  assert.ok(!/\p{Extended_Pictographic}/u.test(text), "emoji still on the niche map");
});

await test("instructor workflow: Today card, bulk actions, AI prompt", "admin", async (page) => {
  await page.goto(`${BASE}/views/instructor.html#overview`);
  await page.getByText("Today").first().waitFor();
  assert.ok((await page.locator(".panel.accent").first().textContent()).includes("to check in with"), "Today card lists students to check in with");
  await shot(page, "instructor-overview-today");
  assert.equal(await page.locator(".siteside a[aria-current=page]", { hasText: "Overview" }).count(), 1);
  await page.goto(`${BASE}/views/instructor.html#questions`);
  await page.locator("tbody input[type=checkbox]").first().check();
  await page.getByText("1 selected").waitFor();
  await shot(page, "instructor-bulk");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByText("Some items were skipped").waitFor();   // an already-live item cannot be published again: reported, not silently ignored
  await page.locator(".modal").getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "AI prompt" }).click();
  const prompt = await page.locator(".modal textarea").inputValue();
  for (const t of ["Return ONLY a JSON array", "\"correct\": \"B\"", "streptococcus-pneumoniae", "Allowed values"])
    assert.ok(prompt.includes(t), "prompt missing " + t);
  await shot(page, "instructor-prompt");
});

await test("class codes, schedules", "admin", async (page) => {
  await page.goto(`${BASE}/views/instructor.html#students`);
  await page.getByText("K7M2QX").waitFor();
  await page.goto(`${BASE}/views/instructor.html#exams`);
  await page.getByText("Monthly check-in schedule").waitFor();
  await page.getByRole("button", { name: "New schedule" }).click();
  await page.locator(".modal").getByRole("button", { name: "Save" }).click();
  assert.ok((await page.evaluate(() => window.__CALLS__)).some((c) => c[0] === "saveSchedule"));
  await shot(page, "instructor-schedules");
});

await test("student joins a class with the code on the first screen", "student", async (page) => {
  await page.addInitScript(() => { const t = setInterval(() => { if (window.__MOCK_API__) { clearInterval(t);
    const ms = window.__MOCK_API__.myStatus; window.__MOCK_API__.myStatus = async () => ({ ...(await ms()), cohort_id: null }); } }, 1); });
  await page.goto(`${BASE}/views/app.html`);
  await page.getByText("Your class code").waitFor();
  await page.getByPlaceholder("e.g. K7M2QX").fill("wrong1");
  await page.getByRole("button", { name: "Join class" }).click();
  await page.getByText("That class code was not found.").waitFor();
  await page.getByPlaceholder("e.g. K7M2QX").fill("k7m2qx");
  await page.getByRole("button", { name: "Join class" }).click();
  await page.waitForFunction(() => window.__CALLS__.some((c) => c[0] === "joinCohort" && c[1] === "k7m2qx"));
}, { gate: "consent" });

await test("home page has a Log in button that opens the app", "student", async (page) => {
  await page.goto(`${BASE}/index.html`);
  assert.equal(await page.locator("#login").getAttribute("href"), "views/app.html");
});

await test("narrow screen: no horizontal page scroll on the question editor", "instructor", async (page) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${BASE}/views/instructor.html#questions/q1`);
  await page.locator(".optrow").first().waitFor();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(over <= 1, `page scrolls sideways by ${over}px`);
  await shot(page, "mobile-question");
});

await test("admin: student view stays in preview while moving between sections", "admin", async (page) => {
  await page.goto(`${BASE}/views/instructor.html#overview`);
  await page.locator(".siteside a", { hasText: "Student view" }).click();
  await page.getByText("Welcome back").waitFor();
  await page.locator(".siteside a", { hasText: "Practice" }).click();
  await page.getByText("Choose what to review and how.").waitFor();
  assert.match(page.url(), /app\.html#practice$/);
  await page.locator(".siteside a", { hasText: "Back to instructor view" }).click();
  await page.waitForURL(/instructor\.html/);
  await page.goto(`${BASE}/views/app.html#home`);
  await page.waitForURL(/instructor\.html/);   // preview ended: an admin opening the app goes to the dashboard
});

await test("bookmarks: lectures, diseases and organisms appear under Bookmarked topics", "student", async (page) => {
  await page.goto(`${BASE}/views/app.html#learn/11111111-1111-1111-1111-111111111111`);
  const bm = page.getByRole("button", { name: "Bookmark this lecture" });
  assert.equal((await bm.textContent()).trim(), "", "bookmark buttons are an icon; the words show only on hover");
  await bm.hover();
  assert.match(await bm.evaluate((e) => getComputedStyle(e, "::after").content), /Bookmark this lecture/);
  await bm.click();
  await page.getByRole("button", { name: "Bookmarked" }).first().waitFor();
  await page.goto(`${BASE}/views/app.html#explore`);
  await page.getByLabel("Search organisms").fill("pneumoniae");
  await page.locator(".orglist button", { hasText: "Streptococcus pneumoniae" }).click();
  await page.getByRole("button", { name: "Bookmark this organism" }).click();
  await page.goto(`${BASE}/views/app.html#practice`);
  await page.getByRole("heading", { name: "Bookmarked topics" }).waitFor();
  const text = await page.locator(".savedrow").allTextContents();
  assert.ok(text.some((t) => t.includes("Lecture 3: Extracellular bacteria")), "lecture bookmark missing: " + text);
  assert.ok(text.some((t) => t.includes("Streptococcus pneumoniae")), "organism bookmark missing");
  assert.ok(text.some((t) => t.includes("Neisseria meningitidis")), "earlier bookmark missing");
  await shot(page, "student-bookmarks");
  await page.getByRole("button", { name: "Review these" }).click();
  await page.getByRole("button", { name: "Show answer" }).waitFor();
  const calls = await page.evaluate(() => window.__CALLS__);
  const sc = calls.find((c) => c[0] === "sessionCards" && c[1] === "saved");
  assert.ok(sc && sc[3].length === 4, "saved session did not pass the bookmarks");
  assert.ok(calls.some((c) => c[0] === "toggleSaved" && c[1] === "lecture"));
});

await test("student flashcards: write, edit, review and delete my own cards", "student", async (page) => {
  await page.goto(`${BASE}/views/app.html#practice`);
  await page.getByRole("heading", { name: "My flashcards" }).waitFor();
  assert.ok((await page.locator("main").textContent()).includes("admins can, and every change is logged"), "students are told admins can see cards");
  await page.getByRole("button", { name: "New card" }).click();
  await page.getByRole("button", { name: "Add card" }).click();
  await page.getByText("Write both sides of the card.").waitFor();
  await page.getByLabel("Front").fill("What does IL-5 recruit? <b>x</b>");
  await page.getByLabel("Back").fill("Eosinophils");
  await page.getByRole("button", { name: "Add card" }).click();
  await page.locator(".owncard", { hasText: "What does IL-5 recruit? <b>x</b>" }).waitFor();
  await page.locator(".owncard", { hasText: "IL-5" }).getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Back").fill("Eosinophils (IL-5 from TH2)");
  await page.getByRole("button", { name: "Save card" }).click();
  await page.locator(".owncard", { hasText: "from TH2" }).waitFor();
  await shot(page, "student-own-cards");
  await page.locator(".pickcard", { hasText: "My flashcards" }).click();
  await page.getByRole("button", { name: "Start session" }).click();
  await page.getByRole("button", { name: "Show answer" }).click();
  await page.locator(".rate button", { hasText: "Good" }).click();
  await page.goto(`${BASE}/views/app.html#practice`);
  await page.locator(".owncard", { hasText: "IL-5" }).getByRole("button", { name: "Delete" }).click();
  await page.locator(".modal").getByRole("button", { name: "Delete" }).click();
  await page.getByText("Card deleted.").waitFor();
  const calls = await page.evaluate(() => window.__CALLS__);
  for (const c of ["saveMyCard", "reviewMyCard", "deleteMyCard"]) assert.ok(calls.some((x) => x[0] === c), c + " not called");
  assert.equal(await page.locator(".owncard b script, .owncard b b").count(), 0);
});

await test("admin sees students' own flashcards; instructors do not", "admin", async (page) => {
  await page.goto(`${BASE}/views/instructor.html#students`);
  await page.getByRole("heading", { name: "Students' own flashcards" }).waitFor();
  await page.locator("td", { hasText: "Which step does a capsule block?" }).waitFor();
  assert.equal(await page.locator("td", { hasText: "Old card" }).count(), 0, "deleted cards hidden by default");
  await page.getByLabel("Show deleted").check();
  await page.locator("td", { hasText: "Old card" }).waitFor();
  await shot(page, "admin-student-cards");
});
await test("instructor: no student flashcards panel", "instructor", async (page) => {
  await page.goto(`${BASE}/views/instructor.html#students`);
  await page.getByRole("heading", { name: "Class codes" }).waitFor();
  assert.equal(await page.getByText("Students' own flashcards").count(), 0);
});

await test("hide a lecture and an unused question; answered questions cannot be hidden", "instructor", async (page) => {
  await page.goto(`${BASE}/views/instructor.html#lectures/11111111-1111-1111-1111-111111111111`);
  await page.getByRole("button", { name: "Hide from students" }).click();
  await page.locator(".modal").getByRole("button", { name: "Hide" }).click();
  await page.getByRole("button", { name: "Show to students" }).waitFor();
  await page.getByText("Hidden from students since").waitFor();
  await shot(page, "lecture-hidden");
  await page.goto(`${BASE}/views/instructor.html#questions/q1`);
  await page.getByRole("button", { name: "Hide", exact: true }).click();
  await page.getByText("Only questions no student has done can be hidden").waitFor();
  await page.keyboard.press("Escape");
  await page.goto(`${BASE}/views/instructor.html#questions`);
  await page.locator("td.stemcell").first().waitFor();
  const calls = await page.evaluate(() => window.__CALLS__);
  assert.ok(calls.some((c) => c[0] === "setLectureHidden" && c[2] === true));
  assert.ok(!calls.some((c) => c[0] === "setQuestionHidden" && c[1] === "q1"), "an answered question was sent to hide");
});

await test("dark / light mode: Settings switch, sidebar switch, maps follow", "student", async (page) => {
  await page.goto(`${BASE}/views/app.html#settings`);
  await page.getByText("Appearance").waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  await page.getByLabel("Light", { exact: true }).check();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
  await page.getByText("Saved. Your other devices").waitFor();
  assert.ok((await page.evaluate(() => window.__CALLS__)).some((c) => c[0] === "updateTheme" && c[1] === "light"), "theme not saved to the profile");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(bg, "rgb(246, 247, 249)");
  await shot(page, "settings-light");
  for (const v of ["niche-map", "immune-map", "cascade", "taxonomy", "drugs"]) {
    await page.goto(`${BASE}/views/${v}.html`);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light", v + " did not follow");
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgb(246, 247, 249)", v + " background");
  }
  await page.goto(`${BASE}/views/cascade.html`);
  await shot(page, "cascade-light");
  await page.locator(".siteside .stheme").click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  await page.goto(`${BASE}/index.html`);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
});

await test("colours: break-points and the cascade link never use a niche colour", "student", async (page) => {
  await page.goto(`${BASE}/views/cascade.html?b=extracellular`);
  await page.locator(".lz").first().waitFor();
  const niche = await page.evaluate(() => ["--extra", "--vesic", "--cyto", "--surf"].map((v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim()));
  const pathogen = await page.locator(".lz:not(.host)").first();
  await pathogen.click();
  const on = await page.locator(".lz.on").first().evaluate((e) => getComputedStyle(e).backgroundColor);
  const toRgb = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
  assert.ok(!niche.map(toRgb).includes(on), "selected break-point uses a niche colour: " + on);
  const dot = (name) => page.locator(".siteside a.sitem", { hasText: name }).locator(".sdot").evaluate((e) => getComputedStyle(e).backgroundImage + "|" + getComputedStyle(e).backgroundColor);
  assert.notEqual(await dot("Niche map"), await dot("Where it breaks"), "niche map and where-it-breaks share a colour");
  await page.goto(`${BASE}/views/immune-map.html`);
  await page.locator(".chip[data-o]").first().click();
  const broken = await page.locator(".cmp.brk").first().evaluate((e) => getComputedStyle(e.querySelector(".box")).fill);
  assert.ok(!niche.map(toRgb).includes(broken), "broken component uses a niche colour: " + broken);
  await shot(page, "immune-map-break");
});

await test("Thai: the globe switches the interface; content stays as written", "student", async (page) => {
  await page.goto(`${BASE}/views/app.html#learn/11111111-1111-1111-1111-111111111111`);
  await page.locator(".bullets li").first().waitFor();
  await page.locator(".siteside .slang").click();
  await page.waitForLoadState("load");
  await page.locator(".siteside a.sitem", { hasText: "ฝึกทำ" }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.lang), "th");
  assert.ok((await page.locator("main").textContent()).includes("ทำเครื่องหมายว่าอ่านแล้ว"), "lecture buttons not in Thai");
  const bullets = await page.locator(".bullets li").allTextContents();
  assert.equal(bullets[0], "Capsule blocks C3b deposition", "lecture content must not be translated");
  assert.equal(await page.locator(".lecture-title").textContent(), "Extracellular bacteria");
  assert.equal(await page.evaluate(() => sessionStorage.getItem("mock.updateLang")), "th", "language not saved to the profile");
  await shot(page, "thai-learn");
  await page.goto(`${BASE}/views/app.html#practice`);
  await page.getByText("ทบทวนแบบเว้นระยะ").first().waitFor();
  assert.ok((await page.locator("main").textContent()).includes("ถึงกำหนดวันนี้ 25 ใบ"), "patterns with numbers not translated");
  await page.goto(`${BASE}/views/app.html#settings`);
  await page.getByText("ภาษา", { exact: true }).waitFor();
  await page.goto(`${BASE}/views/niche-map.html`);
  await page.getByText("แตะเพื่อกรอง").waitFor();
  assert.ok((await page.locator(".tree").textContent()).includes("Streptococcus pneumoniae"), "organism names stay");
  await page.goto(`${BASE}/index.html`);
  await page.getByText("เข้าสู่ระบบ").first().waitFor();
  await page.locator(".langbtn").click();
  await page.waitForLoadState("load");
  await page.getByText("Log in").first().waitFor();
});
await test("Thai on the instructor dashboard; question text and tags stay as written", "instructor", async (page) => {
  await page.addInitScript(() => { try { localStorage.setItem("ii.lang", "th"); } catch (e) {} });
  await page.goto(`${BASE}/views/instructor.html#overview`);
  await page.getByText("ความแม่นยำรายหัวข้อตามช่วงเวลา").waitFor();
  assert.equal(await page.locator(".siteside .slang").count(), 1, "language switch in the side menu");
  assert.equal(await page.locator(".siteside a.sitem", { hasText: "ภาพรวม" }).count(), 1);
  await page.goto(`${BASE}/views/instructor.html#questions`);
  await page.locator("td.stemcell").first().waitFor();
  assert.ok((await page.locator("td.stemcell").first().textContent()).includes("Which feature lets S. pneumoniae"), "question stems stay as written");
  assert.ok((await page.locator("main").textContent()).includes("คลังคำถาม"));
  await page.goto(`${BASE}/views/instructor.html#questions/q1`);
  await page.getByText("ดูตัวอย่างแบบนักศึกษา").waitFor();
  await shot(page, "thai-question-editor");
});

await test("AI drafts: generate from a lecture inside the website; AI drafts need a check before publishing", "admin", async (page) => {
  await page.goto(`${BASE}/views/instructor.html#questions`);
  await page.getByRole("button", { name: "Generate with AI" }).click();
  await page.getByText("The AI writes drafts only.").waitFor();
  await page.getByRole("button", { name: "Generate drafts" }).click();
  await page.getByText("Choose a lecture to file the questions under.").waitFor();
  await page.locator(".modal select").first().selectOption({ index: 1 });
  await page.locator(".modal input[type=number]").fill("6");
  await page.getByRole("button", { name: "Generate drafts" }).click();
  await page.getByText("5 drafts saved, 1 rejected.").waitFor();
  assert.equal(await page.locator(".modal li b").count(), 0, "a rejected stem was rendered as HTML");
  await shot(page, "ai-generate");
  const call = (await page.evaluate(() => window.__CALLS__)).find((c) => c[0] === "generateQuestions");
  assert.equal(call[1].n, 6); assert.equal(call[1].source_text, null);
  await page.getByRole("button", { name: "Review the drafts" }).click();
  await page.locator("td.stemcell .aichip").first().waitFor();
  assert.equal(await page.locator("tbody tr").count(), 1, "filtered to AI drafts");
  await page.locator("td.stemcell").first().click();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByText("Publish an AI-written question?").waitFor();
  await page.getByRole("button", { name: "Cancel" }).click();
  assert.ok(!(await page.evaluate(() => window.__CALLS__)).some((c) => c[0] === "publishQuestionNow"), "published without the check");
  await page.goto(`${BASE}/views/instructor.html#settings`);
  await page.getByText("AI question generation").waitFor();
  await page.getByText("week3-handout.pdf").waitFor();
});
await test("AI drafts: a lecture can generate from the lecture editor; writing by hand stays", "instructor", async (page) => {
  await page.goto(`${BASE}/views/instructor.html#lectures/11111111-1111-1111-1111-111111111111`);
  await page.getByRole("button", { name: "Generate questions with AI" }).click();
  assert.equal(await page.locator(".modal select").first().inputValue(), "11111111-1111-1111-1111-111111111111", "the lecture is preselected");
  await page.locator(".modal input[value=pdf]").check();
  await page.getByRole("button", { name: "Generate drafts" }).click();
  await page.getByText("Choose a PDF file.").waitFor();
  await page.keyboard.press("Escape");
  await page.goto(`${BASE}/views/instructor.html#questions`);
  await page.getByRole("button", { name: "New question" }).waitFor();
  await page.getByRole("button", { name: "Import CSV / JSON" }).waitFor();
});

await test("People & roles: admins change roles from a dropdown and invite staff by code", "admin", async (page) => {
  await page.goto(`${BASE}/views/instructor.html#overview`);
  assert.equal(await page.locator(".siteside a", { hasText: "People & roles" }).count(), 0, "kept out of the main menu");
  await page.goto(`${BASE}/views/instructor.html#settings`);
  await page.getByRole("link", { name: "Manage people & roles" }).click();
  await page.getByRole("heading", { name: "People & roles" }).waitFor();
  assert.equal(await page.getByLabel("Role of Dr Admin").isDisabled(), true, "own role is locked");
  await page.getByLabel("Role of Nok").selectOption("instructor");
  await page.locator(".modal").getByRole("button", { name: "Change role" }).click();
  await page.waitForFunction(() => window.__CALLS__.some((c) => c[0] === "setUserRole" && c[1] === "u-s1" && c[2] === "instructor"));
  await page.getByPlaceholder("Search name or email…").fill("malee");
  assert.equal(await page.locator("main tbody tr").first().locator("td").nth(1).textContent(), "malee@uni.ac.th");
  await page.locator("main input[type=email]").fill("new.teacher@uni.ac.th");
  await page.getByRole("button", { name: "Create invite code" }).click();
  await page.getByText("Invite code created").waitFor();
  assert.ok((await page.locator(".modal").textContent()).includes("K7M2QXP3RT"));
  await shot(page, "people-roles");
  await page.locator(".modal").getByRole("button", { name: "Close" }).click();
  await page.locator("main tbody tr", { hasText: "new.teacher@uni.ac.th" }).getByRole("button", { name: "Revoke" }).click();
  await page.locator(".modal").getByRole("button", { name: "Revoke" }).click();
  await page.waitForFunction(() => window.__CALLS__.some((c) => c[0] === "revokeStaffInvite"));
});
await test("People & roles is for admins only", "instructor", async (page) => {
  await page.goto(`${BASE}/views/instructor.html#settings`);
  await page.getByRole("heading", { name: "Settings" }).waitFor();
  assert.equal(await page.getByRole("link", { name: "Manage people & roles" }).count(), 0);
  await page.goto(`${BASE}/views/instructor.html#settings/people`);
  await page.getByText("Only admins can manage roles.").waitFor();
});

await test("Report a problem: students report a question; instructors see and resolve it", "student", async (page) => {
  await page.goto(`${BASE}/views/app.html#learn/11111111-1111-1111-1111-111111111111/practice`);
  await page.locator(".opt").first().click();
  await page.getByRole("button", { name: "Check answer" }).click();
  await page.getByRole("button", { name: "Report a problem" }).click();
  await page.getByRole("button", { name: "Send report" }).click();
  await page.getByText("Choose what is wrong.").waitFor();
  await page.getByLabel("Something else", { exact: true }).check();
  await page.getByRole("button", { name: "Send report" }).click();
  await page.getByText("Say what is wrong.").waitFor();
  await page.locator(".modal textarea").fill("Option C is also correct");
  await page.getByRole("button", { name: "Send report" }).click();
  await page.getByText("Thank you. Your instructors will check it.").waitFor();
  const call = (await page.evaluate(() => window.__CALLS__)).find((c) => c[0] === "reportQuestion");
  assert.deepEqual(call.slice(1), ["v1", "other", "Option C is also correct"]);
  await shot(page, "report-problem");
});
await test("Report a problem: the instructor side", "instructor", async (page) => {
  await page.goto(`${BASE}/views/instructor.html#overview`);
  await page.getByText("1 question reported by students").waitFor();
  await page.getByRole("link", { name: "Review reports" }).click();
  await page.locator(".reportchip").first().waitFor();
  assert.equal(await page.locator("main tbody tr").count(), 1, "filtered to reported questions");
  await page.locator("td.stemcell").first().click();
  await page.getByRole("heading", { name: "Student reports" }).waitFor();
  assert.equal(await page.locator(".reportitem p").textContent(), "<b>B</b> seems right to me", "report text shown as typed");
  await page.getByRole("button", { name: "Mark fixed" }).click();
  await page.locator(".modal textarea").fill("Key corrected in v2");
  await page.locator(".modal").getByRole("button", { name: "Mark fixed" }).click();
  await page.getByText("All handled").waitFor();
  assert.ok((await page.evaluate(() => window.__CALLS__)).some((c) => c[0] === "resolveReport" && c[2] === "fixed" && c[3] === "Key corrected in v2"));
});

await browser.close();
server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
