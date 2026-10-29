# Infection &amp; Immunity — revision tool

A revision tool for Infection &amp; Immunity, mapped to the Thai medical licensing
requirements (ศรว. 2567). Four linked views read from **one dataset**: no organism
content is duplicated across views.

## Open it

Zero build. Open `index.html` in a browser (double-click works — data files load as
plain `<script>` globals, no dev server required). From there:

### Share it as one offline file

```
node scripts/bundle.mjs      # → dist/infection-immunity.html
```

Produces a **single self-contained HTML file** (~2 MB) with every view and all data
inlined in isolated frames. It opens by double-click, works with **no internet and no
other files** — hand it to a student, email it, put it on a USB stick. (To host it online
instead, push the repo to GitHub and enable GitHub Pages.)

| View | File | Reads |
|---|---|---|
| Niche map | `views/niche-map.html` | organisms |
| Immune map (keystone) | `views/immune-map.html` | organisms + host defects |
| Cascade | `views/cascade.html?b=extracellular` | cascade + organisms + host defects |
| Taxonomy browse *(seam)* | `views/taxonomy.html` | organisms + taxonomy |

## Data layer — the single source of truth

Everything lives in `data/`, each file assigning a global (browser) that Node can also load:

- **`organisms.js`** — 89 organism records. One record per organism. This is the source of truth.
- **`host-defects.js`** — 13 immunodeficiencies (CGD, C5–9, neutropenia, XLA, …). The
  host-side break-points; not organisms, so kept separate.
- **`cascades/extracellular.js`** — the 8-step spine + 45 break-point references.
- **`cascades/{vesicular,cytosolic,surface}.js`** — seams (empty, `pending:true`).
- **`taxonomy.js`** — classification-tree seam (empty).
- **`enums.js`** — canonical vocabularies (niches, failure modes, systems, kingdoms,
  the 29 `c_*` component IDs, the 24 `f_*` flow IDs). The validator checks everything against these.

### Organism record shape

```js
{
  id: "streptococcus-pneumoniae",   // stable slug
  name: "Streptococcus pneumoniae",
  kingdom: "bacteria",              // bacteria | virus | fungus | parasite
  niche: ["extra"],                 // extra | vesic | cyto | surf
  tier: 1,                          // ศรว. group 1 | 2
  sys: ["Resp","CNS","ENT"],
  fail: "Capsule / anti-phagocytic",// must be in enums.failureModes
  sub: "capsule",
  panels: { resp, evade, dis },     // the 3 prose panels (verbatim from the prototype)

  engages: ["c_prr", …],            // immune-map components used   (authored for ~6 so far)
  breaks:  ["c_c3b", …],            // immune-map components broken
  flows:   ["f_prr_c3", …],         // immune-map flow paths lit
  mapNote: "…",                     // optional map-specific framing

  taxonomy: {},                     // EMPTY — fill incrementally
  treatment: [],                    // EMPTY — mechanism-level only
  resistance: []                    // EMPTY — mechanism only
}
```

`taxonomy` / `treatment` / `resistance` are intentionally empty and filled by hand, in
small batches. See **Filling content** below.

## Validate

```
node scripts/validate.mjs
```

Exits non-zero and lists every problem. It fails loudly on:

- broken `c_*` / `f_*` references in any `engages` / `breaks` / `flows`
- missing required fields (including the three panels)
- duplicate organism `id` or `name`
- a `fail` value outside `enums.failureModes`
- **orphaned** failure-mode categories (defined but used by no organism)
- cascade break-points referencing an unknown organism / host defect / step

The **scope** check against the ศรว. list is a seam: drop the OCR of the requirement
list at `prototypes/ocr.txt` and implement the diff in `validate.mjs` (marked `TODO`).

## Regenerate (provenance)

The data files were produced from the three original prototypes (kept in `prototypes/`)
by `scripts/migrate.mjs`, which lifts all prose **verbatim** — nothing was retyped. The
only content authored in the migration is structural: id slugs, `kingdom` tags, and the
name→id resolution tables. Re-run with:

```
node scripts/migrate.mjs   # overwrites data/organisms.js, host-defects.js, cascades/extracellular.js
```

> ⚠ Re-running migrate **overwrites** those three files. Once you start hand-filling
> `taxonomy`/`treatment`/`resistance` or authoring `engages`/`breaks`, either stop
> re-running migrate, or move that content into the migration's mapping tables first.

