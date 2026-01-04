/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['"Noto Sans JP"', 'system-ui', '-apple-system', 'sans-serif'],
            },
            colors: {
                'brand-purple-start': '#9181c4',
                'brand-purple-end': '#a8c4e8',
                'brand-blue': '#6da0d4',
            }
        },
    },
    plugins: [],
}
