import { useState, type FormEvent, type ReactNode } from 'react';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { Input, PasswordInput } from '../../components/Input';
import { forgotPassword, isAuthError, respondNewPassword, signIn } from '../core';
import { validateEmail, validatePassword } from '../validate';
import { AuthCard } from './AuthCard';
import { PasswordRequirements } from './PasswordRequirements';

export interface LoginFormProps {
  /** Called after a successful sign-in (session already saved). */
  onSuccess: () => void;
  /**
   * Called when the account still needs email verification — route to your
   * confirm/sign-up screen (a fresh code is already sent). The password is
   * passed along so the confirm step can finish sign-in (feed it to
   * SignUpForm's initialConfirmPassword); it never touches storage.
   */
  onNeedsConfirmation?: (email: string, password?: string) => void;
  /**
   * Called when the pool demands a password reset before sign-in —
   * route to your reset screen (a reset code is already on its way;
   * feed the email to ForgotPasswordForm's initialEmail + startAtReset).
   */
  onPasswordResetRequired?: (email: string) => void;
  /** Brand slot above the title. */
  logo?: ReactNode;
  /** e.g. <Link to="/forgot-password">Forgot password?</Link> */
  forgotPasswordLink?: ReactNode;
  /** e.g. <>New here? <Link to="/signup">Create an account</Link></> */
  signUpPrompt?: ReactNode;
}

type Step = { name: 'credentials' } | { name: 'newPassword'; session: string };

export function LoginForm({
  onSuccess,
  onNeedsConfirmation,
  onPasswordResetRequired,
  logo,
  forgotPasswordLink,
  signUpPrompt
}: LoginFormProps) {
  const [step, setStep] = useState<Step>({ name: 'credentials' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);

  const submitCredentials = async (e: FormEvent) => {
    e.preventDefault();
    const errors = { email: validateEmail(email), password: password ? undefined : 'Enter your password.' };
    setFieldErrors(errors);
    if (errors.email || errors.password) return;

    setBusy(true);
    setError('');
    try {
      const result = await signIn(email.trim(), password);
      if (result.kind === 'newPasswordRequired') {
        setStep({ name: 'newPassword', session: result.session });
      } else {
        onSuccess();
      }
    } catch (err) {
      if (isAuthError(err) && err.code === 'UserNotConfirmedException' && onNeedsConfirmation) {
        onNeedsConfirmation(email.trim(), password);
        return;
      }
      if (isAuthError(err) && err.code === 'PasswordResetRequiredException' && onPasswordResetRequired) {
        forgotPassword(email.trim()).catch(() => {});
        onPasswordResetRequired(email.trim());
        return;
      }
      setError(err instanceof Error ? err.message : 'Something went wrong — please try again.');
    } finally {
      setBusy(false);
    }
  };

  const submitNewPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (step.name !== 'newPassword') return;
    const invalid = validatePassword(newPassword);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await respondNewPassword(email.trim(), newPassword, step.session);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong — please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (step.name === 'newPassword') {
    return (
      <AuthCard
        title="Set a new password"
        subtitle="Your account requires a new password before signing in."
        logo={logo}
      >
        <form onSubmit={submitNewPassword} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {error && <Alert variant="error">{error}</Alert>}
          <PasswordInput
            label="New password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            autoFocus
          />
          <PasswordRequirements />
          <Button type="submit" block loading={busy} loadingLabel="Saving…">
            Save and sign in
          </Button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Sign in" logo={logo} footer={signUpPrompt}>
      <form onSubmit={submitCredentials} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {error && <Alert variant="error">{error}</Alert>}
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
          autoComplete="email"
          autoFocus
        />
        <PasswordInput
          label="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          autoComplete="current-password"
        />
        {forgotPasswordLink && (
          <div style={{ textAlign: 'right', fontSize: '0.8125rem' }}>{forgotPasswordLink}</div>
        )}
        <Button type="submit" block loading={busy} loadingLabel="Signing in…">
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}
