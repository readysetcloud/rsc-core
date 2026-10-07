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
use the same chrome (`../site.css`, `../site.js`) plus `agent/agent.css` for
steps and flow diagrams, so they restyle with the design system. The build
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
