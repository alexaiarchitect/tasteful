# Applying a generated theme in the `sites` repo

`/tasteful:extract` writes `theme.<slug>.css` and `fonts.json` into `.tasteful/<slug>/` (plus `site.<slug>.css` when the brief names a site) and stops. These are the exact steps to try the result in `~/Documents/Business/alexaiarchitect/sites` (pnpm workspace, Astro 7 + Tailwind 4, Cloudflare Workers). Nothing here is automated by the plugin: you run each step.

Placeholders: `<slug>` is the brief slug; `<out>` is the folder holding the generated files (`.tasteful/<slug>` in the project where you ran `extract`); `<site>` is the app folder under `apps/` (`www`, `piano`, `dji`).

## Which path?

| | Path A: shared theme | Path B: site layer |
| --- | --- | --- |
| When | The look is for every site | The look is for one site (`brief.site` is set) |
| File | `<out>/theme.<slug>.css` → `packages/theme/src/styles/theme.css` | `<out>/site.<slug>.css` → `apps/<site>/src/styles/site.css` (the `site_layer_path` setting) |
| Fonts | `pnpm --filter @sites/theme add …` | `pnpm --filter <site> add …` |
| Affects | www, piano and dji at once | that app only |

The rule: **the shared theme stays the base.** A look for one site goes into that site's layer, never into `packages/theme`. PRs that touch `packages/theme` need the `shared-theme` label, or the sites CI blocks them.

## Path A: shared theme

### A1. Branch

```sh
cd ~/Documents/Business/alexaiarchitect/sites
git switch main && git pull
git switch -c feat/theme-<slug>
```

### A2. Copy the theme

```sh
cp <out>/theme.<slug>.css packages/theme/src/styles/theme.css
```

The generated file is a full replacement: same tokens, same classes, same dark selectors. No markup changes are needed.

### A3. Add the fonts

Open `<out>/fonts.json`. For every entry in `packages` (its `install` field holds the command), add it to `packages/theme/package.json` → `dependencies`, then install:

```sh
pnpm --filter @sites/theme add <package> [<package> …]   # e.g. @fontsource-variable/fraunces
pnpm install
```

The matching `@import "@fontsource-variable/<family>/wght.css";` lines are already in the generated theme, right after the first two lines. If the theme no longer uses Inter or Source Serif 4, you may remove `@fontsource-variable/inter` / `@fontsource-variable/source-serif-4` from `packages/theme/package.json`; leaving them costs nothing at runtime because unused CSS is not imported.

### A4. Keep the first two lines

The file must start with:

```css
@import "tailwindcss";
@source "../";
```

**The `@source` caveat** (from the sites `AGENTS.md`): Tailwind 4 scans only the directory of the app that imports the CSS. `@source "../"` makes it also scan `packages/theme`, where the shared header, footer and cards live. Without it every class used only by the theme package is silently missing from the build. Any new shared package that uses Tailwind classes needs its own `@source` line. `contract.mjs --check` fails a theme that drops these lines, but check again after hand edits.

### A5. Build and check

```sh
pnpm run build && pnpm run check && pnpm run lint
```

All three must pass. A build error that mentions an unknown utility usually means a class contract break: re-run `/tasteful:extract verify <out>/theme.<slug>.css` and fix the finding rather than patching markup.

### A6. Eyeball it

```sh
pnpm --filter www dev
```

Open the landing page, a long blog post (tables, code, blockquote), the `/ru/` and `/es/` versions (long words in headings, buttons and chips), and toggle dark mode. Repeat with `pnpm --filter piano dev` and `pnpm --filter dji dev`: the theme is shared by every app.

### A7. Open a PR

```sh
git add packages/theme
git commit -m "feat(theme): apply <slug> theme from tasteful"
git push -u origin feat/theme-<slug>
gh pr create --fill --label shared-theme
```

Without the `shared-theme` label the CI guard blocks the PR. The `sites` CI deploys a Workers preview per affected app, comments the preview URL on the PR, and runs Lighthouse on `/`, `/ru/` and `/es/`. Accessibility must stay **≥ 95**; tasteful's contrast floor is designed to keep it there, but Lighthouse is the gate. Review the previews on a phone as well.

