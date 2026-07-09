# Working plan — next session pickup

Written 2026-07-09 as a handoff. Context: waves 1–3 + perf sprint + share links shipped (see ROADMAP.md checkmarks, PRs #47–#75). `TODO.md` is the legacy code-quality list (mostly done); ROADMAP.md is the feature backlog; this file is **how Dan wants the work run** plus the prioritized queue.

## Working agreement (Dan's process, 2026-07-09)

1. **Maximize parallelism.** Independent features run as parallel worktree agents, one PR each. The proven loop: scout file surfaces → parallel implementation agents → bot triage per PR (CodeRabbit + Gemini + Codex review every PR; implement real findings, decline nits with reasons) → merge train ordered by blast radius, resolving conflicts between cars. Stack PRs only when they touch the same render-path internals.
2. **Staging deploy per PR.** Dan reviews each PR *visually on the site*, not just in the diff. Each open PR needs its own deployed preview build. This infra does not exist yet — it is the first backlog item below, and a prerequisite for the review flow Dan wants.
3. **Regression guarantee per PR.** Every feature PR must make regressions either:
   - **(a) impossible** — pure-function unit tests covering the feature's logic seams (the codebase convention: extract logic into `src/utils/*.ts`, test exhaustively incl. nulls — `+null === 0` has bitten five times), or
   - **(b) machine-checkable** — a short, self-contained browser-automation acceptance check (the established pattern: puppeteer-core + system Chromium against `npm run preview` or a staging URL) that a machine-use agent can run from a one-line prompt. Store these under `checks/` (to create), one per feature, named after the feature. Each PR body states which guarantee it ships and points at the tests/check.

## Prioritized queue

### 1. PR-preview staging infra (build first — unblocks the review flow)
GitHub Actions: on PR open/sync, build with `vite --base=/Demonstrable-Plotalizer/previews/pr-<N>/` and publish to the Pages artifact under `previews/pr-<N>/` (or a `gh-pages` branch with per-PR dirs; keep prod at the root untouched). Comment the preview URL on the PR; clean up on close. Gotchas: the prod deploy workflow must not race per-PR publishes; `?data=`/`#view=` links must work under the subpath (BASE_URL is already respected in App).
*Regression guarantee: (b) — a check that opens the preview URL and asserts the app boots and renders the sample matrix.*

### 2. Column-selection UX sprint (deferred from 2026-07-08, still wanted)
"With 30 cols it's currently very fiddly." Ideas to scope with Dan: search/multi-select in the column list, select-all-in-group, invert selection, quick presets ("top N by correlation" exists via sort — surface it here), possibly a compact matrix-minimap toggle. Touches ControlPanel + columnUtils only — parallel-safe with most other work.
*Guarantee: (a) for the selection logic; (b) for the interaction feel.*

### 3. Remaining roadmap issues (all parallel-friendly unless noted)
| Item | Surface | Guarantee |
|---|---|---|
| #44 session history (undo/state timeline, per-file in IndexedDB) | App state + fileHistory | (a) for snapshot/restore logic; (b) for undo UX |
| #46 axis scaling (symlog, percentile clipping, shared domains) | scales in ScatterPlotMatrix + ControlPanel | (a) hand-computed domain tests |
| #45 smarter grouping | groupUtils + ControlPanel | (a) |
| #37 clustering (k-means → derived category column) | new util + App; composes with color-by/facets | (a) for math; (b) for the color composition |
| #34 tile drag-to-reorder | ScatterPlotMatrix interaction layer — **conflicts with any render-path work; don't parallelize with #32** | (b) |
| #32 density/chips — **PARKED** by Dan (brushing-semantics risk); needs a design conversation before any code | render path | — |
| #35 cross-plot tracing | overlay layer + spatial grid | (b) |

### 4. Small known items (bundle into a polish PR when convenient)
- `UrlInput` keeps typed URL in local state → lost when the Data section collapses (found during #70 triage).
- `aria-live`/`role="status"` on the notice banners (declined as out-of-scope in #67 triage; fine as a bundled a11y pass).
- Data table virtualization past the 1,000-row cap (noted in #60).
- `TODO.md` final audit: verify remaining items are all done/stale, then delete the file.
- RAF scheduler tuning: 4-cells/frame pacing floors large-matrix paints (~230ms for 56 cells) now that WebGL made per-cell cost tiny — revisit the budget.

## Conventions the next agent must keep
- Gates on every PR: `npm run typecheck` clean, `npm run test:run` green (perf thresholds are ×CI_FACTOR on CI), `npm run build` OK.
- Anything that changes pixels goes into `buildRenderKey` (also keys the ImageData LRU).
- All cell-value coercion via `cellValueUtils` (missing → NaN, never 0).
- Merge commits (repo style), `Co-Authored-By: Claude Fable 5` trailer, PR bodies end with the Claude Code attribution.
- Stacked PRs: merge base *without* deleting the branch → retarget the stacked PR to main via `gh api -X PATCH` → then delete the branch (GitHub auto-closes otherwise and won't reopen).
- CI only runs on PRs targeting main — after retargeting a stacked PR, push an empty commit to trigger checks.
