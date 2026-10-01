import type { EmailCanvasDetail } from './email-render.js'

const MAX_REMEMBERED_EMAILS = 300
const remembered = new Map<string, EmailCanvasDetail>()

/**
 * The last measured presentation of a message in this session, keyed by message
 * and presentation. A reopened message reserves its height and canvas before the
 * renderer measures, so opening it neither jumps nor flashes the wrong canvas.
 */
export function renderedEmailKey(messageId: string, theme: 'dark' | 'light', colorMode: string): string {
	return `${messageId}\u0000${theme}\u0000${colorMode}`
}

export function rememberedEmail(key: string): EmailCanvasDetail | undefined {
	return remembered.get(key)
}

export function rememberEmail(key: string, detail: EmailCanvasDetail): void {
	remembered.delete(key)
	remembered.set(key, detail)
	if (remembered.size > MAX_REMEMBERED_EMAILS) {
		const oldest = remembered.keys().next().value as string
		remembered.delete(oldest)
	}
}

/** Test seam: forget every remembered presentation. */
export function forgetRememberedEmails(): void {
	remembered.clear()
}
