// @readysetcloud/ui/auth — shared Cognito auth (core + React)

// configuration
export { configureAuth, getConfig, type AuthConfig } from './config';

// framework-agnostic core
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

// validation (matches the pool policy in rsc-core template.yaml)
export {
  isValidEmail,
  isValidPassword,
  validateEmail,
  validatePassword,
  validateName,
  validateCode,
  PASSWORD_REQUIREMENTS
} from './validate';

// React bindings
export { AuthProvider, useAuth, RequireAuth, type AuthState, type RequireAuthProps } from './react';

// flow components
export { AuthCard, type AuthCardProps } from './components/AuthCard';
export { LoginForm, type LoginFormProps } from './components/LoginForm';
export { SignUpForm, type SignUpFormProps } from './components/SignUpForm';
export { ForgotPasswordForm, type ForgotPasswordFormProps } from './components/ForgotPasswordForm';
export { PasswordRequirements } from './components/PasswordRequirements';
export { ResendCodeButton, type ResendCodeButtonProps } from './components/ResendCodeButton';
