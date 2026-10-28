import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// One config, two builds:
//   vite build                                   → the React page, in dist/client
//   vite build --ssr src/server/index.ts ...     → the Hono server, in dist/server
export default defineConfig(({ isSsrBuild }) =>
  isSsrBuild
    ? {
        build: { target: 'node22', copyPublicDir: false },
      }
    : {
        plugins: [react(), tailwindcss()],
        build: {
          outDir: 'dist/client',
          rolldownOptions: {
            output: {
              // React changes far less often than the app, so it gets its own chunk
              // that browsers keep cached across deploys.
              codeSplitting: { groups: [{ name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ }] },
            },
          },
        },
        server: {
          // In development, Vite serves the page and forwards /api to Hono, and
          // /login too, the preview gate's sign-in page.
          proxy: { '/api': 'http://localhost:3000', '/login': 'http://localhost:3000' },
        },
      },
)
