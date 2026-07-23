import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export interface SegmentedControlOption<T extends string = string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string = string>
  extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group, e.g. "Comparison baseline". */
  'aria-label': string;
}

/**
 * Compact multi-option toggle (comparison baselines, view switches, tabs-as-
 * filter). One option is always pressed; state is exposed via aria-pressed.
 */
export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  className,
  ...rest
}: SegmentedControlProps<T>) {
  return (
    <div className={cx('segmented-control', className)} role="group" {...rest}>
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          className="segmented-control-option"
          aria-pressed={value === option.value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
