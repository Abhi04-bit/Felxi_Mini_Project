/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#F8F3E8',
        card: '#FFFDF7',
        ink: '#292820',
        muted: '#777367',
        edge: '#E8DFCE',
        danger: '#C83D3D',
        safe: '#367A52',
        warning: '#D98936',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
