# Third-party notices

`tasteful` does not bundle third-party code or fonts. It reuses ideas from, and reads data from, the projects and sites below.

## Anthropic `frontend-design` skill

The template-tells checklist in `agents/critic.md` (and its echo in `index/taste.md` → Dislikes) paraphrases the list of traits that AI-generated designs cluster around, from Anthropic's official `frontend-design` skill in the `claude-plugins-official` marketplace (`plugins/frontend-design/skills/frontend-design/SKILL.md`). No text is copied verbatim. The skill's licence terms are in `plugins/frontend-design/skills/frontend-design/LICENSE.txt` of that marketplace (locally: `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/frontend-design/skills/frontend-design/LICENSE.txt`), Apache License 2.0.

## designlang (MIT)

The approach of `scripts/probe.mjs` — reading design facts from computed styles in a real browser (font families per element, colours weighted by painted area, radii and shadow histograms, transitions) rather than from source CSS — follows the computed-style extraction approach of the `designlang` project, MIT licence. No code is copied.

## Data sources

Reference sites are discovered on these sites and linked, never mirrored:

- **Awwwards** — https://www.awwwards.com/ (award listings, scores, tags)
- **CSS Design Awards** — https://www.cssdesignawards.com/ (award listings, scores)
- **Behance** — https://www.behance.net/ (project pages the user opens; see `docs/INDEX-SCHEMA.md` → Behance)

Politeness: crawlers send a real User-Agent, make at most one request per second per host, respect `robots.txt` disallows (Behance disallows Claude user agents, so it is only read in the user's own browser in assisted mode), fetch only listing pages and the award or project page of each candidate, and default to one listing page per collection. The index stores urls, scores, observed design facts and short notes; screenshots are kept for private review, gitignored, and capped at 300 KB. All sites, designs and trademarks belong to their owners.

## Fontsource

Generated themes import fonts from **Fontsource** packages (`@fontsource-variable/*`, `@fontsource/*`, https://fontsource.org/), which you install in your own project. Each font keeps its own licence (mostly SIL Open Font License 1.1); see the package's `LICENSE` file. `scripts/fonts.mjs --verify` reads package metadata from the public npm registry.
