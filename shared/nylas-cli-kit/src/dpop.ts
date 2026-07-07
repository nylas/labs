/**
 * DPoP (RFC 9449) proof generation with Ed25519 via WebCrypto.
 *
 * Wire-compatible with the Nylas dashboard-account CLI token binding:
 * header {typ: "dpop+jwt", alg: "EdDSA", jwk: {kty, crv, x}} and claims
 * {jti, htm, htu, iat} plus `ath` (SHA-256 of the access token) when bound.
 *
 * Uses only WebCrypto + fetch-era globals so it runs in Node >= 20 and on
 * Cloudflare Workers.
 */

export type StoredDpopKey = {
	/** Private key JWK (OKP/Ed25519, includes `d`). Treat as a secret. */
	privateJwk: JsonWebKey
}

const textEncoder = new TextEncoder()

function base64url(data: ArrayBuffer | Uint8Array): string {
	const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
	let bin = ''
	for (const b of bytes) bin += String.fromCharCode(b)
	return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/** Strips fragments; dashboard-account validates `htu` with query params intact. */
function normalizeHtu(rawUrl: string): string {
	const u = new URL(rawUrl)
	u.hash = ''
	return u.toString()
}

export class DpopKey {
	private constructor(
		private readonly privateKey: CryptoKey,
		private readonly publicJwk: { kty: string; crv: string; x: string },
		private readonly privateJwk: JsonWebKey,
	) {}

	static async generate(): Promise<DpopKey> {
		const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
			'sign',
			'verify',
		])) as CryptoKeyPair
		const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
		return DpopKey.fromStored({ privateJwk })
	}

	static async fromStored(stored: StoredDpopKey): Promise<DpopKey> {
		const jwk = stored.privateJwk
		if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || !jwk.x || !jwk.d) {
			throw new Error('DPoP key must be an OKP/Ed25519 private JWK')
		}
		const privateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, true, ['sign'])
		return new DpopKey(privateKey, { kty: 'OKP', crv: 'Ed25519', x: jwk.x }, jwk)
	}

	/** Serializable form for persistence (contains the private key). */
	toStored(): StoredDpopKey {
		return { privateJwk: this.privateJwk }
	}

	/** RFC 7638 JWK thumbprint of the public key. */
	async thumbprint(): Promise<string> {
		const canonical = `{"crv":"Ed25519","kty":"OKP","x":"${this.publicJwk.x}"}`
		const hash = await crypto.subtle.digest('SHA-256', textEncoder.encode(canonical))
		return base64url(hash)
	}

	/**
	 * Generates a DPoP proof JWT for one HTTP request. When `accessToken` is
	 * provided the proof is bound to it via the `ath` claim.
	 */
	async proof(method: string, url: string, accessToken?: string): Promise<string> {
		const header = {
			typ: 'dpop+jwt',
			alg: 'EdDSA',
			jwk: this.publicJwk,
		}
		const claims: Record<string, unknown> = {
			jti: crypto.randomUUID(),
			htm: method.toUpperCase(),
			htu: normalizeHtu(url),
			iat: Math.floor(Date.now() / 1000),
		}
		if (accessToken) {
			const hash = await crypto.subtle.digest('SHA-256', textEncoder.encode(accessToken))
			claims.ath = base64url(hash)
		}

		const signingInput = `${base64url(textEncoder.encode(JSON.stringify(header)))}.${base64url(
			textEncoder.encode(JSON.stringify(claims)),
		)}`
		const signature = await crypto.subtle.sign(
			{ name: 'Ed25519' },
			this.privateKey,
			textEncoder.encode(signingInput),
		)
		return `${signingInput}.${base64url(signature)}`
	}
}
