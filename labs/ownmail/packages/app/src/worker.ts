/**
 * Cloudflare Worker entry (wrangler `main`). It serves the TanStack Start
 * handler unchanged and exports the Durable Object class that backs atomic
 * invitation claims. Only the Cloudflare build loads this file; the Node and
 * Vercel targets use TanStack's default server entry.
 */

import { DurableObject } from 'cloudflare:workers'
import handler from '@tanstack/react-start/server-entry'
import { InvitationLockState } from './server/invitation-lock.js'

export default handler

export class InvitationLocks extends DurableObject {
	private readonly state = new InvitationLockState(this.ctx.storage)

	read(): Promise<string | null> {
		return this.state.read()
	}

	putIfAbsent(value: string, expirationTtl: number): Promise<boolean> {
		return this.state.putIfAbsent(value, expirationTtl)
	}

	claimRevision(revision: number, expirationTtl: number): Promise<boolean> {
		return this.state.claimRevision(revision, expirationTtl)
	}

	deleteIfValue(value: string): Promise<void> {
		return this.state.deleteIfValue(value)
	}

	override alarm(): Promise<void> {
		return this.state.expire()
	}
}
