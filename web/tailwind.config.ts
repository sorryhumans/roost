import type { Config } from 'tailwindcss';

// Theme tokens are authored verbatim from 02-UI-SPEC.md. Do NOT invent off-spec values.
// Status colors are the only saturated accent on the screen (PRD §12 / UI-SPEC color §).
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surfaces (60/30 dominant + secondary)
        bg: '#0B0E14', // app background (near-black blue)
        surface: '#151A23', // desk card surface
        border: '#232A36', // card border
        // Text
        'text-primary': '#E5E7EB',
        'text-muted': '#9CA3AF',
        'text-faint': '#6B7280',
        // Status color language (accent — status signal only)
        status: {
          working: '#34D399', // green  — "Working"
          idle: '#FBBF24', // amber  — "Idle" (online-idle)
          offline: '#6B7280', // grey   — "Offline"
          unknown: '#4B5563', // dim grey — "Status unknown"
        },
      },
      // 4px spacing scale (UI-SPEC Spacing §). Named tokens map to the design names.
      spacing: {
        xs: '4px',
        sm: '8px',
        md: '16px',
        lg: '24px',
        xl: '32px',
        '2xl': '48px',
      },
      // Typography roles (UI-SPEC Typography §): [size, { lineHeight, fontWeight }].
      fontSize: {
        body: ['14px', { lineHeight: '1.5', fontWeight: '400' }],
        label: ['12px', { lineHeight: '1.4', fontWeight: '500' }],
        heading: ['18px', { lineHeight: '1.3', fontWeight: '600' }],
        display: ['28px', { lineHeight: '1.2', fontWeight: '700' }],
      },
      fontFamily: {
        sans: [
          'Inter',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
} satisfies Config;
