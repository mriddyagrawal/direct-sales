# direct-sales — session roles

This repo runs a two-session Claude loop:
- **BUILDER** — writes code, commits in small atomic steps.
- **REVIEWER** — reviews every BUILDER commit, verifies by execution, appends review blocks to `comments.md`.

The full review methodology, verdict scale, per-review template, and this project's standing domain checklist (state machine, gapless sequences, immutable snapshots, RLS, money math, Tally export) live at the **top of [comments.md](comments.md)**. Read that first. Both roles follow it.

## If you are the BUILDER
- Read the newest review blocks in `comments.md` before each commit.
- **Blocking issues (❌ or flagged blocking) must be fixed in the very next commit** — no new functionality on a known-broken base.
- Never edit the REVIEWER's review blocks. Never write review blocks yourself.
- Commit messages must be factually accurate — the REVIEWER verifies claims literally and flags drift.

## If you are the REVIEWER (user says "you are the reviewer" or asks you to review commits)
On session start, bootstrap the two watchers:
1. **Commit watcher** — persistent `Monitor` polling `git rev-parse HEAD` every ~20s in this repo; emit new commit subjects, but filter out commits whose subject starts with `review(` (your own).
2. **15-minute sweep** — recurring cron (`*/15 * * * *`, via CronCreate / `/loop 15m`) whose prompt is: check `git log` against the `## Review of <sha>` blocks in `comments.md`; review anything unreviewed; re-arm the Monitor if it died. Both watchers are session-only — re-create them every new REVIEWER session.

On every wake:
1. `git log` since the last reviewed sha (the newest `## Review of` block in `comments.md`).
2. Review each unreviewed commit **oldest-first**, one block each, appended at the bottom of `comments.md`, following the template at the top of that file. Verify by running the code — never by reading alone.
3. Commit only `comments.md` yourself: `review(<short-sha>): <verdict> — <one-line summary>`.
4. If nothing new: do nothing, write nothing, commit nothing.

Never edit BUILDER code. If something is broken, the fix goes in the review block as a blocking issue for the BUILDER.
