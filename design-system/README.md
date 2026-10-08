# Design system guide

The GitHub Pages site for the Ready, Set, Cloud design system, and, under
[`agent/`](agent/), the guide to the agent service and `@readysetcloud/agent`.
Published by `.github/workflows/design-system-pages.yaml` on every push to
`main` that touches this directory, `ui/`, or `agent/README.md`.

## Staying in sync with the package

The guide has no design assets of its own. Pages link the ui package's actual
stylesheets (`ui/styles/index.css`), browser bundles (`ui/dist/browser/ui.global.js`),
and logo — and the color swatches/specimens are read from the live CSS custom
properties at render time (`site.js`). Change a token or a component class in
`ui/` and the published guide re-renders with it; there is nothing to copy or
regenerate by hand.

`site.css` / `site.js` style and wire the guide chrome only — never put brand
values in them.

## LLM version (`/llms.txt`)

The build also publishes `ui/AGENTS.md` verbatim at `/llms.txt` and
`/AGENTS.md` (plus a preface pointing at `ui/styles/tokens.css` and the
gallery pages), so AI agents can be pointed at
`https://design.readysetcloud.io/llms.txt` instead of the repo. There is no
separate doc to maintain — keep `ui/AGENTS.md` current and the published copy
follows on the next deploy.

## Agent guide (`agent/`)

Six authored pages (`index`, `chat`, `tasks`, `agency`, `tools`, `reference`)
that document the agent service: capabilities, how to trigger chat and tasks,
persistent-agent primitives, identity and permissions, and the contracts. They
use the same chrome (`../site.css`, `../site.js`) plus `agent/agent.css` and
`agent/agent.js`, so they restyle with the design system.

Each page has its own format, matched to what a reader is doing there, so the
pages don't read as one template repeated six times: the overview is a landing
page with a "which agent do you need?" picker and tabbed quick starts, chat is
a build-along tutorial, tasks follows one task through a timeline and then
answers "what if…?" questions, agency is a long-form essay with a side table of
contents, tools & permissions answers a security reviewer's questions with a
verdict each, and the reference is a filterable lookup sheet. The format
components live in the "Page formats" block of `agent.css`; the picker, table
of contents highlight, and reference filter are in `agent.js`. Keep a new page
or section in the format of the page it joins.

Diagrams are inline SVG built from a small class vocabulary in `agent.css`
(`d-box`, `d-line`, `d-pill`, `k-primary`, …) that uses token colors only, so
they invert with dark mode like everything else. Motion is used only where it
teaches: a figure with `data-anim="sequence"` reveals its `data-step` groups in
order (sequences, races), `data-anim="cycle"` highlights one step at a time
alongside the matching legend item, and `d-flow` lines animate their dashes to
show direction. `agent.js` drives the first two with a Play/Pause/Replay
control; with `prefers-reduced-motion` or without JavaScript every step is
simply shown. The build
publishes `agent/README.md` verbatim at `/agent/llms.txt` as the LLM-readable
companion. When a page and the package disagree, fix the page: the README and
the code are the source of truth.

## Local preview

```bash
cd ui && npm install && npm run build && cd ..
node scripts/build-design-site.mjs
npx serve dist-design-site   # or: python3 -m http.server -d dist-design-site
```

## Adding a component to the guide

When a component lands in `ui/`, add a demo block to `components.html`:
preview markup using the shipped CSS classes, plus `<pre data-lang="react">`
and `<pre data-lang="html">` snippets (the code tabs and copy buttons are
generated automatically).
