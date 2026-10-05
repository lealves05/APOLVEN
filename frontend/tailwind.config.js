/** @type {import('tailwindcss').Config} */
const withVar = (v) => `rgb(var(${v}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: withVar('--primary'), fg: withVar('--primary-fg') },
        bg: withVar('--bg'),
        surface: withVar('--surface'),
        muted: withVar('--muted'),
        line: withVar('--line'),
        ink: { DEFAULT: withVar('--ink'), soft: withVar('--ink-soft'), faint: withVar('--ink-faint') },
      },
      borderRadius: { app: 'var(--radius)', 'app-sm': 'calc(var(--radius) * 0.6)' },
      fontFamily: { sans: ['var(--font)', 'system-ui', 'sans-serif'] },
      boxShadow: { soft: '0 1px 2px rgb(0 0 0 / 0.04), 0 4px 16px rgb(0 0 0 / 0.04)' },
    },
  },
  plugins: [],
};
