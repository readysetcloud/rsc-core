import { useEffect, useRef, useState } from 'react';
import { resendConfirmationCode } from '../core';

export interface ResendCodeButtonProps {
  email: string;
  /** Cooldown between sends, seconds (default 60). */
  cooldown?: number;
  /**
   * The send action (default: resendConfirmationCode, for sign-up
   * confirmation). Pass forgotPassword for reset-code flows.
   */
  onResend?: (email: string) => Promise<void>;
  onError?: (message: string) => void;
}

/** "Resend code" text button with a cooldown timer. */
export function ResendCodeButton({
  email,
  cooldown = 60,
  onResend = resendConfirmationCode,
  onError
}: ResendCodeButtonProps) {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearInterval(timer.current), []);

  const start = () => {
    setSecondsLeft(cooldown);
    timer.current = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) window.clearInterval(timer.current);
        return s - 1;
      });
    }, 1000);
  };

  const resend = async () => {
    try {
      await onResend(email);
      start();
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'Could not resend the code.');
    }
  };

  return (
    <button
      type="button"
      className="auth-link auth-text-button"
      onClick={resend}
      disabled={secondsLeft > 0}
    >
      {secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : 'Resend code'}
    </button>
  );
}
