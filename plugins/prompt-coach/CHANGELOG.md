# Changelog

## 0.1.3 (2026-10-22)

- Quill reads the first task prompt after a `/clear` again. A `/clear` starts a conversation with state of its own and raises no `session.start`, so the arming Quill wrote when the old conversation ended was lost; it now arms on the new conversation's first prompt.

## 0.1.2 (2026-10-22)

- "improve it" no longer puts the desktop app's hidden context (a `<system-reminder>` block) in the prompt box: you get back only what you typed, plus the questions. Quill also judges only what you typed, and "send anyway" and "let Claude ask" still send the context along.

## 0.1.1 (2026-10-22)

- The pane fits a terminal: it asks for 18 rows when it opens, draws no border inside the pane's own frame, puts a held prompt's buttons right under the heading, and gives each part one line.
- The third gate button is now "let Claude ask", so all three fit on one line.
- A prompt sent while another is held counts as the brief rewritten by hand: Quill reads it again and shows the before → after score, as after "improve it". It used to go through unread.

## 0.1.0 (2026-10-22)

- First version. Quill reads the first task prompt of each conversation (start, `/clear`, compaction) with Haiku and checks it for goal, why, constraints, done-when and reuse, judging which parts apply to that prompt.
- Hints mode (default): the prompt goes at once, and the Prompt coach pane shows the checklist for next time.
- Gate mode: a brief that leaves out a part that applies waits in the pane with three choices: improve it (a scaffold of tailored questions in the prompt box, re-read with a before → after score), send anyway, or let Claude ask.
- `/prompt-coach [next|open|mode gate|hints|off]`, a "read my next prompt" button, and coverage stats for the last ten briefs.
