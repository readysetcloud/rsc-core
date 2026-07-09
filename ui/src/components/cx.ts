/** Tiny classnames join — avoids a clsx dependency. */
export const cx = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(' ');
