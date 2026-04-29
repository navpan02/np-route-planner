/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'np-green':   '#2d6a4f',
        'np-mid':     '#40916c',
        'np-lite':    '#74c69d',
        'np-accent':  '#52b788',
        'np-dark':    '#1b2e24',
        'np-text':    '#1f2d27',
        'np-muted':   '#5a7a67',
        'np-surface': '#f4faf6',
        'np-border':  '#c8e6d4',
        'cp-pink':    '#ff2d78',
        'cp-green':   '#00ff9f',
        'cp-yellow':  '#f5e642',
        'cp-bg':      '#07000f',
        'cp-card':    '#0d0018',
      },
      fontFamily: {
        mono: ['"Share Tech Mono"', 'monospace'],
        vt:   ['VT323', 'monospace'],
      },
      boxShadow: {
        'np':       '0 4px 24px rgba(0,0,0,0.10)',
        'np-lg':    '0 8px 40px rgba(0,0,0,0.15)',
        'cp-green': '0 0 8px #00ff9f, 0 0 20px rgba(0,255,159,0.4)',
        'cp-pink':  '0 0 8px #ff2d78, 0 0 20px rgba(255,45,120,0.4)',
      },
      animation: {
        'scan-beam':    'scanBeam 3s linear infinite',
        'scan-flicker': 'scanFlicker 0.08s steps(1) infinite',
        'blink':        'blink 1s step-start infinite',
        'fade-in':      'fadeIn 0.5s ease-out',
        'slide-up':     'slideUp 0.4s ease-out',
      },
      keyframes: {
        scanBeam:    { '0%': { top: '-40px' }, '100%': { top: '100%' } },
        scanFlicker: { '0%': { opacity: '1' }, '25%': { opacity: '0.85' }, '50%': { opacity: '1' }, '75%': { opacity: '0.9' }, '100%': { opacity: '1' } },
        blink:       { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0' } },
        fadeIn:      { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp:     { from: { opacity: '0', transform: 'translateY(20px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
}
