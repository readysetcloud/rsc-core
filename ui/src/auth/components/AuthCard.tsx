import type { ReactNode } from 'react';
import { Card, CardBody } from '../../components/Card';

export interface AuthCardProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Brand slot rendered above the title (logo image or lockup). */
  logo?: ReactNode;
  children: ReactNode;
  /** Rendered below the card body, e.g. "New here? Create an account". */
  footer?: ReactNode;
}

/** Centered card wrapper shared by every auth flow. */
export function AuthCard({ title, subtitle, logo, children, footer }: AuthCardProps) {
  return (
    <Card className="auth-card">
      <CardBody>
        {logo}
        <div>
          <h1 className="auth-title">{title}</h1>
          {subtitle && <p className="auth-subtitle">{subtitle}</p>}
        </div>
        {children}
        {footer && <p className="auth-alt">{footer}</p>}
      </CardBody>
    </Card>
  );
}
