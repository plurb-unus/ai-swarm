/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
        './src/components/**/*.{js,ts,jsx,tsx,mdx}',
        './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
            },
            colors: {
                background: 'rgb(var(--background) / <alpha-value>)',
                foreground: 'rgb(var(--foreground) / <alpha-value>)',
                card: 'rgb(var(--card) / <alpha-value>)',
                'card-foreground': 'rgb(var(--card-foreground) / <alpha-value>)',
                popover: 'rgb(var(--popover) / <alpha-value>)',
                'popover-foreground': 'rgb(var(--popover-foreground) / <alpha-value>)',
                primary: 'rgb(var(--primary) / <alpha-value>)',
                'primary-foreground': 'rgb(var(--primary-foreground) / <alpha-value>)',
                muted: 'rgb(var(--muted) / <alpha-value>)',
                'muted-foreground': 'rgb(var(--muted-foreground) / <alpha-value>)',
                accent: 'rgb(var(--accent) / <alpha-value>)',
                'accent-foreground': 'rgb(var(--accent-foreground) / <alpha-value>)',
                destructive: 'rgb(var(--destructive) / <alpha-value>)',
                'destructive-foreground': 'rgb(var(--destructive-foreground) / <alpha-value>)',
                border: 'rgb(var(--border) / <alpha-value>)',
                input: 'rgb(var(--input) / <alpha-value>)',
                ring: 'rgb(var(--ring) / <alpha-value>)',
                // Legacy support until full migration
                'swarm-bg': '#0d1117',
                'swarm-card': '#161b22',
                'swarm-surface': '#21262d',
                'swarm-border': '#30363d',
                'swarm-text': '#e6edf3',
                'swarm-muted': '#7d8590',
                'swarm-green': '#3fb950',
                'swarm-red': '#f85149',
                'swarm-blue': '#58a6ff',
                'swarm-purple': '#a371f7',
                'swarm-yellow': '#d29922',
            },
        },
    },
    darkMode: 'class',
    plugins: [],
};
