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

```bash
# .npmrc
@readysetcloud:registry=https://npm.pkg.github.com

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
  Badge, Alert, Modal, ToastProvider, useToast,
  Spinner, Skeleton, EmptyState, Container
} from '@readysetcloud/ui';
```

## Auth

One Cognito user pool across all apps (exposed by rsc-core via SSM under `/readysetcloud/auth/*`); each app brings its own app client id.

```tsx
import { configureAuth, AuthProvider, RequireAuth, useAuth } from '@readysetcloud/ui/auth';

// static config…
configureAuth({ region: 'us-east-1', clientId: import.meta.env.VITE_COGNITO_CLIENT_ID });
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

> **Cross-subdomain SSO caveat:** localStorage is per-origin. Sharing a session across `*.readysetcloud.io` subdomains requires a parent-domain cookie — a deliberate future change tracked separately.

## Development

```bash
cd ui
npm install
npm test        # vitest — auth core + validation
npm run build   # tsup → dist/ (ESM + .d.ts)
```
