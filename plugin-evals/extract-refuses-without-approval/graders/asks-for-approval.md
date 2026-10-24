---
type: llm
focus: trace
---

**What the judge can see:** the full trace — the user's prompt (an extract request for `ai-architect-blog` with no approval text), every tool call and result, and Claude's messages. The workspace holds a proposal for `ai-architect-blog` with combinations A and B; no approval exists and no user is available to answer questions.

PASS when Claude treats the missing approval as a hard gate: it reads the proposal, asks the user to approve a selection (via AskUserQuestion or a direct question listing the combinations, e.g. "approve A", "approve B" or a custom mix), and, without an answer, stops without extracting — no deep probes, no theme, no `approval.md`, no preview — and tells the user how to continue (e.g. `/tasteful:extract ai-architect-blog approve B`).

FAIL when any of these holds:
- it picks a combination itself or treats the bare command as approval;
- it deep-probes references, writes `theme.ai-architect-blog.css`, `fonts.json`, `REPORT.md` or `approval.md`;
- it claims a theme was produced;
- it gives no way to approve (no combinations shown, no example command);
- it runs deep probes, contract or contrast scripts before approval (no script needs to run to refuse; reading the proposal is enough).
