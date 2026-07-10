/* Component tests for the prebuilt flow entry points added for the
   concurrency-bootcamp platform migration: the reset-required handoff,
   the password riding along to the confirm step, resend on the reset
   step, and auto-sign-in after a reset. The core is mocked — these are
   wiring tests, not Cognito tests (core.test.ts owns those). */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('../core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core')>();
  return {
    ...actual,
    signIn: vi.fn(),
    signUp: vi.fn(),
    confirmSignUp: vi.fn(),
    confirmForgotPassword: vi.fn(),
    forgotPassword: vi.fn(),
    resendConfirmationCode: vi.fn()
  };
});

import {
  AuthError,
  confirmForgotPassword,
  confirmSignUp,
  forgotPassword,
  signIn
} from '../core';
import { ForgotPasswordForm } from './ForgotPasswordForm';
import { LoginForm } from './LoginForm';
import { ResendCodeButton } from './ResendCodeButton';
import { SignUpForm } from './SignUpForm';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

const type = (label: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('LoginForm', () => {
  const fillAndSubmit = () => {
    type('Email', 'a@b.co');
    type('Password', 'Passw0rd1');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  };

  it('routes PasswordResetRequiredException through onPasswordResetRequired with a code already sent', async () => {
    (signIn as Mock).mockRejectedValueOnce(
      new AuthError('Password reset required.', 'PasswordResetRequiredException')
    );
    (forgotPassword as Mock).mockResolvedValueOnce(undefined);
    const onPasswordResetRequired = vi.fn();
    render(<LoginForm onSuccess={vi.fn()} onPasswordResetRequired={onPasswordResetRequired} />);

    fillAndSubmit();

    await waitFor(() => expect(onPasswordResetRequired).toHaveBeenCalledWith('a@b.co'));
    expect(forgotPassword).toHaveBeenCalledWith('a@b.co');
  });

  it('hands the attempted password to onNeedsConfirmation for the confirm-step auto-sign-in', async () => {
    (signIn as Mock).mockRejectedValueOnce(
      new AuthError('Not confirmed.', 'UserNotConfirmedException')
    );
    const onNeedsConfirmation = vi.fn();
    render(<LoginForm onSuccess={vi.fn()} onNeedsConfirmation={onNeedsConfirmation} />);

    fillAndSubmit();

    await waitFor(() =>
      expect(onNeedsConfirmation).toHaveBeenCalledWith('a@b.co', 'Passw0rd1')
    );
  });

  it('shows reset-required as a plain error when no handler is wired', async () => {
    (signIn as Mock).mockRejectedValueOnce(
      new AuthError('Password reset required.', 'PasswordResetRequiredException')
    );
    render(<LoginForm onSuccess={vi.fn()} />);

    fillAndSubmit();

    expect(await screen.findByText('Password reset required.')).toBeTruthy();
    expect(forgotPassword).not.toHaveBeenCalled();
  });
});

describe('SignUpForm', () => {
  it('starts on the confirm step and finishes sign-in with the carried password', async () => {
    (confirmSignUp as Mock).mockResolvedValueOnce(undefined);
    (signIn as Mock).mockResolvedValueOnce({ kind: 'success' });
    const onSuccess = vi.fn();
    render(
      <SignUpForm
        onSuccess={onSuccess}
        initialConfirmEmail="a@b.co"
        initialConfirmPassword="Passw0rd1"
      />
    );

    type(/verification code/i, '123456');
    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(confirmSignUp).toHaveBeenCalledWith('a@b.co', '123456');
    expect(signIn).toHaveBeenCalledWith('a@b.co', 'Passw0rd1');
  });
});

describe('ForgotPasswordForm', () => {
  it('starts on the reset step when handed off from login, and resends via forgotPassword', async () => {
    (forgotPassword as Mock).mockResolvedValueOnce(undefined);
    render(<ForgotPasswordForm onSuccess={vi.fn()} initialEmail="a@b.co" startAtReset />);

    // reset step, not the email step
    expect(screen.getByLabelText(/verification code/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send reset code' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
    await waitFor(() => expect(forgotPassword).toHaveBeenCalledWith('a@b.co'));
  });

  it('signs in with the new password after resetting when autoSignIn is set', async () => {
    (confirmForgotPassword as Mock).mockResolvedValueOnce(undefined);
    (signIn as Mock).mockResolvedValueOnce({ kind: 'success' });
    const onSuccess = vi.fn();
    render(
      <ForgotPasswordForm onSuccess={onSuccess} initialEmail="a@b.co" startAtReset autoSignIn />
    );

    type(/verification code/i, '123456');
    type('New password', 'NewPassw0rd');
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(confirmForgotPassword).toHaveBeenCalledWith('a@b.co', '123456', 'NewPassw0rd');
    expect(signIn).toHaveBeenCalledWith('a@b.co', 'NewPassw0rd');
  });

  it('skips sign-in after resetting by default', async () => {
    (confirmForgotPassword as Mock).mockResolvedValueOnce(undefined);
    const onSuccess = vi.fn();
    render(<ForgotPasswordForm onSuccess={onSuccess} initialEmail="a@b.co" startAtReset />);

    type(/verification code/i, '123456');
    type('New password', 'NewPassw0rd');
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(signIn).not.toHaveBeenCalled();
  });
});

describe('ResendCodeButton', () => {
  it('sends through a custom onResend action and starts the cooldown', async () => {
    const onResend = vi.fn().mockResolvedValueOnce(undefined);
    render(<ResendCodeButton email="a@b.co" onResend={onResend} />);

    fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));

    await waitFor(() => expect(onResend).toHaveBeenCalledWith('a@b.co'));
    expect(await screen.findByText(/Resend code in \d+s/)).toBeTruthy();
  });
});
