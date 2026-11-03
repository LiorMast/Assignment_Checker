# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Automated grading of the Ruppin client-side (HTML/CSS) course exercises. Submissions are collected from the course Gmail mailbox, graded with Playwright against the rendered page, and turned into the course's grades workbook layout. Everything a student or grader sees (comments, feedback, reports) is in Hebrew; console output is in English.

## Commands

```bash
npm run fetch -- ex1                         # read the course mailbox, download group zips, write the submissions report
npm run fetch -- ex1 --since 2026-10-01 --deadline 2026-11-04   # override the schedule's dates
npm run grade -- ex1                         # grade everything in submissions/ex1/
npm run grade -- ex1 --group cgroup12        # re-grade one group (also --student <id>); other results are kept
npm run grade -- ex1 --workers=4             # extra args are passed through to Playwright
npm run selftest                             # self-tests: official solution + ~30 mutated copies
npx playwright test --project=selftest -g "floats not cleared"   # one self-test case
npx tsc --noEmit                             # typecheck (there is no linter or build step; tsx runs TS directly)
```

After changing code, run `codegraph sync` so the CodeGraph index (`.codegraph/`) reflects the edits before the next `codegraph_explore` / `codegraph explore` query.

`npm run fetch` needs `GMAIL_USER` / `GMAIL_APP_PASSWORD` (a Google App Password) in `.env` (see `.env.example`); it uses IMAP, not the Gmail API.

## Pipeline

1. **Fetch** (`grader/fetch-mail.ts`, pure parsing in `grader/mail-parse.ts`): scans `[Gmail]/All Mail` for subjects containing `cgroupXX` (subjects are often non-standard), works out the exercise number from the link path (`/tarN/`) or subject, keeps only each group's **latest** mail, downloads its zip from `proj.ruppin.ac.il` (falls back to an attached zip) to `submissions/<ex>/cgroupNN.zip`, and checks the mail against the submission procedure (`נוהל הגשת תרגילי בית.docx`). Writes `submissions/<ex>/.groups.json` (student IDs, links, violations, earlier mails) and `results/<ex>/submissions.{html,xlsx}` (`grader/submissions-report.ts`).
   - Default `--since`/`--deadline` come from `exercises/schedule.md` (Markdown table parsed by `grader/schedule.ts`). The deadline is an exclusive cutoff: the whole due day counts (late from 00:00 of the next day, Israel time).
   - Parts of one exercise (`ex5a`/`ex5b`) share the number in mails; the mail date picks the part (`exerciseKeyFor`).
   - Students' links often contain spaces in folder names, so the mail client only makes part of the link clickable; `extractLinks` rebuilds these from the text and drops the cut-off part.
2. **Prepare** (`grader/prepare.ts`, called by `grader/cli.ts`): extracts every entry in `submissions/<ex>/` into `.work/<ex>/<id>/` (handles nested folders, zips inside zips, junk folders), finds the entry HTML, and writes `.work/<ex>/manifest.json`. The ID is `cgroupNN` when the name contains a group, otherwise an 8–9 digit student ID. Dot-files (like `.groups.json`) are skipped as submissions but read for group student IDs.
3. **Grade**: the CLI spawns Playwright with `GRADER_EXERCISE=<ex>`. `exercises/<ex>/grade.spec.ts` generates **one test per manifest entry**. The `site` fixture (`grader/fixtures.ts`) serves the folder with a local static server (`grader/server.ts`, which also detects path-case mismatches that would break on the real server) and takes a screenshot; `exercises/<ex>/checks.ts` runs the rubric through a `Grader` (`grader/grader.ts`).
4. **Report** (`grader/reporter.ts` → `grader/output.ts`): a custom Playwright reporter reads each test's `grader-result` attachment and writes `results/<ex>/grades.xlsx`, `summary.html`, `feedback/<id>.txt`, `results.json`. Group results are expanded to **one xlsx row per student ID** (with a "קבוצה" column); a group with no IDs gets one row under its name and goes to manual review. `--student`/`--group` runs (`GRADER_PARTIAL=1`) merge into the previous `results.json`.

## Grading model (important when changing checks)

- Every student starts at 100 and loses points from the exercise's numbered comments table, `exercises/<ex>/comments.ts` (`defineComments`). Comment numbers come from **declaration order** and appear in the workbook, so once grading has started only **append** new comments.
- `g.flag(comment, detail)` records a comment (never twice); deductions are soft-assertion failures, so a failed test is the normal outcome (the CLI treats exit code 1 as success).
- Errors inside `g.check(...)`, or a test that never reaches `g.complete()`, become **manual-review reasons, never deductions**. `g.review(..., { fatal: true })` means "could not be graded" (no grade).
- Checks inspect the rendered page (computed styles, positions) so that any valid technique passes; avoid source-text matching.
- After changing checks or comments, run `npm run selftest`. `exercises/ex1/selftest.spec.ts` grades `exercise 1/ex1Solution` (expected 99: it has no header image) and mutated copies, each asserting its **exact** set of comments.

## Adding an exercise

Create `exercises/exN/` with `comments.ts`, `checks.ts`, `grade.spec.ts`, `selftest.spec.ts` (copy ex1), register it in `exercises/registry.ts` (title, sheet name and grade header match the course workbook), add a project to `playwright.config.ts`, and make sure it has a row in `exercises/schedule.md`.

## Data

`submissions/`, `.work/`, `results/`, `test-results/` and `.env` are git-ignored and contain student data. `exercise 1/` holds the official exercise PDF and solution; `assignment_grading.xlsx` is the course grades workbook whose layout `grades.xlsx` mirrors.
