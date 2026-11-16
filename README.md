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

   - Every mail whose subject contains `cgroupXX` is read, even if the rest of the subject isn't standard, and so is a mail with a server link or a zip from a student listed in `groups.xlsx`. Links whose folder names contain spaces (only partly clickable in the mail) are rebuilt from the text. The exercise number is taken from the links (`/tar1/`) or the subject (`tar1`, `ex1`, `תרגיל 1`).
   - The zip of each group's **latest** mail is saved as `submissions/ex1/cgroupXX.zip` (from the link; from an attachment if the link is missing or broken). Earlier mails from the same group are not used, but are listed in the report.
   - Each mail's group: the group folder in its zip link first (a zip in `/cgroup51/...` is cgroup51's, even if the subject says `bgroup55`), then the sender and the IDs in `groups.xlsx`, then the subject.
   - Every mail of the exercise gets a Gmail label such as `HW1-2026` (`HW5a-2026` for a part; the year is the semester's, from the first publish date in `exercises/schedule.md`). The label is created if it doesn't exist; `--no-label` skips this.
   - The group's students come from `groups.xlsx` (every student is graded with the group, even if the mail leaves one out); without it, from the IDs in the subject. Saved with the mail details in `submissions/ex1/.groups.json`.
3. Open the report in `results/ex1/`:
   | File | What it is |
   |---|---|
   | `submissions.html` | Every group: IDs, submission time, links, zip status, multiple submissions, and anything that wasn't done according to the procedure (subject format, missing or wrong links, zip attached instead of linked, broken zip link, late). Mails with no exercise number are listed separately. |
   | `submissions.xlsx` | The same table as a spreadsheet. |

**The roster.** `groups.xlsx` in the project root is the course's group list (edit it every semester): one row per group with `שם קבוצה` and, for each student N, `שם סטודנט N`, `ת.ז. סטודנט N`, `איימל סטודנט N` (columns are found by these headers; the password column is never read). It holds student data and passwords, so it is git-ignored.

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

## Correcting grades by hand

Open `grades-viewer.html` (in the project root) in Chrome or Edge and import `results/ex1/grades.xlsx`. Each group is a row; open it to:

- change a comment's deduction or detail, remove a comment, or add one from the comments table (type its number or part of its text) or a new one;
- type a grade by hand (it then stops following the deductions), or give an ungraded submission its grade from its comments;
- mark manual-review reasons as handled, and add notes for yourself;
- copy the student's feedback text;
- tick the box at the start of the row to mark the group as checked (or **סימון כנבדק ומעבר לקבוצה הבאה**, which also opens the next unchecked group). Only one group is open at a time.

**טבלת הערות** edits the comments table itself: change a comment's text or deduction for everyone, or add new comments (numbered from 201); click a column header to sort it. Undo/redo, search (`#43` finds the groups with comment 43) and filters are in the toolbar.

**שמירה** asks once for the project folder and writes two files: `manual-submissions/ex1/grade-edits.json` (the edits) and `results/ex1/grades.xlsx`. Then update the other reports:

```bash
npm run report -- ex1     # grades.xlsx, students.xlsx, summary.html and feedback/ with the edits, without grading again
```

The edits are kept apart from the automatic results (`results.json` never changes), so `npm run grade` applies them again after a re-grade, and `npm run calibrate` still compares the script's own grades. Edits for a comment the re-grade no longer finds stay visible: the removed comment just isn't there. **הורדה** downloads both files instead (for other browsers); move them to those folders yourself. Unsaved edits are kept in the browser until saved.

## Changing what is checked

- **Deductions and comment texts** are versioned tables in `exercises/<ex>/comments/` (`v1.ts`, `v2.ts`, …); `exercises/<ex>/comments.ts` selects the active one, and `grades.xlsx` shows its version. A version that grades were given with is frozen: make the next version from it (`{ ...V1, <changes>, <new comments> }` keeps the existing numbers) and record the change in `comments/CHANGELOG.md`.
- **The checks**: `exercises/<ex>/checks.ts`; checks used by several exercises (stylesheet, inline styles, images, duplicate ids, last year's solution...) are in `grader/common-checks.ts`. They look at the rendered page (computed styles, positions), so any valid technique passes.
- **Exercise 2 (Bootstrap)** measures the page at five widths, one in each Bootstrap range the exercise uses (400, 650, 850, 1100 and 1920px), and compares the layout with the PDF: cards per row, the versions area hidden below md, the six images in one row. Screenshots at each width are in the Playwright report. Using Bootstrap's classes for a layout that works is graded separately (8 points when Bootstrap isn't used, 4 when part of the layout is the student's own CSS), as in last year's table. Bootstrap 5.3.3 (the version the exercise links to) is a devDependency and is served from `node_modules` instead of the CDN (`grader/bootstrap.ts`): grading doesn't need the network, and a correct `integrity` attribute still matches.
- After any change, run the self-tests:

  ```bash
  npm run selftest
  ```

  They grade the official solution of each exercise and mutated copies of it, each of which must trigger exactly its expected comments: `exercise 1/ex1Solution` (expected 99 because it has no header image) and `exercise 2/ex2Solution` (a reference solution written from the PDF, expected 100; replace it with the official one if you get it). The ex2 self-tests run with the network blocked.

## Calibrating against hand grading

To check the script against your own judgment (a new exercise, or a new table version):

1. Grade some submissions by hand and write the comment keys you'd give in `submissions/ex1/.manual.json`:

   ```json
   { "cgroup52": { "keys": ["CSS_FILE_NAME", "NOT_CLEARED"], "notes": "why" } }
   ```

2. `npm run grade -- ex1`, then `npm run calibrate -- ex1`. It lists, per submission, the hand grade and the script's grade, the comments only you gave and those only the script found, and writes `results/ex1/calibration.md`.
3. For each difference, fix the check (or the table, in a new version), add a self-test that reproduces it, and run the two commands again until they agree.

## Adding an exercise

Create `exercises/exN/` with `comments.ts`, `checks.ts`, `grade.spec.ts` and `selftest.spec.ts` (copy ex1 or ex2 as a template), register it in `exercises/registry.ts`, and add a project to `playwright.config.ts`.
