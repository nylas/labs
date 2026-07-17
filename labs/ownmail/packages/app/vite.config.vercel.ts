import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'

/**
 * Vercel build target. Nitro owns the Build Output API layout, server adapter,
 * dependency bundling, and Vercel runtime configuration.
 */
export default defineConfig({
	plugins: [
		tailwindcss(),
		tanstackStart(),
		nitro({
			preset: 'vercel',
			rollupConfig: {
				external: ['cloudflare:workers'],
			},
		}),
		react(),
	],
	environments: {
		ssr: {
			build: {
				rollupOptions: {
					// The Node platform adapter catches this optional import and uses process.env.
					external: ['cloudflare:workers'],
				},
			},
		},
	},
})
