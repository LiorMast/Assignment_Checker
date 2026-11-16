# Manual submissions

Submissions added by hand (e.g. a group that sent a broken link and mailed the zip separately).

```
manual-submissions/
  ex1/
    cgroup60/
      anything.zip      ← exactly one zip with the group's site
```

`npm run grade -- ex1` uses `manual-submissions/ex1/cgroupNN/*.zip` **instead of** `submissions/ex1/cgroupNN.zip`
(the group's students come from `groups.xlsx`, or the mail when the group isn't there). If a folder has several zips, the newest is used.
Everything here except this README is git-ignored (student data).

## A group that submitted without a mail

Put its two links in `manual-submissions/<ex>/cgroupNN/links.txt` (any text, e.g. the links pasted
as they were sent). `npm run fetch -- <ex>` downloads the zip into the same folder, and the grade
checks the links and the live page like a mailed submission's (there is no subject to check).

## Hand edits of the grades

`manual-submissions/<ex>/grade-edits.json` holds the grader's corrections, saved from `grades-viewer.html`
(changed or added comments, hand grades, handled manual-review reasons, comments-table changes, and which groups were marked as checked).
`npm run grade` and `npm run report -- <ex>` apply it to every report; `results/<ex>/results.json`
stays the automatic result. Delete the file to go back to the automatic grades.

## Which group a mail belongs to

`npm run fetch` decides each mail's group from, in this order: the group folder in its zip link
(then its view link) – a zip uploaded to `/cgroup51/...` is cgroup51's, whatever the subject says –
the sender's email in `groups.xlsx`, the student IDs in the mail (in `groups.xlsx`), and last the
subject. When the sources disagree it's listed in `results/<ex>/submissions.html`. To overrule it,
assign the mail by sender in `manual-submissions/<ex>/mail-groups.json`:

```json
{ "student@gmail.com": "cgroup51" }
```

and run `npm run fetch -- <ex>` again.

A hand-added zip whose file or folder names hold another group's student IDs (from `groups.xlsx`)
is graded, but marked for manual review – check it's in the right group's folder.
