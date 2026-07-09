import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  /** Icon or illustration shown above the title. */
  icon?: ReactNode;
  /** Call-to-action, e.g. a <Button>. */
  action?: ReactNode;
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      {icon}
      <div className="empty-state-title">{title}</div>
      {description && <p style={{ margin: 0, fontSize: '0.875rem' }}>{description}</p>}
      {action && <div style={{ marginTop: '0.5rem' }}>{action}</div>}
    </div>
  );
}
