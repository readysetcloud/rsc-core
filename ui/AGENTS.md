# @readysetcloud/ui — Agent Guide

Instructions for AI agents (and humans) consuming or migrating apps onto the shared Ready, Set, Cloud design system. This is the complete API surface and the rules that keep the three surfaces converged.

## What this package is

The single source of truth for brand, components, and auth across:

| Surface | Repo | Consumes via |
| --- | --- | --- |
| Newsletter dashboard | `readysetcloud/newsletter-service` → `dashboard-ui/` | npm |
| Concurrency bootcamp platform | `concurrency-bootcamp` → `platform/` | npm |
| Bootcamp course pages (vanilla JS) | `concurrency-bootcamp` → `js/` | hosted `auth.global.js` |
| readysetcloud.io (Hugo) | `readysetcloud/ready-set-cloud` | hosted `styles/*.css` |

Source lives in `rsc-core/ui`. **Never fork or copy this code into an app — change it here, version it, consume it.**

## Hard rules (violating these defeats the package's purpose)

1. **Never hardcode brand colors** in an app. Use token variables (`rgb(var(--primary-600))`), the Tailwind preset scales (`bg-primary-600`), or the shipped classes (`.btn-primary`).
2. **Raleway is the wordmark face only.** It exists as `--font-logo` for text-rendered logo lockups. Never set UI text in Raleway. Headings = Sora (`--font-display`), body = Manrope (`--font-sans`), data/code = JetBrains Mono (`--font-mono`).
3. **Don't re-implement components that exist here.** If an app needs a variant, add it to this package first.
4. **Respect the responsive contract.** Components ship with 44px touch targets, ≥16px mobile inputs, fluid type, and safe-area handling. Don't override these down.
5. **Don't change the `rsc:auth` session contract** (`{idToken, refreshToken, expiresAt}` in localStorage under key `rsc:auth`). The vanilla course pages and the platform share sessions through it. Change it only deliberately, on both sides, in this package.
6. **Dark mode** is system-preference by default with `<html data-theme="dark|light">` override. Never implement a separate theming mechanism.

## Install (React apps)

```bash
npm install @readysetcloud/ui        # public npm
```

```ts
// main.tsx — ALWAYS import the stylesheet once, before app styles
import '@readysetcloud/ui/styles.css';
// only if the app doesn't already load brand fonts in index.html:
import '@readysetcloud/ui/fonts.css';
```

```js
// tailwind.config.js
module.exports = {
  presets: [require('@readysetcloud/ui/tailwind-preset')],
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    './node_modules/@readysetcloud/ui/dist/**/*.js'  // REQUIRED — components use token classes
  ]
};
```

The preset aliases `blue`→primary, `green`/`teal`→success, `red`/`rose`→error, `orange`/`amber`/`yellow`→warning, `gray`/`slate`→secondary, so existing utility classes stay on-brand during migration without a rename sweep.

## Components — `import { ... } from '@readysetcloud/ui'`

All components are typed, accept `className`, and forward standard HTML props.

