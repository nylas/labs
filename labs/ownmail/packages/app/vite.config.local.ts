import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Local Node SSR target. Use `pnpm dev:ui` for mock data or `pnpm dev:local`
 * with real environment variables for Nylas integration testing.
 */
export default defineConfig({
	plugins: [tailwindcss(), tanstackStart(), react()],
	resolve: {
		alias: {
			'cloudflare:workers': fileURLToPath(
				new URL('./src/server/cloudflare-workers.local.ts', import.meta.url),
			),
		},
	},
	ssr: {
		external: ['cloudflare:workers'],
		noExternal: true,
	},
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
