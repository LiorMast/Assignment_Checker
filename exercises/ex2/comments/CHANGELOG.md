# Exercise 2 comments table – versions

Each version is a file in this folder; `../comments.ts` selects the active one.
Comment numbers stay the same in every version; new comments are appended.
The submission-procedure comments (101+) are shared by all exercises (`grader/protocol-comments.ts`).

## v1 (2026-11-16)

First table. It is based on the exercise PDF, the Bootstrap lecture, and last year's ex2 grading table (`exercise 2/exercise 2 last year grades.xlsx`).

Where last year's table had the same comment, its points are used:

| Last year | Points | This table |
|---|---|---|
| 3: designs not done with the library's classes | 8 if none used, 4 if mixed | NO_BOOTSTRAP 8, OWN_CSS_LAYOUT 4 |
| 5: SM, 6/12 per card (2 if only from MD) | 4 (2) | CARDS_SM 4, CARDS_SM_FROM_MD 2 |
| 28: SM, the last card takes 12 instead of 6 | 2 | CARDS_SM_LAST 2 |
| 7: box not replaced with card | – | NO_CARD 2 |
| 8: table not replaced with a div of 3 rows | 5 | VERSIONS_TABLE_KEPT 5 |
| 17: no divs for the versions at all | 8 | VERSIONS_MISSING 8 |
| 9: versions not hidden at XS/SM (1 if only one of them) | 2 (1) | VERSIONS_HIDE_ONE_SIZE 1 |
| 25: versions not hidden (2 if classes were written, 5 if none) | 2–5 | VERSIONS_HIDE_BROKEN 2, VERSIONS_NOT_HIDDEN 5 |
| 10: container-fluid on the wrapper | – | PAGE_NOT_FLUID 1 |
| 14: images not in row / col with equal division | 1 | POPULAR_NO_GRID 1 |
| 18, 32: the 6 images divided equally in one row at every size | 2 | POPULAR_NOT_ONE_ROW 2 |
| 24: classes separated by commas | 1 | CLASS_SYNTAX 0 (the layout comment it causes is deducted) |
| 26: versions cells without a fitting border | 2 | VERSIONS_CELLS 1 |
| 34: own stylesheet linked after Bootstrap was wrong | 1 | BOOTSTRAP_AFTER_STYLE 1 |
| 1, 2, 12/19/31, 33 | 1, 1–4, 1–2, 2 | DUPLICATE_ID 1, INLINE_FEW 1 / INLINE_MANY 3, NO_EXTERNAL_CSS 2, IMG_BROKEN_* |

The other comments come from exercise 1's table (header, cards, popular area, images, submission files). Last year's comments on requirements that are not in this year's exercise were left out: lh-lg, list-group-item, background colors for the card titles, and a 100px image height.

New this year (proposals, to confirm in calibration):
- `NO_VIEWPORT` (1): the lecture calls the viewport meta tag mandatory for responsive pages.
- `HORIZONTAL_SCROLL`, `HEADER_IMG_OVERFLOW`, `POPULAR_IMG_OVERFLOW` (1 each): the page or the images are wider than a phone screen (no `img-fluid`, a row outside a container).
- `CARDS_MD`, `CARDS_LG`, `CARDS_LG_FROM_XL`, `CARDS_XS`: the grid at the other breakpoints, scaled like last year's SM comment.
- `CARD_UNEQUAL_HEIGHT` (h-100) and `CARDS_NO_GAP` (gy-4), 1 each.
- `BOX_OLD_LAYOUT` (2): ex1's float/width left on `.box`, so the card doesn't fill its column.
- 0-point notes: `OLD_FLOAT_CSS`, `BOOTSTRAP_CLASSES`, `UNKNOWN_CLASSES`, `NO_LANG`, `BOOTSTRAP_OLD_VERSION`.

### Checked against the first 20 ex2 submissions (offline, before hand grading)

| Group | Case | Fix |
|---|---|---|
| cgroup62, cgroup68 | Padding on the cards' row: the columns were measured against the row's outer width, so `col-12` looked like 90% | The column widths are compared with the row's content box. |
| cgroup50, cgroup57 | `container-fluid`, plus ex1's `.page { max-width }` | A narrower page is not deducted when the wrapper has `container-fluid` (kept ex1 design). |
| cgroup69 | Images in Bootstrap's `d-flex` box with no `row`/`col-2` were reported as unequal columns | Equal column widths are only required when the images are in columns; this case is POPULAR_NO_GRID, like last year's 14. |

Each fix has a self-test.
