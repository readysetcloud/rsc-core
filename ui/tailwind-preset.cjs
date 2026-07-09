/**
 * Tailwind preset for Ready, Set, Cloud apps.
 *
 * tailwind.config.js:
 *   module.exports = {
 *     presets: [require('@readysetcloud/ui/tailwind-preset')],
 *     content: [
 *       './index.html',
 *       './src/** /*.{ts,tsx}',
 *       './node_modules/@readysetcloud/ui/dist/** /*.js'
 *     ]
 *   };
 *
 * Every color resolves through the CSS variables in tokens.css, so light/dark
 * and any future brand shifts come from the package — never app configs.
 */

const withVar = (name) => {
  const scale = {};
  for (const stop of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) {
    scale[stop] = `rgb(var(--${name}-${stop}) / <alpha-value>)`;
  }
  return scale;
};

const primary = withVar('primary');
const secondary = withVar('secondary');
const success = withVar('success');
const warning = withVar('warning');
const error = withVar('error');

module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        primary,
        secondary,
        success,
        warning,
        error,
        background: 'rgb(var(--background) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        foreground: 'rgb(var(--foreground) / <alpha-value>)',
        muted: {
          DEFAULT: 'rgb(var(--muted) / <alpha-value>)',
          foreground: 'rgb(var(--muted-foreground) / <alpha-value>)'
        },
        border: 'rgb(var(--border) / <alpha-value>)',
        ring: 'rgb(var(--ring) / <alpha-value>)',

        // semantic aliases so existing utility usage keeps working
        blue: primary,
        green: success,
        teal: success,
        red: error,
        rose: error,
        orange: warning,
        amber: warning,
        yellow: warning,
        gray: secondary,
        slate: secondary
      },
      fontFamily: {
        display: ['Sora', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Manrope', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'Consolas', 'monospace'],
        logo: ['Raleway', 'Sora', 'sans-serif'] // wordmark lockups only
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius)',
        md: 'var(--radius)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)'
      },
      boxShadow: {
        soft: 'var(--shadow-soft)',
        medium: 'var(--shadow-medium)',
        large: 'var(--shadow-large)'
      },
      screens: {
        xs: '400px'
      },
      animation: {
        'fade-in': 'rsc-fade-in 0.3s ease-in-out',
        'slide-up': 'rsc-slide-up 0.3s ease-out'
      },
      keyframes: {
        'rsc-fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' }
        },
        'rsc-slide-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        }
      }
    }
  }
};
