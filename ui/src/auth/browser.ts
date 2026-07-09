/*
 * Browser bundle entry — the framework-agnostic auth core for plain
 * <script> consumers (course pages, static sites). No React, no deps.
 *
 * IIFE build exposes everything as `window.rscAuth`:
 *
 *   <script src="https://<assets>/ui/<version>/auth.global.js"></script>
 *   <script>
 *     rscAuth.configureAuth({ region: 'us-east-1', clientId: '...' });
 *     if (rscAuth.isSignedIn()) { ... }
 *   </script>
 *
 * The ESM build (auth.js) serves `import { signIn } from '.../auth.js'`.
 */

export { configureAuth, getConfig, type AuthConfig } from './config';
export {
  AUTH_KEY,
  AuthError,
  isAuthError,
  errorMessage,
  readSession,
  isSignedIn,
  claims,
  onAuthChange,
  signIn,
  signUp,
  confirmSignUp,
  resendConfirmationCode,
  forgotPassword,
  confirmForgotPassword,
  respondNewPassword,
  getFreshIdToken,
  signOut,
  type Session,
  type IdClaims,
  type SignInResult
} from './core';
export {
  isValidEmail,
  isValidPassword,
  validateEmail,
  validatePassword,
  validateName,
  validateCode,
  PASSWORD_REQUIREMENTS
} from './validate';
