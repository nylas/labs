import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Vercel build target: no Cloudflare plugin, plain Node SSR output.
 * `cloudflare:workers` stays external — platform.ts imports it dynamically,
 * fails at runtime, and falls back to process.env + stateless sessions.
 */
export default defineConfig({
	plugins: [tailwindcss(), tanstackStart(), react()],
	environments: {
		ssr: {
			build: {
				rollupOptions: {
					external: ['cloudflare:workers'],
				},
			},
		},
	},
})
