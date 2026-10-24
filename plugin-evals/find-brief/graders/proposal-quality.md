---
type: llm
focus: last_message
---

**What the judge can see:** only Claude's final message to the user. It cannot see files or tool calls; other graders check that `rank.mjs` and `probe.mjs --quick` ran and that `proposal.md` exists.

PASS when the final message presents a reference shortlist for the piano note-reading trainer brief that:
- lists 3 to 5 numbered candidates, each with a title, a site URL and a source link;
- gives each candidate a "why it fits" tied to this brief (beginners, playful but calm, motion 1, buttons/chips/progress card), not generic praise;
- gives each candidate a concrete "what to take" list (e.g. type pairing, palette, buttons, chips, card system) and one "what to leave" line;
- proposes 2 or 3 labelled combinations (A, B, …), one of them a single reference, each with a sentence on the resulting character;
- states plainly if liveness could not be verified (offline), rather than claiming sites are live;
- ends with the approval instruction naming `/tasteful:extract piano-note-trainer`.

FAIL when any of these holds:
- fewer than 3 or more than 5 candidates, or candidates without URLs;
- reasons that would fit any brief, or no "what to leave";
- no combinations;
- it claims a theme was generated or extracted;
- it asks the user clarifying questions instead of delivering the shortlist;
- advice or a verdict given without running the plugin's script.
