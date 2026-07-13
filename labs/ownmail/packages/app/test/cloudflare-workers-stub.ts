// Test-only stub for the `cloudflare:workers` virtual module, which is provided by the
// @cloudflare/vite-plugin at build/dev time but does not exist under the vitest runner.
// platform.ts imports this dynamically inside a try/catch; exporting an empty `env` lets
// the catch-free path resolve while the Node fallback still drives behaviour in tests.
export const env: Record<string, unknown> = {}
