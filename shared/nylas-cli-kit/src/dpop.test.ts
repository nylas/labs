import { describe, expect, it } from 'vitest'
import { DpopKey } from './dpop.js'

function decodeSegment(segment: string): Record<string, unknown> {
	const b64 = segment.replaceAll('-', '+').replaceAll('_', '/')
	return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
}

describe('DpopKey', () => {
	it('generates proofs with the expected header and claims', async () => {
		const key = await DpopKey.generate()
		const proof = await key.proof('post', 'https://dashboard-account.eu.nylas.com/auth/cli/sso/start')

		const [headerB64, claimsB64, sigB64] = proof.split('.')
		expect(headerB64).toBeTruthy()
		expect(claimsB64).toBeTruthy()
		expect(sigB64).toBeTruthy()

		const header = decodeSegment(headerB64 as string)
		expect(header.typ).toBe('dpop+jwt')
		expect(header.alg).toBe('EdDSA')
		expect(header.jwk).toMatchObject({ kty: 'OKP', crv: 'Ed25519' })

		const claims = decodeSegment(claimsB64 as string)
		expect(claims.htm).toBe('POST')
		expect(claims.htu).toBe('https://dashboard-account.eu.nylas.com/auth/cli/sso/start')
		expect(claims.jti).toBeTruthy()
		expect(typeof claims.iat).toBe('number')
		expect(claims.ath).toBeUndefined()
	})

	it('keeps query, strips fragment from htu, and binds the access token via ath', async () => {
		const key = await DpopKey.generate()
		const proof = await key.proof(
			'GET',
			'https://dashboard-account.eu.nylas.com/orgs/inbox/domains?limit=10#frag',
			'user-token-123',
		)
		const claims = decodeSegment(proof.split('.')[1] as string)
		expect(claims.htu).toBe('https://dashboard-account.eu.nylas.com/orgs/inbox/domains?limit=10')
		// ath = base64url(sha256("user-token-123")), no padding
		expect(claims.ath).toMatch(/^[A-Za-z0-9_-]{43}$/)
	})

	it('round-trips through stored JWK and produces verifiable signatures', async () => {
		const original = await DpopKey.generate()
		const restored = await DpopKey.fromStored(original.toStored())
		expect(await restored.thumbprint()).toBe(await original.thumbprint())

		const proof = await restored.proof('POST', 'https://example.com/x')
		const [headerB64, claimsB64, sigB64] = proof.split('.') as [string, string, string]
		const header = decodeSegment(headerB64) as { jwk: JsonWebKey }
		const publicKey = await crypto.subtle.importKey('jwk', header.jwk, { name: 'Ed25519' }, false, ['verify'])
		const valid = await crypto.subtle.verify(
			{ name: 'Ed25519' },
			publicKey,
			Buffer.from(sigB64.replaceAll('-', '+').replaceAll('_', '/'), 'base64'),
			new TextEncoder().encode(`${headerB64}.${claimsB64}`),
		)
		expect(valid).toBe(true)
	})

	it('thumbprint is stable and base64url-shaped', async () => {
		const key = await DpopKey.generate()
		const tp = await key.thumbprint()
		expect(tp).toMatch(/^[A-Za-z0-9_-]{43}$/)
		expect(await key.thumbprint()).toBe(tp)
	})
})
