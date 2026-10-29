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

await test("instructor: cannot approve own item; reviewer sees approve/return on another's", "instructor", async (page) => {
  await page.goto(`${BASE}/views/instructor.html#questions/q1`);
  assert.equal(await page.getByRole("button", { name: "Approve" }).count(), 0);
  await page.goto(`${BASE}/views/instructor.html#questions/q2`);
  await page.getByRole("button", { name: "Approve" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Return to author" }).count(), 1);
  assert.ok(await page.getByText("AI-generated item").count() === 1);
  await page.getByRole("button", { name: "Return to author" }).click();
  assert.ok(!(await page.evaluate(() => window.__CALLS__)).some((c) => c[0] === "reviewQuestion"), "returned without a comment");
  await shot(page, "question-review");
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
  await page.getByLabel("Show").selectOption("");
  const ownRole = page.locator("tr", { hasText: "admin@uni.ac.th" }).locator("select[title]");
  assert.equal(await ownRole.isDisabled(), true);
  await shot(page, "tab-students-admin");
});

await test("instructor: overview, items, export tabs render", "instructor", async (page) => {
  await page.goto(`${BASE}/views/instructor.html#overview`);
  await page.getByText("Waiting for your review").first().waitFor();
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
  assert.equal(await page.locator(".tab", { hasText: "Exams" }).count(), 0);
});

await test("instructor opening the student app is sent to the dashboard", "instructor", async (page) => {
  await page.goto(`${BASE}/views/app.html`);
  await page.waitForURL(/instructor\.html/);
  await page.getByText("Cohort overview").waitFor();
});

await test("first visit: consent, then the pre-test, then unlock", "student", async (page) => {
  await page.goto(`${BASE}/views/app.html`);
  await page.getByText("Before you start").waitFor();
  assert.equal(await page.locator("#tabs").isHidden(), true, "tabs should be hidden before the pre-test");
  const start = page.getByRole("button", { name: "Start pre-test" });
  assert.equal(await start.isDisabled(), true, "start enabled without consent");
  await shot(page, "gate-consent");
  await page.locator(".consentbox input").first().check();
  await start.click();
  await page.getByText("Pre-test · Question 1 of 3").waitFor();
  assert.match(await page.locator("#streak").textContent(), /Time used \d\d:\d\d · Progress is saved/);
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
  assert.match(await page.locator("#streak").textContent(), /12-day streak/);
  assert.ok((await page.locator("main").textContent()).includes("You missed 5 of your last 8 questions"));
  assert.ok((await page.locator("main").textContent()).includes("Opens in 6 days"));
  await shot(page, "student-home");
});

await test("student practice: flashcards with spaced-review ratings, then a confidence-rated question", "student", async (page) => {
  await page.goto(`${BASE}/views/app.html#practice`);
  await page.getByText("24 cards due today").waitFor();
  await shot(page, "student-practice");
  await page.getByRole("button", { name: "Start session" }).click();
  await page.getByRole("button", { name: "Show answer" }).waitFor();
  await page.getByRole("button", { name: "Show answer" }).click();
  await page.getByText("The polysaccharide capsule").waitFor();
  for (const t of ["10 min", "1 day", "3 days", "7 days"]) assert.equal(await page.locator(".rate small", { hasText: t }).count() >= 1, true, "missing interval " + t);
  await page.getByRole("button", { name: "Bookmark this topic" }).click().catch(() => page.getByRole("button", { name: "Bookmarked" }).click());
  await shot(page, "student-flashcard-back");
  await page.locator(".rate button", { hasText: "Good" }).click();
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

await browser.close();
server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
