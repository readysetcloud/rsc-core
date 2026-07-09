import { useId, type ReactNode } from 'react';

export interface FieldRenderProps {
  id: string;
  'aria-invalid': true | undefined;
  'aria-describedby': string | undefined;
}

export interface FieldProps {
  label: ReactNode;
  error?: string;
  hint?: string;
  /** Renders the control, wired with id/aria attributes. */
  children: (props: FieldRenderProps) => ReactNode;
}

/**
 * Label + control + hint/error wrapper. Render-prop so any control
 * (input, textarea, select, custom) gets correct label/aria wiring.
 */
export function Field({ label, error, hint, children }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy
      })}
      {error ? (
        <span id={`${id}-error`} className="field-error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span id={`${id}-hint`} className="field-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