### Rollback

Revert the theme commit (`git revert <sha>`) on the branch, or after merge with a revert PR. The previous `theme.css` and font packages come back with it; run `pnpm install` afterwards.

## Path B: site layer

### B1. Branch

```sh
cd ~/Documents/Business/alexaiarchitect/sites
git switch main && git pull
git switch -c feat/<site>-layer-<slug>
```

### B2. Copy the layer

```sh
cp <out>/site.<slug>.css apps/<site>/src/styles/site.css
```

Never hand-edit the layer: change `theme.<slug>.css` and regenerate it with `overlay.mjs` (the `extract` skill does this). Base declarations the full theme deleted are reset in the layer with `<prop>: unset; /* removed in the full theme */`, and tokens that exist only in the full theme are inlined as values.

### B3. Add the fonts to the app

Only packages whose `@import` is new in the layer are needed; Inter and Source Serif 4 are already loaded by the shared theme. For each one (its `install` field in `fonts.json`):

```sh
pnpm --filter <site> add <package>        # e.g. pnpm --filter dji add @fontsource-variable/jetbrains-mono
```

### B4. Import order in Shell.astro

Every app's `Shell.astro` imports, in this order:

```astro
import "@sites/theme/styles.css";
import "../styles/site.css";
import BaseLayout from "@sites/theme/layouts/BaseLayout.astro";
```

Astro does not guarantee that a layout's CSS is emitted before a component's CSS, so relying on BaseLayout to bring in the shared theme can put the layer first and let the base win. Importing the shared stylesheet explicitly, then the layer, fixes the order.

### B5. What the layer may contain

- Plain CSS only: a header comment, new `@import "@fontsource…"` lines (first), one unlayered `:root { … }` redeclaring existing tokens, both dark selectors (`:root[data-theme="dark"]` and `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }`) with identical values, and `@layer base { … }` / `@layer components { … }` rule overrides.
- No `@import "tailwindcss"`, `@source`, `@theme`, `@apply`, `@utility`, `@variant`, `@custom-variant`, `@plugin`, `@config`, `@reference`, `theme()` values or external imports; `!important` only inside reduced-motion.
- The same layer names as the base, so Tailwind utilities still win over component rules. No new layers and no bare `@layer x;` statements.
- Token names never change: a layer only redeclares what the base defines, and never references a token the base lacks (every `var()` resolves to a base token or one the layer declares; contract check 8 enforces it).

An empty, comment-only layer is valid (www and piano ship one), so every app can import its `site.css` unconditionally.

### B6. CI checks

The sites repo vendors tasteful's `contract.mjs` and `contrast.mjs` (with their `lib/` files) under `scripts/theme/`. `scripts/theme/check.mjs` (`pnpm run check:theme`, also run in CI) checks the base on its own, then runs both in overlay mode on each `apps/*/src/styles/site.css`:

```sh
node scripts/theme/contract.mjs packages/theme/src/styles/theme.css apps/<site>/src/styles/site.css --overlay --check
node scripts/theme/contrast.mjs packages/theme/src/styles/theme.css --overlay apps/<site>/src/styles/site.css
```

Run `pnpm run check:theme` before pushing, or `/tasteful:extract verify packages/theme/src/styles/theme.css apps/<site>/src/styles/site.css`.

### B7. Build and check

```sh
pnpm run build && pnpm run check
```

### B8. Eyeball it

```sh
pnpm --filter <site> dev
```

Check the pages of that app in both schemes (toggle and system preference), `/ru/` and `/es/` if it is trilingual. The other apps are unchanged; a quick look at `pnpm --filter www dev` confirms the shared theme still renders as before.

### B9. Open a PR

```sh
git add apps/<site>
git commit -m "feat(<site>): add site layer <slug> from tasteful"
git push -u origin feat/<site>-layer-<slug>
gh pr create --fill
```

The shared theme is untouched, so no `shared-theme` label is needed. CI deploys the app's Workers preview and runs Lighthouse (accessibility ≥ 95).

### Rollback

Delete the layer's contents (leave a comment-only `site.css`, so the Shell.astro import still resolves) or revert the commit. Remove font packages the app no longer imports with `pnpm --filter <site> remove <package>`.
