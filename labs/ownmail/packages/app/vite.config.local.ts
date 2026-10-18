import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Local Node SSR target. Use `pnpm dev:ui` for mock data or `pnpm dev:local`
 * with real environment variables for Nylas integration testing.
 */
export default defineConfig(({ command }) => ({
	plugins: [tailwindcss(), tanstackStart(), react()],
	resolve: {
		alias: {
			'cloudflare:workers': fileURLToPath(
				new URL('./src/server/cloudflare-workers.local.ts', import.meta.url),
			),
			// The mock mailbox is repository-only (see src/server/dev-mailbox.ts): only
			// this target, the mock app and the Node build the SSR smoke test serves, has it.
			'./dev-mailbox.js': fileURLToPath(new URL('./src/server/dev-mocks.ts', import.meta.url)),
		},
	},
	ssr: {
		external: ['cloudflare:workers'],
		...(command === 'build' ? { noExternal: true } : {}),
	},
	environments: {
		ssr: {
			build: {
				// Keep the packed Node server small alongside the Cloudflare build.
				minify: 'esbuild',
				rollupOptions: {
					external: ['cloudflare:workers'],
				},
			},
		},
	},
}))
