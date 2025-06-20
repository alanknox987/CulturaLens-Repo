module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        blue: {
          500: '#1484CC',
          600: '#1276B8', /* slightly darker for hover states */
        },
        green: {
          500: '#5DBABF',
          600: '#52A6AB', /* slightly darker for hover states */
        },
        indigo: {
          500: '#1484CC',
          600: '#1276B8',
        },
        purple: {
          500: '#5DBABF',
          600: '#52A6AB',
        }
      },
      typography: {
        DEFAULT: {
          css: {
            color: 'inherit',
            a: {
              color: '#1484CC',
              '&:hover': {
                color: '#1276B8',
              },
            },
            h1: {
              color: 'inherit',
            },
            h2: {
              color: 'inherit',
            },
            h3: {
              color: 'inherit',
            },
            h4: {
              color: 'inherit',
            },
            strong: {
              color: 'inherit',
            },
            code: {
              color: 'inherit',
            },
            blockquote: {
              color: 'inherit',
            },
          },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    require('@tailwindcss/forms'),
    require('@tailwindcss/aspect-ratio'),
  ],
}