| Component | Key props | Notes |
| --- | --- | --- |
| `Button` | `variant: 'primary'\|'secondary'\|'success'\|'warning'\|'error'\|'ghost'`, `size: 'sm'\|'md'\|'lg'`, `block`, `loading`, `loadingLabel` | `loading` disables + spinner + optional label swap. Default `type="button"`. |
| `Input` | `label` (required), `error`, `hint` + all input props | Label/aria wiring automatic. `error` renders red border + `role="alert"` message. |
| `PasswordInput` | same as Input, no `type` | Show/hide toggle built in. |
| `CodeInput` | `label?`, `error`, `length` (default 6) | Numeric, `autoComplete="one-time-code"`, monospace centered. |
| `TextArea` / `Select` | `label`, `error`, `hint` | Same Field wiring. Select takes `<option>` children. |
| `Field` | `label`, `error`, `hint`, `children: (props) => ReactNode` | Render-prop for wiring custom controls. |
| `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardBody`, `CardFooter` | div props | Compound card. |
| `Badge` | `variant: 'primary'\|'success'\|'warning'\|'error'\|'neutral'` | Status pill (uppercase mono). |
| `Alert` | `variant: 'error'\|'success'\|'info'` | `role="alert"` for errors. |
| `Modal` | `open`, `onClose`, `aria-label` | Native `<dialog>`: Esc/backdrop close, focus trap free. Bottom sheet on ≤640px. |
| `ToastProvider` / `useToast()` | `toast(message, { variant?, duration? })` | Mount provider once at app root. Errors default to 8s, others 5s. |
| `Spinner` | span props | Inherits `currentColor`. |
| `Skeleton` | `width`, `height` | Shimmer placeholder. |
| `EmptyState` | `title`, `description?`, `icon?`, `action?` | |
| `Container` | div props | max 72rem, fluid padding. |
| `AppNav` | `appName`, `navItems`, `layout`, `currentServiceId`, `authState`, `services`, auth actions | Shared navbar: hardcoded ReadySetCloud cloud mark, configurable Raleway app name, Manrope nav labels, theme toggle, authenticated-only 9-box app launcher, optional auth controls. `layout="side"` renders a vertical rail (per-item `icon` + grouped `section` headings); default `top` is the horizontal bar. |
| `BadgeChest` | `points`, `level`, `levelName`, `levelMinPoints`, `nextLevel`, `badges`, `inProgress`, `loading`, `showInProgress`, `emptyState` | Cross-app trophy case: level + points header with progress bar, earned badge grid, and in-progress tiles. Presentational — fetch with `createBadgeClient` and pass the data in. |
| `cx(...parts)` | | Classname join helper (replaces clsx for simple cases). |

## Shared navbar and app registry

Use `AppNav` from `@readysetcloud/ui` for every app-level navbar. Do not
recreate a local navbar unless this package is missing a needed variant.

```tsx
import { AppNav, readySetCloudServices } from '@readysetcloud/ui';

<AppNav
  appName="Booked"
  currentServiceId="booked"
  authState={signedIn ? 'authenticated' : 'anonymous'}
  navItems={[
    { id: 'dashboard', label: 'Dashboard', href: '/dashboard', active: true },
    { id: 'campaigns', label: 'Campaigns', href: '/campaigns' }
  ]}
  services={readySetCloudServices}
  user={signedIn ? { name: user.name, email: user.email, avatarUrl: user.picture } : undefined}
/>;
```

Navbar rules:
- The logo mark is not configurable. It uses `assets/cloud-logo.svg` as a CSS
  mask inside the branded azure square. The app name is configurable and renders
  in `--font-logo` (Raleway).
- `navItems` are app-specific. Use `visible: false` for simple gating and
  `active: true` for the current route. The shared app launcher active state is
  driven by `currentServiceId`.
- `layout="side"` renders a vertical 16rem rail instead of the top bar; it
  reads the same `navItems` plus per-item `icon` (a node; an HTML/SVG string for
  the vanilla build) and `section` (heading — consecutive same-section items are
  grouped; ungrouped items stay in place). Sections are ignored in `top`. The
  rail collapses to the shared hamburger drawer on mobile.
- `linkComponent` (React only) routes in-app links (brand, nav items, primary
  action, auth actions) through your router's link for client-side navigation —
  `({ href, ...props }) => <Link to={href} {...props} />`. External items always
  fall back to a plain anchor. The vanilla build always emits anchors.
- `authState="none"` hides all auth controls. `authState="anonymous"` shows
  sign-in/sign-up controls. `authState="authenticated"` shows the profile menu.
- Auth URLs default to `/login`, `/signup`, and `/logout`; override with
  `signInAction`, `signUpAction`, or `signOutAction`. Use `onSignOut` only when
  sign-out must run in JavaScript.
- The 9-box launcher is shown only for authenticated users and only when at
  least one service is visible.

Default `readySetCloudServices` manifest:

