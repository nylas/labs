import { NylasApiError } from '@nylas-labs/cli-kit/v3'
import { redirect } from '@tanstack/react-router'
import { getRequest } from '@tanstack/react-start/server'
import { LOGIN_PATH } from '../app/config/route-paths.js'
import { mailboxFromRequest } from './nylas.js'

export async function requireMailbox() {
	const request = getRequest()
	const resolved = await mailboxFromRequest(request)
	if (!resolved) throw redirect({ to: LOGIN_PATH })
	return resolved
}

/**
 * Maps Nylas API failures to user-safe messages (no internals leak) while
 * keeping quota errors recognizable so the UI can show plan-limit banners.
 */
export function friendly(err: unknown): Error {
	if (err instanceof NylasApiError) {
		if (err.status === 401 || err.status === 403)
			return new Error('Your mailbox session expired. Sign in again and retry.')
		if (err.status === 429 || /quota|limit exceeded/i.test(err.message)) {
			return new Error(
				'QUOTA: You’ve hit a plan limit (free inboxes can send 200 messages/day). Try again later.',
			)
		}
		if (err.status === 404) return new Error('Not found — it may have been deleted.')
	}
	return new Error('Something went wrong talking to your mailbox. Check your connection and try again.')
}

export function listData<T>(value: unknown): T[] {
	return Array.isArray(value) ? (value as T[]) : []
}
