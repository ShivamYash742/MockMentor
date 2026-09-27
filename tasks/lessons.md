# Lessons

Rules I follow after corrections. Review these at the start of every session.

## 2026-09-24 — Plan approval isn't permission to start
- **Mistake:** I started Step 1 (checking the repo before editing) right after the plan-mode approval, before the user said "go" in chat.
- **Rule:** write the plan to `tasks/todo.md` and stop. Wait for an explicit go-ahead in chat before editing code, installing dependencies, or moving files.
- **Rule:** after each step, check in again before starting the next one.

## 2026-09-27 — The user develops here too
- **Mistake:** I left `.gitignore` and `.env.example` out of the Step 2 commit because I hadn't made those changes myself. The user is the owner and works on the repo alongside me, and those changes were part of Step 2.
- **Rule:** changes in the working tree that I didn't make are the user's work, not strangers' edits. When asked to commit a step, include them. If one looks risky, point it out, but don't leave it out on my own judgement.
