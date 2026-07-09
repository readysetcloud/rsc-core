/*
 * Form validation matching the ACTUAL pool policy (rsc-core template.yaml):
 * MinimumLength 8, RequireUppercase, RequireLowercase, RequireNumbers,
 * RequireSymbols: false.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

export const isValidEmail = (email: string): boolean => EMAIL_RE.test(email.trim());

export const isValidPassword = (password: string): boolean => PASSWORD_RE.test(password);

export const PASSWORD_REQUIREMENTS = [
  'At least 8 characters',
  'One uppercase and one lowercase letter',
  'At least one number'
] as const;

export function validateEmail(email: string): string | undefined {
  if (!email.trim()) return 'Enter your email address.';
  if (!isValidEmail(email)) return 'Enter a full email address, e.g. you@example.com';
  return undefined;
}

export function validatePassword(password: string): string | undefined {
  if (!password) return 'Enter a password.';
  if (!isValidPassword(password)) return "That password doesn't meet the requirements below.";
  return undefined;
}

export function validateName(value: string, label: string): string | undefined {
  if (!value.trim()) return `Enter your ${label}.`;
  return undefined;
}

export function validateCode(code: string): string | undefined {
  if (!/^\d{6}$/.test(code.trim())) return 'Enter the 6-digit code from your email.';
  return undefined;
}
