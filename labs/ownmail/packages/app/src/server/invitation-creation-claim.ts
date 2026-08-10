import { platform } from './platform.js'

const CLAIM_TTL_SECONDS = 10 * 60

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

export async function releaseInvitationCreationClaim(grantId: string, uid: string): Promise<void> {
	const { env, kv } = await platform()
	if (!kv?.putIfAbsent) return
	await kv.delete(await claimKey(env.SESSION_SECRET, grantId, uid))
}

async function claimKey(secret: string, grantId: string, uid: string): Promise<string> {
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
	return `invitation-create:${suffix}`
}
