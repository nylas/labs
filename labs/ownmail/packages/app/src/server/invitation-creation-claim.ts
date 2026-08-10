import { platform } from './platform.js'

const CLAIM_TTL_SECONDS = 10 * 60
const MAX_INVITATION_SEQUENCE = 2_147_483_647

export async function invitationCreationClaimsAvailable(): Promise<boolean> {
	try {
		const { kv } = await platform()
		return Boolean(kv?.claimRevision && kv.releaseRevision)
	} catch {
		return false
	}
}

export async function claimInvitationCreation(
	grantId: string,
	uid: string,
	sequence: number,
): Promise<boolean> {
	requireSequence(sequence)
	const { env, kv } = await platform()
	if (!kv?.claimRevision) throw new Error('Atomic invitation claims are unavailable')
	const key = await claimKey(env.SESSION_SECRET, grantId, uid)
	return kv.claimRevision(key, sequence, CLAIM_TTL_SECONDS)
}

export async function invitationCreationClaimActive(
	grantId: string,
	uid: string,
	sequence?: number,
): Promise<boolean> {
	if (sequence !== undefined) requireSequence(sequence)
	const { env, kv } = await platform()
	if (!kv?.claimRevision) return false
	const activeSequence = parseSequence(await kv.get(await claimKey(env.SESSION_SECRET, grantId, uid)))
	return sequence === undefined ? activeSequence !== undefined : activeSequence === sequence
}

export async function invitationCancellationSequence(
	grantId: string,
	uid: string,
	organizerEmail: string,
): Promise<number | undefined> {
	const organizer = normalizedOrganizer(organizerEmail)
	if (!organizer) return undefined
	const { env, kv } = await platform()
	if (!kv) return undefined
	const key = await cancellationKey(env.SESSION_SECRET, grantId, uid, organizer)
	if (kv.putMaximum) return parseSequence(await kv.get(key))
	if (!kv.list) return undefined
	return versionedCancellationSequence(await kv.list({ prefix: `${key}:`, limit: 1 }), `${key}:`)
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
	if (!kv) return sequence
	const key = await cancellationKey(env.SESSION_SECRET, grantId, uid, organizer)
	if (kv.putMaximum) {
		const stored = await kv.putMaximum(key, sequence)
		if (!Number.isSafeInteger(stored) || stored < 0 || stored > MAX_INVITATION_SEQUENCE) {
			throw new Error('Invalid invitation cancellation storage result')
		}
		return stored
	}
	if (!kv.list) throw new Error('Durable invitation cancellations are unavailable')
	// Cloudflare KV has no atomic numeric operations. Store immutable,
	// reverse-sorted revision keys so concurrent lower revisions can never
	// overwrite a higher tombstone and a one-key prefix listing returns the max.
	const reverseSequence = String(MAX_INVITATION_SEQUENCE - sequence).padStart(10, '0')
	await kv.put(`${key}:${reverseSequence}`, '1')
	return sequence
}

export async function releaseInvitationCreationClaim(
	grantId: string,
	uid: string,
	sequence: number,
): Promise<void> {
	requireSequence(sequence)
	const { env, kv } = await platform()
	if (!kv?.releaseRevision) return
	await kv.releaseRevision(await claimKey(env.SESSION_SECRET, grantId, uid), sequence)
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

function requireSequence(sequence: number): void {
	if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > MAX_INVITATION_SEQUENCE) {
		throw new Error('Invalid invitation sequence')
	}
}

function versionedCancellationSequence(
	result: { keys: { name: string }[] },
	prefix: string,
): number | undefined {
	const name = result.keys[0]?.name
	if (!name?.startsWith(prefix)) return undefined
	const reverseSequence = name.slice(prefix.length)
	if (!/^\d{10}$/.test(reverseSequence)) return undefined
	const reverse = Number(reverseSequence)
	return reverse <= MAX_INVITATION_SEQUENCE ? MAX_INVITATION_SEQUENCE - reverse : undefined
}

function normalizedOrganizer(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined
	const normalized = value.trim().toLowerCase()
	return normalized.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : undefined
}
