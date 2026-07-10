# @readysetcloud/ui

Shared design tokens, UI components, and Cognito auth for every Ready, Set, Cloud surface — the newsletter dashboard, the concurrency bootcamp platform, and readysetcloud.io.

## The brand, in one place

| Layer | Decision |
| --- | --- |
| Primary | `#219EFF` azure — full 50–950 ramp with dark-mode inversion |
| Semantics | success `#14B8A6` · warning `#F97316` · error `#C81E22` |
| Type | **Sora** headings · **Manrope** body · **JetBrains Mono** data/code |
| Wordmark | **Raleway** is the logo face only (`--font-logo`) — never UI text |
| Shape | 4–6px radius, soft shadows — sharper than the old app look, not square |
| Responsive | 44px touch targets, fluid `clamp()` type, safe-area insets, ≥16px mobile inputs |

## Install

Published to public npm on every prod deploy (new versions only):

```bash
npm install @readysetcloud/ui
```

## Styles

```ts
// main.tsx — tokens + base + component classes (light & dark)
import '@readysetcloud/ui/styles.css';

// only if your app doesn't already load the brand fonts:
import '@readysetcloud/ui/fonts.css';
```

Dark mode: follows the system by default; force with `<html data-theme="dark">` (same convention the apps already use).

### Tailwind (for your app's own UI)

```js
// tailwind.config.js
module.exports = {
  presets: [require('@readysetcloud/ui/tailwind-preset')],
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    './node_modules/@readysetcloud/ui/dist/**/*.js'
  ]
};
```

Every preset color resolves through the token CSS variables, so `bg-primary-600` is always on-brand and dark-mode aware. Semantic aliases (`blue`→primary, `red`→error, `gray`→secondary, …) keep existing utility usage working during migration.

### Non-React consumers (Hugo, course pages) — hosted assets

