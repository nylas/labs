export type AppHealthOptions = {
	attempts?: number
	delayMs?: number
}

export async function checkAppHealth(url: string, options: AppHealthOptions = {}): Promise<boolean> {
	const attempts = Math.max(1, options.attempts ?? 10)
	const delayMs = Math.max(0, options.delayMs ?? 3000)

	for (let attempt = 0; attempt < attempts; attempt++) {
		try {
			const res = await fetch(`${url}/healthz`)
			if (res.ok) return true
		} catch {
			// Workers and custom routes can take a few seconds to propagate.
		}
		if (attempt < attempts - 1 && delayMs > 0) {
			await new Promise((r) => setTimeout(r, delayMs))
		}
	}
	return false
}