| id | App | URL |
| --- | --- | --- |
| `readysetcloud` | Ready, Set, Cloud | `https://readysetcloud.io` |
| `booked` | Booked | `https://booked.readysetcloud.io` |
| `outboxed` | Outboxed | `https://newsletter.readysetcloud.io` |
| `bootcamp` | Bootcamp | `https://bootcamp.readysetcloud.io` |
| `olivias-garden-foundation` | Olivia's Garden Foundation | `https://oliviasgarden.org` |

## Badges / gamification — `import { BadgeChest, createBadgeClient } from '@readysetcloud/ui'`

One badge chest spans every app (keyed on the shared Cognito `sub`). The
rules engine, catalog, and API live in `rsc-core`; this package ships the read
client and the presentational component so every app renders the chest
identically.

```tsx
import { BadgeChest, createBadgeClient } from '@readysetcloud/ui';
import { useAuth } from '@readysetcloud/ui/auth';

const badges = createBadgeClient({
  baseUrl: import.meta.env.VITE_CORE_API_URL, // rsc-core SSM /readysetcloud/api-url
                                              // (prod: https://api.readysetcloud.io)
  getToken                                    // from useAuth()
});

const data = await badges.getChest();           // GET /badges/me
<BadgeChest {...data} loading={loading} />;

// record activity from the client (the rules engine decides if it earns a badge):
await badges.recordActivity({ action: 'lesson.completed', service: 'bootcamp' });
```

- `createBadgeClient({ baseUrl, getToken?, fetch? })` → `getChest()`,
  `getCatalog()`, `recordActivity()`. Framework-agnostic (just `fetch`), so the
  vanilla course pages and server code can use it too.
- `BadgeChest` is data-in/render-out — spread the `getChest()` response onto it.
  Pass `loading` for skeletons, `emptyState` to override the "no badges" copy,
  and `showInProgress={false}` to hide locked badges.
- Backend contract, catalog format, and how to add a badge live in the
  `rsc-core` root README.

## Auth — `import { ... } from '@readysetcloud/ui/auth'`

One Cognito user pool for all apps (rsc-core SSM: `/readysetcloud/auth/user-pool-id`, `.../user-pool-client-id`); each app brings its own app client id.

**Setup (required before any auth call):**
```ts
configureAuth({ region: 'us-east-1', clientId: '<app client id>' });
// or an async loader:
configureAuth(async () => (await fetch('/auth-config.json')).json());
```

**React:**
```tsx
<AuthProvider>...</AuthProvider>                    // mount once at root
const { signedIn, user, getToken, signOut } = useAuth();
<RequireAuth fallback={<Navigate to="/login" />}>   // router-agnostic guard
```
- `user` = decoded id-token claims (`email`, `given_name`, `family_name`, `sub`, plus custom claims)
- `getToken()` returns a valid id token, auto-refreshing 60s before expiry — use for `Authorization: Bearer` headers
- Cross-tab sign-in/out sync is automatic (storage events)
- Cross-subdomain SSO across `*.readysetcloud.io` is automatic: the auth core
  mirrors `rsc:auth` into a JS-readable parent-domain cookie named `rsc_auth`
  with `Domain=.readysetcloud.io`, `SameSite=Lax`, `Secure`, and a 30-day max
  age. Do not configure this on `oliviasgarden.org` unless intentionally
  changing its auth boundary. A stronger HttpOnly model requires server-side
  broker/token-exchange support and is not what this package implements today.

