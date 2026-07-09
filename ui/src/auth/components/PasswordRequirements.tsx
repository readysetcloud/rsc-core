import { PASSWORD_REQUIREMENTS } from '../validate';

/** The pool's actual password policy, shown under password fields. */
export function PasswordRequirements() {
  return (
    <ul
      style={{
        margin: 0,
        paddingLeft: '1.125rem',
        fontSize: '0.75rem',
        color: 'rgb(var(--muted-foreground))',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.125rem'
      }}
    >
      {PASSWORD_REQUIREMENTS.map((req) => (
        <li key={req}>{req}</li>
      ))}
    </ul>
  );
}
