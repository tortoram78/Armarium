---
description: Run the end-of-iteration retrospective — diff since baseline, diagnose why, log it, promote durable rules to CLAUDE.md.
---

Run Armarium's retrospective loop. **Prefer to delegate to the `retrospective` agent**; if running it
inline, follow the same steps and edit ONLY `docs/engineering-log.md` and CLAUDE.md's *Engineering lessons*.

1. **Baseline:** read the newest `docs/engineering-log.md` entry's "analyzed through `<sha>`". If none,
   use the last ~3 commits.
2. **Delta:** `git log --oneline <baseline>..HEAD` + `git diff --stat <baseline>..HEAD`; read the
   substantive diffs and relevant agent reports.
3. **Diagnose** each meaningful change as **Delta · Why (root cause) · Lesson · Promote?**.
4. **Append** a dated entry to `docs/engineering-log.md`, ending with the HEAD sha analyzed-through.
5. **Promote** only durable/broad/actionable/not-already-covered rules into CLAUDE.md; dedupe, tighten,
   **prune** superseded rules. Keep it tight.
6. Verify the markdown; commit both files with `chore(retro): <summary of lessons>`.

Then report: the promoted lessons (one line each) and where the next iteration should start.
