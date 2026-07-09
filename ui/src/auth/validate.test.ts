import { describe, expect, it } from 'vitest';
import { isValidEmail, isValidPassword, validateCode } from './validate';

describe('password policy (mirrors pool: 8+, upper, lower, number, NO symbol requirement)', () => {
  it('accepts the minimum compliant password', () => {
    expect(isValidPassword('Abcdefg1')).toBe(true);
  });

  it('accepts symbols without requiring them', () => {
    expect(isValidPassword('Abcdefg1!')).toBe(true);
  });

  it('rejects missing classes and short passwords', () => {
    expect(isValidPassword('abcdefg1')).toBe(false); // no uppercase
    expect(isValidPassword('ABCDEFG1')).toBe(false); // no lowercase
    expect(isValidPassword('Abcdefgh')).toBe(false); // no number
    expect(isValidPassword('Abcdef1')).toBe(false); // 7 chars
  });
});

describe('email', () => {
  it('accepts normal addresses and trims whitespace', () => {
    expect(isValidEmail(' allen@readysetcloud.io ')).toBe(true);
  });

  it('rejects partial addresses', () => {
    expect(isValidEmail('allen@')).toBe(false);
    expect(isValidEmail('allen@readysetcloud')).toBe(false);
  });
});

describe('code', () => {
  it('requires exactly six digits', () => {
    expect(validateCode('123456')).toBeUndefined();
    expect(validateCode(' 123456 ')).toBeUndefined();
    expect(validateCode('12345')).toBeTruthy();
    expect(validateCode('12345a')).toBeTruthy();
  });
});