Every rsc-core deploy publishes the styles and a browser auth bundle to the
assets bucket (same model as Amplify's hosted UI). Versioned paths are
immutable; `latest/` is a 5-minute pointer:

```
ui/<version>/styles/index.css      tokens + base + component classes
ui/<version>/styles/tokens.css     variables only
ui/<version>/auth.global.js        IIFE — window.rscAuth (~6KB)
ui/<version>/auth.js               ESM build of the same core
ui/latest/...                      short-cache pointer to the newest version
```

```html
<link rel="stylesheet" href="https://<assets-host>/ui/0.1.0/styles/index.css">
<button class="btn btn-primary">Subscribe</button>

<script src="https://<assets-host>/ui/0.1.0/auth.global.js"></script>
<script>
  rscAuth.configureAuth({ region: 'us-east-1', clientId: '...' });
  if (rscAuth.isSignedIn()) { /* ... */ }
</script>
```

Publishing runs in the deploy workflows via `scripts/publish-ui-assets.mjs`;
public read comes from the `PublicReadUiAssets` bucket policy statement.

## Components

```tsx
import {
  Button, Input, PasswordInput, CodeInput, TextArea, Select,
  Card, CardHeader, CardTitle, CardBody, CardFooter,
  Badge, Alert, Modal, AppNav, ToastProvider, useToast,
  Spinner, Skeleton, EmptyState, Container
} from '@readysetcloud/ui';
```

## App registry and navbar

Register shared surfaces in `service-registry.json`, then pass the visible services
to the shared navbar. Apps can filter by the signed-in user's entitlements before
rendering.

```tsx
import {
  AppNav,
  getVisibleServices,
  readySetCloudServices
} from '@readysetcloud/ui';

const services = getVisibleServices(readySetCloudServices, {
  entitlements: user.entitlements,
  roles: user.roles
});

<AppNav
  appName="Concurrency Bootcamp"
  currentServiceId="concurrency-bootcamp"
  authState="authenticated"
  navItems={[
    { id: 'blog', label: 'Blog', href: '/blog/' },
    { id: 'newsletter', label: 'Newsletter', href: '/newsletter/', highlight: true },
    { id: 'podcast', label: 'Podcast', href: '/podcast/', visible: canAccessPodcast },
    { id: 'talks', label: 'Talks', href: '/talks/' },
    { id: 'about', label: 'About', href: '/authors/allen.helton' }
  ]}
  primaryAction={{ label: 'Join the newsletter', href: '/newsletter/' }}
  services={services}
  user={{ name: user.name, email: user.email, avatarUrl: user.picture }}
  signOutAction={{ label: 'Sign out', href: '/logout' }}
/>;
```

`AppNav` owns the app launcher modal, light/dark toggle, profile avatar, and
design-token-based top nav. It renders the shared ReadySetCloud cloud mark and
uses `--font-logo` for the configurable app name; nav labels remain Manrope UI
text. Pass only the `navItems` each app should show, or set `visible: false` on
individual items.

The default app manifest includes:

| App | URL | Description |
| --- | --- | --- |
| Ready, Set, Cloud | `https://readysetcloud.io` | Technical blog, newsletter, and podcast by Allen Helton. |
| Booked | `https://booked.readysetcloud.io` | Content app for creators that helps monitor paid campaigns and social media tracking. |
| Outboxed | `https://newsletter.readysetcloud.io` | Newsletter app that powers the Ready, Set, Cloud Picks of the Week. |
| Bootcamp | `https://bootcamp.readysetcloud.io` | Learning app teaching advanced production lessons for senior engineers. |
| Olivia's Garden Foundation | `https://oliviasgarden.org` | Nonprofit app dedicated to educating others on gardening, homesteading, and animal care. |

The 9-box app launcher is shown only for authenticated users and only when at
least one service is visible.

Auth controls are explicit:

```tsx
// No auth UI at all
<AppNav appName="ReadySetCloud" authState="none" />;

// Anonymous user: show sign-in/sign-up actions
<AppNav appName="ReadySetCloud" authState="anonymous" />;

// Signed-in user: show profile avatar and optional sign-out
<AppNav
  appName="ReadySetCloud"
  authState="authenticated"
  user={{ name: user.name, email: user.email, avatarUrl: user.picture }}
/>;
```

If `authState` is omitted, `AppNav` shows authenticated controls when `user` is
provided and hides auth controls otherwise. Auth URLs default to `/login`,
`/signup`, and `/logout`; override them with `signInAction`, `signUpAction`, or
`signOutAction`. Use `onSignOut` instead of `signOutAction` when sign-out is
handled in JavaScript. By default it writes
`data-theme="light"` or `data-theme="dark"` to `<html>` so the shared tokens
switch themes consistently across apps.

## Auth

One Cognito user pool across all apps (exposed by rsc-core via SSM under `/readysetcloud/auth/*`); each app brings its own app client id.

```tsx
import { configureAuth, AuthProvider, RequireAuth, useAuth } from '@readysetcloud/ui/auth';

// static config…
configureAuth({
  region: 'us-east-1',
  clientId: import.meta.env.VITE_COGNITO_CLIENT_ID
});
// …or a runtime loader (how concurrency bootcamp does it)
configureAuth(async () => (await fetch('/auth-config.json')).json());

<AuthProvider>
  <Route path="/app" element={
    <RequireAuth fallback={<Navigate to="/login" />}>
      <Dashboard />
    </RequireAuth>
  } />
</AuthProvider>;

// in components
const { signedIn, user, getToken, signOut } = useAuth();
const res = await fetch(url, { headers: { Authorization: `Bearer ${await getToken()}` } });
```

Prebuilt flows (router-agnostic — pass your own links):

```tsx
import { LoginForm, SignUpForm, ForgotPasswordForm } from '@readysetcloud/ui/auth';

<LoginForm
  onSuccess={() => navigate('/app')}
  onNeedsConfirmation={(email) => navigate(`/signup?confirm=${email}`)}
  forgotPasswordLink={<Link className="auth-link" to="/forgot-password">Forgot password?</Link>}
  signUpPrompt={<>New here? <Link to="/signup">Create an account</Link></>}
/>
```

The session contract is the `rsc:auth` localStorage document (`{idToken, refreshToken, expiresAt}`) — identical to what the concurrency bootcamp platform and course pages already share. Sign-in on one surface of an origin is sign-in on all of them; tokens auto-refresh 60s before expiry; offline never signs you out.

For SSO across `*.readysetcloud.io`, the auth core defaults to a parent-domain
cookie named `rsc_auth` with `Domain=.readysetcloud.io`, `SameSite=Lax`,
`Secure`, and a 30-day max age. It still uses `rsc:auth` locally, but mirrors it
into that JS-readable parent-domain cookie so sibling subdomains can bootstrap
the session. Unrelated domains such as `oliviasgarden.org` do not opt in unless
they explicitly set `sharedCookieDomain`.

> **Security note:** this keeps the current browser-token model. A stronger
> HttpOnly cookie session would require a backend auth broker/token exchange.

## Development

```bash
cd ui
npm install
npm test        # vitest — auth core + validation
npm run build   # tsup → dist/ (ESM + .d.ts)
```