## Filling content — the ground rules

- **Never bulk-generate medical content.** Organism records are added and verified in
  small batches. Structural scaffolding is automated; clinical accuracy is checked by hand.
- **Treatment stays mechanistic** — drug class + why it works. Never empirical regimens;
  local guidelines govern those.
- **Resistance is mechanism** (e.g. PBP2a, ESBL, efflux), not local prevalence.
- One inferred classification to sanity-check: the `kingdom` tag on each organism was
  assigned during migration. Everything else is verbatim from your prototypes.

## Signed-in app — students and instructors

The revision views above stay static and offline. The **Log in** button (top right of
`index.html`) opens `views/app.html`, which needs a network and a [Supabase](https://supabase.com)
project. After signing in, the role decides what each person sees:

| Who | Page | Tabs |
|---|---|---|
| students | `views/app.html` | Home · Learn · Explore · Practice · Progress |
| instructors, admins | `views/instructor.html` (automatic redirect) | Overview · Lectures · Questions · Students · Items · Exams · Export |

Instructors can open the student view from their avatar menu (`app.html?preview=1`).
Every online page, including the five maps, has the same side navigation (`app/sitenav.js`). The « button hides it and
the same sections then appear as tabs along the top (maps in a Maps menu, account button on the right);
☰ Menu brings the sidebar back (the choice is remembered per browser); on phones it is always behind ☰ Menu.

Instructor time-savers: no peer review, the author clicks **Publish** and a practice question is
live at once; tick-box bulk actions (Publish, Retire, Delete) in the question bank; a **Today** card on
the Overview; **class codes** (students type their cohort's code at sign-up or in Settings); and
**monthly check-in schedules** that create, fill and open each month's check-in by themselves
(the app runs `run_due_schedules()` whenever someone signs in, so no background job is needed).
The **AI prompt** button (Question bank, or a lecture) builds a ready-to-paste prompt for any AI chat,
listing the allowed tag ids, so the reply imports directly as drafts.
Everyone signs in with email and password and can change their name, email and password under
**Settings** (avatar menu). Admins also find the tag lists there, with a CSV/JSON import for
generated lists.
`views/learn.html` now just forwards to `app.html#learn`. None of these pages are in the offline bundle.

**Students** get: a first-visit consent screen and pre-test (when one is open for their cohort)
that unlocks the app; a home page with "study this next", weak spots, cards due, streak and the
next monthly check-in; lectures with read status and linked diseases; Explore (organism search
and niche cards from `data/organisms.js`); Practice with spaced review, bookmarked topics or a
mixed set, as flashcards (Again / Hard / Good / Easy scheduling) and/or questions with a
"How sure are you?" rating; and a Progress page (score over time, this week, niches, confidence check).

**Instructors** get cohort and period pickers on Overview, Students, Items and Export; topic
accuracy by week (with the pre-test as the first column); students to check in with, using short
IDs (revealing names is logged); cohort assignment; an Exams tab to build, open and close the
pre-test and monthly check-ins (auto-pick spread across niches, KR-20 reliability); and research
exports that include only students who agreed to research use.

Code: `app/` (browser), `supabase/migrations/` (schema, RLS, functions),
`supabase/seed.sql` (tag vocabularies, generated from `data/` by `node scripts/gen-vocab-seed.mjs`).

### Set up (once)

1. Create a Supabase project. Apply the migrations in order and then the seed:
   `supabase link` → `supabase db push` → run `supabase/seed.sql` in the SQL editor
   (or paste the seven migration files and the seed into the SQL editor, in that order).
2. Authentication → enable **Email** (password sign-in; email confirmation can be switched on later). Add the address you host the site at
   (e.g. your GitHub Pages URL) to *Site URL* and *Redirect URLs*.
3. Put the project URL and the **publishable / anon** key in `app/config.js`. Never the secret key.
4. Host the folder over https (GitHub Pages works). The app does not work from `file://`.
5. Sign in once, then make yourself the first admin in the SQL editor:
   `update public.profiles set role = 'admin' where email = 'you@…';`
   From then on, grant instructor roles from the **Students** tab.
6. To run the course: create a cohort (Students tab) and share its class code with students; move published
   questions into the **pretest** and **monthly** pools (admins, on each question); then in
   **Exams** create the pre-test for the cohort, auto-pick items and open it. Students in that
   cohort take it right after their next sign-in. Open a monthly check-in each month the same way.

Days (streaks, "this week", weekly columns) are counted in Asia/Bangkok time. A streak survives
one missed day and resets after two.

### Roles and security model

- Roles are `student` (default for every sign-up), `instructor`, `admin`, stored in
  `public.profiles.role`. They are never read from `user_metadata`. Users have no write
  privilege on the role column; only `set_user_role()` (admin-only, not on yourself) changes it.
- RLS uses `is_instructor()` / `is_admin()` (SECURITY DEFINER helpers). Students read only
  published lectures and live **practice** questions; pretest and monthly items are never
  readable by students.
- The browser never writes tables. Every change goes through a SECURITY DEFINER function that
  checks the caller's role (`save_question`, `publish_question_now`, `delete_question`, `publish_lecture`, …).
- Answer keys and explanations live in `question_keys`, readable by instructors only. Students
  get the key for one practice item only after answering it (`submit_answer()`) or turning its
  flashcard over (`reveal_card()`). Pre-test and monthly items are never readable by students:
  `start_exam()` sends stems and options only, and results come back as a score and niche breakdown.
- `audit_log` records who/what/when with old and new values for lectures, questions, versions,
  keys, reviews, role changes and vocabularies. Nobody can update or delete it, not even the
  owner role.
- All lecture and question text is rendered with `textContent`, and the pages carry a
  Content-Security-Policy that blocks inline script. `<script>` in a stem is shown as typed.

### Question workflow

`draft → live → superseded | retired`. There is no peer review: the author (or an admin) clicks
**Publish** (`publish_question_now`). Only admins can put **pretest** or **monthly** items live.
Editing a live item opens a new version, and the live one keeps serving students until the new
one is published. (Migration 0007 removed the old review states and functions; any version still
"in review" or "approved" went back to draft. `question_reviews` is kept as read-only history.)
Non-draft versions are frozen, so each answer stays linked to exactly the text the student saw.
Retiring removes the item from every pool and keeps all its data.
**Deleting** (`delete_question`, `delete_exam`) is for mistakes: the author or an admin can delete a
question no student has answered and that is not in an exam; any instructor can delete an exam no
student has started. Once students have used it, only an admin can delete it (the students' answers
or results go with it, after a warning); everyone else retires the question or closes the exam.
A deleted scheduled check-in is not recreated that month. Every delete is recorded in `audit_log`. New items go to the
**practice** pool; only admins can choose **pretest** or **monthly**. Imports (CSV or JSON,
templates in the Import dialog) and AI-generated items always arrive as drafts.

Decisions taken (2026-10-29): **no peer review** (originally one approver; removed at the
course team's request); instructors see **their own drafts**
plus everything submitted or later (admins see all); lecture summaries are **plain-text bullets**.

### Tests

```
supabase test db            # 184 pgTAP tests: supabase/tests/database/
bash scripts/test-db.sh     # same tests on a plain local Postgres (uses scripts/local-supabase-shim.sql)
npm i && npx playwright install chromium && node tests/ui/run.mjs   # 30 browser tests with a mock backend
```

They cover: students cannot create, edit or read drafts or answer keys; an instructor cannot
publish someone else's item, put pretest/monthly items live, or delete what students have used; roles cannot be self-assigned (including
via sign-up metadata); editing a live item creates a new version and leaves past answers alone;
`<script>` and `<img onerror>` in lecture and question text display as text; every create, edit,
approval, publish and retirement writes `audit_log`; exam items and keys never reach students,
consent is required before an exam, a submitted exam is final, the spaced-review schedule,
confidence ratings, bookmarks and cohort filters behave as intended; and in the browser the
consent → pre-test → unlock flow, publish and delete, the sidebar toggle, flashcards, Progress, Explore, the instructor pickers and the Exams tab.

## Roadmap (seams already in place)

- Three more cascades — vesicular (~15), cytosolic (~32), surface (~19) — following
  `cascades/extracellular.js` exactly.
- Taxonomy browse: populate the trees in `data/taxonomy.js`.
- Only ~6 of 89 organisms (+2 host defects) have `engages`/`breaks` authored so far.
