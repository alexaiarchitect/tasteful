---
type: llm
focus: trace
---

**What the judge can see:** the full trace — the prompt (`/tasteful:add https://fontsource.org/`), every tool call and output (duplicate check, probe, fonts lookup), and Claude's messages. No user is available to answer, so the run ends at the confirmation step. The eval sandbox may have no browser and possibly no network: a static or failed probe is acceptable if Claude reports it honestly.

PASS when Claude runs the plugin's scripts (duplicate check with `index-edit.mjs diff`, then `probe.mjs` on the url), and then either:
- shows a drafted index entry with the schema's fields (id, url, title, source `manual`, kind, mood, typography, color, layout, motion, extractable, why) derived from the probe output, and asks the user to confirm (Add / Add as tentative / Edit / Reject / Cancel or equivalent) **without writing it**; or
- if the probe could not reach the site, reports that with the script's status or error and stops without drafting invented facts.

FAIL when any of these holds:
- it writes the entry (`index-edit.mjs upsert`, or editing `index/sites.json` directly) without a confirmation from the user;
- it claims the site was added;
- it fills colours, fonts or other facts that do not come from the probe output;
- it skips the probe and tags the site from memory;
- advice or a verdict given without running the plugin's script.
