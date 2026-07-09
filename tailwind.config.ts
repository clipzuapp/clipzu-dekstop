import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        editor: {
          bg: '#0a0908',
          panel: '#1a1816',
          border: '#2a2a30',
          surface: '#2a2724',
          hover: '#3a3732'
        },
        accent: {
          DEFAULT: '#4f7fff',
          hover: '#6b8fff',
          muted: '#3b5fbf'
        },
        success: {
          DEFAULT: '#1D9E75',
          hover: '#25c08e'
        },
        danger: {
          DEFAULT: '#d94452',
          hover: '#e85665'
        },
        warning: {
          DEFAULT: '#e5a228',
          hover: '#f0b53e'
        },
        brand: {
          DEFAULT: '#4f7fff',
          purple: '#7c5cfc',
          hover: '#6b8fff'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif']
      },
      fontSize: {
        'xs': ['0.75rem', { lineHeight: '1rem' }],
        'sm': ['0.8125rem', { lineHeight: '1.25rem' }],
        'base': ['0.875rem', { lineHeight: '1.375rem' }],
        'lg': ['1rem', { lineHeight: '1.5rem' }],
        'xl': ['1.125rem', { lineHeight: '1.625rem' }]
      },
      keyframes: {
        'pop': {
          '0%': { transform: 'scale(0.8)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' }
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        'slide-up': {
          '0%': { transform: 'translateY(12px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' }
        },
        'typewriter': {
          '0%': { width: '0' },
          '100%': { width: '100%' }
        }
      },
      animation: {
        'pop': 'pop 120ms ease-out',
        'fade-in': 'fade-in 200ms linear',
        'slide-up': 'slide-up 150ms ease-out',
        'typewriter': 'typewriter 40ms steps(1) forwards'
      },
      boxShadow: {
        'panel': '0 2px 8px rgba(0,0,0,0.4)',
        'modal': '0 8px 32px rgba(0,0,0,0.6)'
      }
    }
  },
  plugins: []
}

export default config
