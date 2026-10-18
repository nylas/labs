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
			// The CLI packs this output beside the Cloudflare and Node builds under a 3.5 MB limit.
			minify: true,
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
