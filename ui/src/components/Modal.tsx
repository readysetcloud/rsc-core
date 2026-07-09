import { useEffect, useRef, type ReactNode } from 'react';
import { cx } from './cx';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** Accessible label for the dialog. */
  'aria-label'?: string;
}

/**
 * Native <dialog>-based modal: focus trapping, Esc-to-close, and ::backdrop
 * come from the platform. Renders as a bottom sheet on small screens
 * (see .modal in components.css).
 */
export function Modal({ open, onClose, children, className, ...rest }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={cx('modal', className)}
      onClose={onClose}
      onClick={(e) => {
        // click on the backdrop (the dialog element itself) closes
        if (e.target === ref.current) onClose();
      }}
      {...rest}
    >
      {children}
    </dialog>
  );
}
