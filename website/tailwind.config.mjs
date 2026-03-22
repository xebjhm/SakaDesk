/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Noto Sans JP"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        primary: '#7cc7e8',
        'primary-dark': '#5eb3d8',
        secondary: '#5dc2b5',
        accent: '#fffacd',
        surface: {
          base: '#FFFFFF',
          elevated: '#FAFAFA',
          sunken: '#F3F4F6',
          bg: '#F0F2F5',
        },
        text: {
          primary: '#1f2937',
          secondary: '#4b5563',
          muted: '#9ca3af',
          inverse: '#FFFFFF',
        },
      },
      backgroundImage: {
        'hero-gradient': 'linear-gradient(135deg, #7cc7e8 0%, #5dc2b5 100%)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
    },
  },
  plugins: [],
};
