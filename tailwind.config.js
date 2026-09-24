/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          950: '#0a0d12',
          900: '#0f1319',
          800: '#161b23',
          700: '#1f2630',
          600: '#2a323e'
        },
        bull: '#26a69a',
        bear: '#ef5350',
        accent: '#3b82f6'
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Menlo', 'Consolas', 'monospace']
      }
    }
  },
  plugins: []
}
