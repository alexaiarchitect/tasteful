# Applying a generated theme in the `sites` repo

`/tasteful:extract` writes `theme.<slug>.css` and `fonts.json` into `.tasteful/<slug>/` and stops. These are the exact steps to try the theme in `~/Documents/Business/alexaiarchitect/sites` (pnpm workspace, Astro 7 + Tailwind 4, Cloudflare Workers). Nothing here is automated by the plugin: you run each step.

Placeholders: `<slug>` is the brief slug; `<out>` is the folder holding the generated files (`.tasteful/<slug>` in the project where you ran `extract`).

## 1. Branch

```sh
cd ~/Documents/Business/alexaiarchitect/sites
git switch main && git pull
git switch -c feat/theme-<slug>
```

## 2. Copy the theme

```sh
cp <out>/theme.<slug>.css packages/theme/src/styles/theme.css
```

The generated file is a full replacement: same tokens, same classes, same dark selectors. No markup changes are needed.

## 3. Add the fonts

Open `<out>/fonts.json`. For every entry in `packages`, add it to `packages/theme/package.json` → `dependencies`, then install:

```sh
pnpm --filter @sites/theme add <package> [<package> …]   # e.g. @fontsource-variable/fraunces
pnpm install
```

The matching `@import "@fontsource-variable/<family>/wght.css";` lines are already in the generated theme, right after the first two lines. If the theme no longer uses Inter or Source Serif 4, you may remove `@fontsource-variable/inter` / `@fontsource-variable/source-serif-4` from `packages/theme/package.json`; leaving them costs nothing at runtime because unused CSS is not imported.

## 4. Keep the first two lines

The file must start with:

```css
@import "tailwindcss";
@source "../";
```

**The `@source` caveat** (from the sites `AGENTS.md`): Tailwind 4 scans only the directory of the app that imports the CSS. `@source "../"` makes it also scan `packages/theme`, where the shared header, footer and cards live. Without it every class used only by the theme package is silently missing from the build. Any new shared package that uses Tailwind classes needs its own `@source` line. `contract.mjs --check` fails a theme that drops these lines, but check again after hand edits.

## 5. Build and check

```sh
pnpm run build && pnpm run check && pnpm run lint
```

All three must pass. A build error that mentions an unknown utility usually means a class contract break: re-run `/tasteful:extract verify <out>/theme.<slug>.css` and fix the finding rather than patching markup.

## 6. Eyeball it

```sh
pnpm --filter www dev
```

Open the landing page, a long blog post (tables, code, blockquote), the `/ru/` and `/es/` versions (long words in headings, buttons and chips), and toggle dark mode. Repeat with `pnpm --filter piano dev` and `pnpm --filter dji dev` if the theme is meant for them too: the theme is shared by every app.

## 7. Open a PR

```sh
git add packages/theme
git commit -m "feat(theme): apply <slug> theme from tasteful"
git push -u origin feat/theme-<slug>
gh pr create --fill
```

The `sites` CI deploys a Workers preview per affected app, comments the preview URL on the PR, and runs Lighthouse on `/`, `/ru/` and `/es/`. Accessibility must stay **≥ 95**; tasteful's contrast floor is designed to keep it there, but Lighthouse is the gate. Review the previews on a phone as well.

## Rollback

Revert the theme commit (`git revert <sha>`) on the branch, or after merge with a revert PR. The previous `theme.css` and font packages come back with it; run `pnpm install` afterwards.
