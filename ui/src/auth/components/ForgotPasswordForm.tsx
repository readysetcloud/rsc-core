import { useState, type FormEvent, type ReactNode } from 'react';
import { Alert } from '../../components/Alert';
import { Button } from '../../components/Button';
import { CodeInput, Input, PasswordInput } from '../../components/Input';
import { confirmForgotPassword, forgotPassword } from '../core';
import { validateCode, validateEmail, validatePassword } from '../validate';
import { AuthCard } from './AuthCard';
import { PasswordRequirements } from './PasswordRequirements';

export interface ForgotPasswordFormProps {
  /** Called after the password is reset — route to sign-in. */
  onSuccess: () => void;
  logo?: ReactNode;
  /** e.g. <Link to="/login">Back to sign in</Link> */
  signInLink?: ReactNode;
}

type Step = 'email' | 'reset';

export function ForgotPasswordForm({ onSuccess, logo, signInLink }: ForgotPasswordFormProps) {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    code?: string;
    password?: string;
  }>({});
  const [busy, setBusy] = useState(false);

  const submitEmail = async (e: FormEvent) => {
    e.preventDefault();
    const emailError = validateEmail(email);
    setFieldErrors({ email: emailError });
    if (emailError) return;

    setBusy(true);
    setError('');
    try {
      await forgotPassword(email.trim());
      setStep('reset');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong — please try again.');
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async (e: FormEvent) => {
    e.preventDefault();
    const errors = {
      code: validateCode(code),
      password: validatePassword(newPassword)
    };
    setFieldErrors(errors);
    if (errors.code || errors.password) return;

    setBusy(true);
    setError('');
    try {
      await confirmForgotPassword(email.trim(), code.trim(), newPassword);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong — please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (step === 'reset') {
    return (
      <AuthCard
        title="Reset your password"
        subtitle={`Enter the 6-digit code we sent to ${email.trim()} and choose a new password.`}
        logo={logo}
        footer={signInLink}
      >
        <form onSubmit={submitReset} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {error && <Alert variant="error">{error}</Alert>}
          <CodeInput
            value={code}
            onChange={(e) => setCode(e.target.value)}
            error={fieldErrors.code}
            autoFocus
          />
          <PasswordInput
            label="New password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            error={fieldErrors.password}
            autoComplete="new-password"
          />
          <PasswordRequirements />
          <Button type="submit" block loading={busy} loadingLabel="Resetting…">
            Reset password
          </Button>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Forgot your password?"
      subtitle="Enter your email and we'll send you a reset code."
      logo={logo}
      footer={signInLink}
    >
      <form onSubmit={submitEmail} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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
        <Button type="submit" block loading={busy} loadingLabel="Sending…">
          Send reset code
        </Button>
      </form>
    </AuthCard>
  );
}
