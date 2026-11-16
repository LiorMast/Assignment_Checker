# Exercise 1 comments table – versions

Each version is a file in this folder; `../comments.ts` selects the active one.
Comment numbers 1–50 are the same in every version; new comments are appended.

## Shared procedure table (2026-11-15)

| # | Comment | Change | Why |
|---|---|---|---|
| 101 | SUBMIT_TITLE | retired (0 points, no longer given) | The mail subject is not graded. Its problems are still listed in the fetch report (`submissions.html`). |

## v3 (2026-11-08, calibrated 2026-11-10)

The submission procedure is now graded for every exercise, from a shared table numbered 101+ (`grader/protocol-comments.ts`, added to every exercise by `exercises/registry.ts`).

| # | Comment | Change | Why |
|---|---|---|---|
| 52 | EXTRA_FILES | retired (0 points, no longer given) | Replaced by the procedure comment 105 (3 points), which applies to every exercise. |
| 101 | SUBMIT_TITLE | new (shared), 10 points | Subject without group, tarN, or student names with IDs. |
| 102 | SUBMIT_LINKS | new (shared), 5 points | Links missing or not under proj.ruppin.ac.il/&lt;group&gt;/test1/tarN/ (subfolders allowed), view link not index.html, spaces. |
| 103 | LIVE_NOT_OPEN | new (shared), 10 points | The view link doesn't open on the server. |
| 104 | LIVE_RESOURCES | new (shared), 3 points | Resources that fail on the server but not in the zip. |
| 105 | UNRELATED_FILES | new (shared), 3 points | Files that aren't part of the site. |

### Calibration on all 19 submissions (2026-11-10)

Every submission was graded by hand (including the procedure comments, the live site, and the page at 1366px) and compared with the script: 19/19 agree (`npm run calibrate -- ex1`). The table was edited in place (v3 was not frozen yet).

| # | Comment | Change | Why |
|---|---|---|---|
| 6 | PATH_CASE | text only (still 0 points) | The course server ignores upper/lower case (cgroup74's `Images/` loads there); the text no longer says the page breaks on the server. |
| 56 | BOX_SPLIT_LIST | new, 1 point | cgroup61 put each of the two links in its own `<ul>`; it was reported as "fewer than two links". |
| 57 | TABLE_COLUMNS_SWAPPED | new, 1 point | cgroup55's header row says link / version above version / link data. |
| 58 | BOX_OVERFLOW | new, 1 point | Text or tables sticking out of the boxes at 1920px (cgroup60's tables, cgroup68's 96px heading). |
| 59 | NARROW_LAYOUT | new, note | At 1366px cgroup66's tables stick out into the next box; fine at 1920px. |

Check fixes in the same round:
- Boxes side by side: boxes of different heights in one row (flex with `align-items: center`) were counted as 3 rows (−5 by mistake). A row is now "one horizontal line crosses every box".
- NO_FLOAT is also given when the boxes are floated inside a flex/grid container (the float has no effect there).
- An empty `<h5>` (title written as a list item) counts as a missing h5 (BOX_NO_H5).
- "גירסאות" (with yod) is accepted in the table headers (REQUIRED_TEXTS was given by mistake).
- A gray `linear-gradient` background counts as gray; a non-gray gradient is described as such instead of "שקוף (לא הוגדר)".
- Images linked from the internet are reported as not in the images folder (NO_IMAGES_FOLDER, 0 points).
- A font chosen in the CSS counts even when it is the browser's default ("Times New Roman"); NO_FONT is only for pages that set no font at all (found in the stylesheets, CSSOM). Re-calibrated on 2026-11-12 with cgroup65's separate submission (20/20 agree).
- Procedure: a doubled `//` in a link is reported as such; a resource failing on the server because of `+` in its name gets an explanation; a live page that differs from the zip's page goes to manual review (except hand-added zips: cgroup55's real submission is its manual zip).

## v2 (2026-11-03)

Calibrated by grading the first 7 group submissions by hand (exercise PDF, official solution, last year's table) and comparing with the script (`npm run calibrate -- ex1`).

| # | Comment | Change | Why |
|---|---|---|---|
| 1 | MAIN_FILE_NAME | 0 → 2 points, text explains the consequence | Without `index.html` the folder link sent to the course doesn't open the page. |
| 51 | REQUIRED_TEXTS | new, 1 point | A submission wrote the page in English (h1, h5, table headers, popular title). Lenient keyword match; not given together with LAST_YEAR. |
| 52 | EXTRA_FILES | new, 1 point | A zip contained a 19MB .exe and the exercise PDF. |
| 53 | LINKS_PLACEHOLDER | new, note | All links were `href="#"`. |
| 54 | BOX_ORDER | new, note | Table placed before the useful-links list. |
| 55 | PATH_BACKSLASH | new, note | Image paths written as `images\x.png`. |

Check fixes made in the same round (no table change): information boxes written as `<span>` were not found (−10 by mistake); CSS animations are finished before measuring; clearer details for `dir` on `<head>` and for boxes that aren't floated.

## v1 (2026-10-29)

First table, based on last year's grading table.
