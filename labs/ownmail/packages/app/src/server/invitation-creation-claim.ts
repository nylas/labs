import { platform } from './platform.js'

const CLAIM_TTL_SECONDS = 10 * 60
const CANCELLATION_LOCK_TTL_SECONDS = 30
const MAX_INVITATION_SEQUENCE = 2_147_483_647

export async function invitationCreationClaimsAvailable(): Promise<boolean> {
	try {
		const { kv } = await platform()
		return Boolean(kv?.putIfAbsent)
	} catch {
		return false
	}
}

export async function claimInvitationCreation(grantId: string, uid: string): Promise<boolean> {
	const { env, kv } = await platform()
	if (!kv?.putIfAbsent) throw new Error('Atomic invitation claims are unavailable')
	const key = await claimKey(env.SESSION_SECRET, grantId, uid)
	return kv.putIfAbsent(key, '1', CLAIM_TTL_SECONDS)
}

export async function invitationCreationClaimActive(grantId: string, uid: string): Promise<boolean> {
	const { env, kv } = await platform()
	if (!kv?.putIfAbsent) return false
	return (await kv.get(await claimKey(env.SESSION_SECRET, grantId, uid))) === '1'
}

export async function invitationCancellationSequence(
	grantId: string,
	uid: string,
	organizerEmail: string,
): Promise<number | undefined> {
	const organizer = normalizedOrganizer(organizerEmail)
	if (!organizer) return undefined
	const { env, kv } = await platform()
	if (!kv?.putIfAbsent) return undefined
	return parseSequence(await kv.get(await cancellationKey(env.SESSION_SECRET, grantId, uid, organizer)))
}

export async function recordInvitationCancellation(
	grantId: string,
	uid: string,
	sequence: number,
	organizerEmail: string,
): Promise<number> {
	if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > MAX_INVITATION_SEQUENCE) {
		throw new Error('Invalid invitation cancellation sequence')
	}
	const organizer = normalizedOrganizer(organizerEmail)
	if (!organizer) throw new Error('Invalid invitation cancellation organizer')
	const { env, kv } = await platform()
	if (!kv?.putIfAbsent) return sequence
	const suffix = await claimSuffix(env.SESSION_SECRET, grantId, `${uid}\0${organizer}`)
	const lockKey = `invitation-cancel-lock:${suffix}`
	if (!(await kv.putIfAbsent(lockKey, '1', CANCELLATION_LOCK_TTL_SECONDS))) {
		throw new Error('Invitation cancellation is already being recorded')
	}
	try {
		const key = `invitation-cancel:${suffix}`
		const current = parseSequence(await kv.get(key))
		const next = Math.max(current ?? 0, sequence)
		if (current !== next) await kv.put(key, String(next))
		return next
	} finally {
		await kv.delete(lockKey).catch(() => undefined)
	}
}

export async function releaseInvitationCreationClaim(grantId: string, uid: string): Promise<void> {
	const { env, kv } = await platform()
	if (!kv?.putIfAbsent) return
	await kv.delete(await claimKey(env.SESSION_SECRET, grantId, uid))
}

async function claimKey(secret: string, grantId: string, uid: string): Promise<string> {
	return `invitation-create:${await claimSuffix(secret, grantId, uid)}`
}

async function cancellationKey(
	secret: string,
	grantId: string,
	uid: string,
	organizer: string,
): Promise<string> {
	return `invitation-cancel:${await claimSuffix(secret, grantId, `${uid}\0${organizer}`)}`
}

async function claimSuffix(secret: string, grantId: string, uid: string): Promise<string> {
	if (!secret || secret.length > 16_384) throw new Error('Invitation claim secret is unavailable')
	const encoder = new TextEncoder()
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	)
	const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(`${grantId}\0${uid}`))
	const suffix = [...new Uint8Array(digest)]
		.slice(0, 20)
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')
	return suffix
}

function parseSequence(value: string | null): number | undefined {
	if (typeof value !== 'string' || !/^\d{1,10}$/.test(value)) return undefined
	const sequence = Number(value)
	return sequence <= MAX_INVITATION_SEQUENCE ? sequence : undefined
}

function normalizedOrganizer(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined
	const normalized = value.trim().toLowerCase()
	return normalized.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : undefined
}
