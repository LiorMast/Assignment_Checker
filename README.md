# Assignment Checker

Automated, repeatable grading of the client-side course exercises with Playwright.
Every student starts at 100 and loses points from the exercise's numbered comments table, like the course grades workbook.

## Setup (once)

```bash
npm install
npx playwright install chromium   # only if Playwright says the browser is missing
```

## Collecting submissions from Gmail

Groups email two links (per "נוהל הגשת תרגילי בית"): the page on `proj.ruppin.ac.il/cgroupXX/test1/tarN/index.html` and the zip `.../tarN/tarN.zip`. `npm run fetch` reads the course mailbox and downloads the zips for you.

1. Once: turn on 2-Step Verification for the course Google account, create an **App Password** (Google Account → Security → App passwords), then `cp .env.example .env` and put it in `.env`.
2. Run:

   ```bash
   npm run fetch -- ex1
   ```

   The scan starts at the exercise's publish date and marks mails as late from 00:00 of the day after the due date (the whole due day counts), both taken from [`exercises/schedule.md`](exercises/schedule.md). Override with `--since 2026-10-01` / `--deadline 2026-11-10` (or `"2026-11-10 18:00"` for a time). Parts of an exercise (`ex5a`, `ex5b`) share the number in the mails, so the mail's date decides which part it belongs to.

   - Every mail whose subject contains `cgroupXX` is read, even if the rest of the subject isn't standard. Links whose folder names contain spaces (only partly clickable in the mail) are rebuilt from the text. The exercise number is taken from the links (`/tar1/`) or the subject (`tar1`, `ex1`, `תרגיל 1`).
   - The zip of each group's **latest** mail is saved as `submissions/ex1/cgroupXX.zip` (from the link; from an attachment if the link is missing or broken). Earlier mails from the same group are not used, but are listed in the report.
   - Student IDs are taken from the subject and saved with the mail details in `submissions/ex1/.groups.json`.
3. Open the report in `results/ex1/`:
   | File | What it is |
   |---|---|
   | `submissions.html` | Every group: IDs, submission time, links, zip status, multiple submissions, and anything that wasn't done according to the procedure (subject format, missing or wrong links, zip attached instead of linked, broken zip link, late). Mails with no exercise number are listed separately. |
   | `submissions.xlsx` | The same table as a spreadsheet. |

Then grade as below. Each group is graded once, and `grades.xlsx` gets one row per student of the group (same grade, with a "קבוצה" column). A group whose mail had no IDs gets one row under its group name, marked for manual review.

## Grading

1. Run `npm run fetch -- ex1` (above), or put one **zip or folder per student** in `submissions/ex1/`, named with the student's ID (e.g. `206352221.zip`) or group (`cgroup12.zip`).
   Nested folders, Moodle-style folders that contain the zip, and zips inside zips are all handled.
2. Run:

   ```bash
   npm run grade -- ex1
   ```

3. Open the results in `results/ex1/`:
   | File | What it is |
   |---|---|
   | `grades.xlsx` | Same layout as the course workbook: ID, grade, comment numbers, manual-review notes, and the comments table (G–I). The `פירוט` sheet has the details per comment. |
   | `summary.html` | One card per student: screenshot, grade and comments, for a quick visual check. |
   | `feedback/<id>.txt` | Hebrew feedback for the student, ready to paste. |
   | `playwright-report/` | Full Playwright report (`npx playwright show-report results/ex1/playwright-report`). |

Re-grade one student (the others are kept): `npm run grade -- ex1 --student 206352221`
Re-grade one group: `npm run grade -- ex1 --group cgroup12`

Students in column D ("לבדיקה ידנית") need a look: unsupported archives (.rar), no HTML file, a page that crashed, or what looks like last year's solution. Errors in the grader itself never cost points; they send the student to manual review.

## Changing what is checked

- **Deductions and comment texts**: `exercises/ex1/comments.ts`. Numbers follow the order in the file, so once grading has started only append new comments.
- **The checks**: `exercises/ex1/checks.ts`. They look at the rendered page (computed styles, positions), so any valid technique passes.
- After any change, run the self-tests:

  ```bash
  npm run selftest
  ```

  They grade the official solution (`exercise 1/ex1Solution`, expected 99 because it has no header image) and about 30 mutated copies, each of which must trigger exactly its expected comments.

## Adding an exercise

Create `exercises/exN/` with `comments.ts`, `checks.ts`, `grade.spec.ts` and `selftest.spec.ts` (copy ex1 as a template), register it in `exercises/registry.ts`, and add a project to `playwright.config.ts`.