**Prebuilt flows** (each renders a complete `AuthCard`; pass your router's links):
```tsx
<LoginForm onSuccess={} onNeedsConfirmation={(email, password?)=>} onPasswordResetRequired={(email)=>}
           logo={} forgotPasswordLink={} signUpPrompt={} />
<SignUpForm onSuccess={} logo={} signInPrompt={} initialConfirmEmail={} initialConfirmPassword={} />
<ForgotPasswordForm onSuccess={} logo={} signInLink={} initialEmail={} startAtReset autoSignIn />
```
Flow behaviors already handled: NEW_PASSWORD_REQUIRED challenge, unconfirmed-account → resend + confirm step (feed `onNeedsConfirmation`'s email/password to `SignUpForm`'s `initialConfirm*` so confirming finishes sign-in), PasswordResetRequiredException → reset code fired + `onPasswordResetRequired` (feed the email to `ForgotPasswordForm`'s `initialEmail` + `startAtReset`), 6-digit code entry with 60s resend cooldown on both confirm and reset steps, optional auto-sign-in after reset, friendly Cognito error copy. `ResendCodeButton` accepts `onResend` (default `resendConfirmationCode`; pass `forgotPassword` for reset codes).

**Core functions** (framework-agnostic, all promise-based): `signIn`, `signUp(firstName, lastName, email, password)` — the pool REQUIRES given/family name — `confirmSignUp`, `resendConfirmationCode`, `forgotPassword`, `confirmForgotPassword`, `respondNewPassword`, `getFreshIdToken`, `signOut`, `readSession`, `isSignedIn`, `claims`, `onAuthChange`.

**Validation** (matches the ACTUAL pool policy — 8+ chars, upper, lower, number, **symbols NOT required**): `validateEmail`, `validatePassword`, `validateName`, `validateCode`, `PASSWORD_REQUIREMENTS`.

## Chat — `import { ... } from '@readysetcloud/ui/chat'`

Streaming chat surface for the AgentCore agent (`@readysetcloud/agent`). On its
own subpath (like `./auth`) so apps that don't render chat don't pull in
`react-markdown` & friends. The app owns auth: it supplies a `getConnectionUrl`
that returns a presigned `wss://` URL, and the components never import app auth.

```tsx
import { Chat } from '@readysetcloud/ui/chat';
import { useAuth } from '@readysetcloud/ui/auth';

const { user, getToken } = useAuth();
const authed = async (path, body) =>
  (await fetch(`${CORE_API_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })).json();

// 1. Create a session once (optionally set prompt/model), keep the id in state.
const { sessionId } = await authed('/agent/sessions', { systemPrompt, modelId });

// 2. Presign per (re)connect. The verified Cognito sub becomes the agent's
//    userId server-side — never pass it from the client.
const getConnectionUrl = async (sid?: string) => (await authed('/agent/connect', { sessionId: sid })).wsUrl;

<Chat sessionId={sessionId} userId={user.sub} getConnectionUrl={getConnectionUrl} title="Assistant" />;
```

`CORE_API_URL` is the rsc-core SSM `/readysetcloud/api-url` value. Creating a
session is where prompt/model are chosen; the deployed runtime is generic and
loads that config by `sessionId`, so behavior changes need no redeploy.

| Export | Purpose |
| --- | --- |
| `Chat` | Drop-in chat surface. Props = `useAgentChat` options + `title?`, `initialQuery?`. |
| `useAgentChat({ sessionId, userId?, getConnectionUrl, autoConnect? })` | Owns connection lifecycle (reconnect/backoff) + streaming state. Build your own UI on it. |
| `WebSocketChatClient` | Framework-agnostic transport; takes the injected `getConnectionUrl`. |
| `ChatMessage` | Presentational bubble. |
| types | `ChatProps`, `UseAgentChat`, `UseAgentChatOptions`, `ChatMessageData`, `ServerMessage`, `AgentStreamEventBody`, `ConnectionStatus`, `ServerMessageListener`. |

- Components use the token classes (`card`, `btn-primary`, `input`,
  `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary-600`,
  `bg-error-100`) — no restyling needed, theme follows the host.
- Markdown bubbles use `prose` classes; they render fine without
  `@tailwindcss/typography`, but add that plugin in the app for richer
  formatting.
- The wire protocol (`chat/protocol.ts`) mirrors `@readysetcloud/agent`'s
  `protocol.ts` (the source of truth) — kept as a local copy so this package
  stays frontend-only with no backend dependency.

## Non-React consumers (hosted assets)

Published to the assets bucket on every rsc-core deploy:

```html
<link rel="stylesheet" href="https://<assets-host>/ui/<version>/styles/index.css">
<script src="https://<assets-host>/ui/<version>/auth.global.js"></script>
<script>
  rscAuth.configureAuth({ region: 'us-east-1', clientId: '...' });
