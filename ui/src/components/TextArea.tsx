import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cx } from './cx';
import { Field } from './Field';

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  hint?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, error, hint, className, rows = 4, ...rest },
  ref
) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(field) => (
        <textarea
          ref={ref}
          rows={rows}
          className={cx('input', error && 'input-error', className)}
          {...field}
          {...rest}
        />
      )}
    </Field>
  );
});
