import { useState, type FormEvent, type ReactNode } from 'react';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { CodeInput, Input, PasswordInput } from '../../components/Input';
import { confirmSignUp, signIn, signUp } from '../core';
import { validateCode, validateEmail, validateName, validatePassword } from '../validate';
import { AuthCard } from './AuthCard';
import { PasswordRequirements } from './PasswordRequirements';
import { ResendCodeButton } from './ResendCodeButton';

export interface SignUpFormProps {
  /** Called once the account is confirmed (and signed in when possible). */
  onSuccess: () => void;
  logo?: ReactNode;
  /** e.g. <>Already have an account? <Link to="/login">Sign in</Link></> */
  signInPrompt?: ReactNode;
  /**
   * Start directly on the confirm step for this email (used when sign-in
   * discovers an unconfirmed account — a fresh code is already sent).
   */
  initialConfirmEmail?: string;
  /**
   * The password sign-in was attempted with (LoginForm's onNeedsConfirmation
   * hands it over), so confirming finishes sign-in instead of bouncing the
   * user back to the sign-in form. Held in memory only — never persisted.
   */
  initialConfirmPassword?: string;
}

type Step = 'details' | 'confirm';

export function SignUpForm({
  onSuccess,
  logo,
  signInPrompt,
  initialConfirmEmail,
  initialConfirmPassword
}: SignUpFormProps) {
  const [step, setStep] = useState<Step>(initialConfirmEmail ? 'confirm' : 'details');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState(initialConfirmEmail ?? '');
  const [password, setPassword] = useState(initialConfirmPassword ?? '');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{
    firstName?: string;
    lastName?: string;
    email?: string;
    password?: string;
    code?: string;
  }>({});
  const [busy, setBusy] = useState(false);

  const submitDetails = async (e: FormEvent) => {
    e.preventDefault();
    const errors = {
      firstName: validateName(firstName, 'first name'),
      lastName: validateName(lastName, 'last name'),
      email: validateEmail(email),
      password: validatePassword(password)
    };
    setFieldErrors(errors);
    if (Object.values(errors).some(Boolean)) return;

    setBusy(true);
    setError('');
    try {
      await signUp(firstName, lastName, email.trim(), password);
      setStep('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong — please try again.');
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    const codeError = validateCode(code);
    setFieldErrors({ code: codeError });
    if (codeError) return;

    setBusy(true);
    setError('');
    try {
      await confirmSignUp(email.trim(), code.trim());
      // Sign in immediately when we still hold the password; when arriving
      // from the "unconfirmed account" path we don't, so the app routes to
      // sign-in from onSuccess.
      if (password) await signIn(email.trim(), password).catch(() => {});
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong — please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (step === 'confirm') {
    return (
      <AuthCard
        title="Check your email"
        subtitle={`We sent a 6-digit code to ${email.trim()}.`}
        logo={logo}
      >
        <form onSubmit={submitCode} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {error && <Alert variant="error">{error}</Alert>}
          <CodeInput
            value={code}
            onChange={(e) => setCode(e.target.value)}
            error={fieldErrors.code}
            autoFocus
          />
          <Button type="submit" block loading={busy} loadingLabel="Verifying…">
            Verify email
          </Button>
          <div style={{ textAlign: 'center' }}>
            <ResendCodeButton email={email.trim()} onError={setError} />
          </div>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Create your account" logo={logo} footer={signInPrompt}>
      <form onSubmit={submitDetails} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {error && <Alert variant="error">{error}</Alert>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <Input
            label="First name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            error={fieldErrors.firstName}
            autoComplete="given-name"
            autoFocus
          />
          <Input
            label="Last name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            error={fieldErrors.lastName}
            autoComplete="family-name"
          />
        </div>
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
          autoComplete="email"
        />
        <PasswordInput
          label="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          autoComplete="new-password"
        />
        <PasswordRequirements />
        <Button type="submit" block loading={busy} loadingLabel="Creating account…">
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}
