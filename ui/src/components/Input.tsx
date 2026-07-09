import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { cx } from './cx';
import { Field } from './Field';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, className, ...rest },
  ref
) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(field) => (
        <input
          ref={ref}
          className={cx('input', error && 'input-error', className)}
          {...field}
          {...rest}
        />
      )}
    </Field>
  );
});

export interface PasswordInputProps extends Omit<InputProps, 'type'> {}

/** Password input with a show/hide toggle. */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ label, error, hint, className, ...rest }, ref) {
    const [visible, setVisible] = useState(false);
    return (
      <Field label={label} error={error} hint={hint}>
        {(field) => (
          <div style={{ position: 'relative' }}>
            <input
              ref={ref}
              type={visible ? 'text' : 'password'}
              className={cx('input', error && 'input-error', className)}
              style={{ paddingRight: '3.25rem' }}
              {...field}
              {...rest}
            />
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              aria-label={visible ? 'Hide password' : 'Show password'}
              className="auth-link"
              style={{
                position: 'absolute',
                right: '0.5rem',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.75rem',
                minHeight: 'auto'
              }}
            >
              {visible ? 'Hide' : 'Show'}
            </button>
          </div>
        )}
      </Field>
    );
  }
);

export interface CodeInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'inputMode' | 'maxLength'> {
  label?: string;
  error?: string;
  /** Number of digits (default 6 — Cognito confirmation codes). */
  length?: number;
}

/** Numeric verification-code input (email confirmation, password reset). */
export const CodeInput = forwardRef<HTMLInputElement, CodeInputProps>(function CodeInput(
  { label = 'Verification code', error, length = 6, className, ...rest },
  ref
) {
  return (
    <Field label={label} error={error}>
      {(field) => (
        <input
          ref={ref}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={length}
          className={cx('input', 'input-code', error && 'input-error', className)}
          {...field}
          {...rest}
        />
      )}
    </Field>
  );
});
