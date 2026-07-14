import { defineConfig } from 'vitest/config'

// Coverage is enforced at 100% for the CLI's logic. The only exclusions are:
// - src/index.ts: the citty `bin` entrypoint. It calls `runMain()` at import time to parse
//   argv and is pure declarative command wiring — every command's logic lives in and is
//   tested through ./commands/*, ./deploy/*, ./steps/*, ./state/*, ./util/*.
export default defineConfig({
	test: {
		environment: 'node',
		globals: false,
		// V8 coverage writes shared intermediate files. Parallel test files can
		// race while cleaning that directory, intermittently failing a green run.
		fileParallelism: false,
		include: ['src/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'text-summary', 'html'],
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.test.ts', 'src/index.ts'],
			thresholds: {
				lines: 100,
				functions: 100,
				branches: 100,
				statements: 100,
			},
		},
	},
})