</script>
```
- `ui/<version>/` is immutable (1y cache); `ui/latest/` is a 5-minute pointer
- `styles/tokens.css` alone = variables only (for a site keeping its own components but adopting the palette)
- `auth.global.js` exposes the full core as `window.rscAuth` — same `rsc:auth` contract, so it shares sessions with npm-consuming SPAs on the same origin

## Migration playbooks

### concurrency-bootcamp `platform/` (smallest — its code IS this package's ancestor)
1. `npm i @readysetcloud/ui`; import `styles.css`; adopt the Tailwind preset; delete the token blocks from `src/index.css` and color/font config from `tailwind.config.js`.
2. Delete `src/lib/auth.ts`, `src/lib/validate.ts` → import from `@readysetcloud/ui/auth`. Keep `configureAuth(async () => ...)` pointed at `/auth-config.json`.
3. Replace `src/context/AuthContext.tsx` with the package's `AuthProvider`/`useAuth`/`RequireAuth` (RequireAuth here takes a `fallback` node instead of rendering a redirect itself).
4. Replace `src/components/forms.tsx` usage: `AuthCard`→`AuthCard`, `Field`→`Input`, `PasswordField`→`PasswordInput`, `CodeField`→`CodeInput`, `FormAlert`→`Alert variant="error"`, `SubmitButton`→`Button type="submit" loading`, `ResendCodeButton`→same name. Or replace whole pages with `LoginForm`/`SignUpForm`/`ForgotPasswordForm`.
5. Course pages (`js/account.js`): replace its embedded auth logic with the hosted `auth.global.js` when touched — the session contract is identical, so this can be incremental.

### newsletter-service `dashboard-ui/` (biggest win — drops aws-amplify)
1. Install + styles + preset as above. The shipped `.btn-*`/`.card`/`.input` classes intentionally match the app's existing `@layer components` definitions — delete those layers from `src/index.css`, keep app-specific utilities.
2. Replace `src/components/ui/*` equivalents (Button, Input, Card, Modal, Toast, Badge, Loading/Skeleton, EmptyState, Container) with package imports; keep app-specific components (charts, analytics, issues) local.
3. Auth migration OFF amplify: remove `aws-amplify` dep and `src/config/amplify.ts`; rewrite `src/contexts/AuthContext.tsx` on top of `@readysetcloud/ui/auth` (`configureAuth` with the app's client id via env). Derived flags (`isAdmin`, `tenantId`, role checks) come from `claims()`/`useAuth().user` — the same JWT claims amplify was parsing.
4. NOTE: users stay signed in only if the amplify → `rsc:auth` migration reads the existing Cognito tokens; simplest accepted behavior is a one-time re-login. Flag this in the PR.
5. Fix the password copy: the app currently claims special characters are required — the pool does not (`RequireSymbols: false`). Use `PASSWORD_REQUIREMENTS`.

### ready-set-cloud (Hugo)
1. Link `tokens.css` (or full `index.css`) from the hosted assets in `layouts/partials/head.html`.
2. Map theme SCSS variables to the tokens where practical (`$primary-color: rgb(var(--primary-500))` equivalents). Subtle changes only — this site's look is the brand anchor.
3. No auth on this site today; if added, use the hosted `auth.global.js`.

## Developing this package

```bash
cd ui
npm install
npm test          # vitest — auth core + registry + validation
npm run build     # tsup → dist/ (npm ESM+dts) + dist/browser/ (ESM+IIFE)
npm run typecheck
```

Checklist for changes: keep class names stable (apps depend on them) · both light AND dark values for any new token · mobile-first (44px targets, ≥16px inputs) · new colors go through the ramp convention (50–950 + dark inversion) · bump `version` in package.json (deploy publishes hosted assets under it; CI publishes to npm when the version is new).
