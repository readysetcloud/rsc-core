import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cx } from './cx';
import { Field } from './Field';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  hint?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, hint, className, children, ...rest },
  ref
) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(field) => (
        <select
          ref={ref}
          className={cx('input', error && 'input-error', className)}
          {...field}
          {...rest}
        >
          {children}
        </select>
      )}
    </Field>
  );
});
