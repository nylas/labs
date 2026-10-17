import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { GitFork, Trash2 } from 'lucide-react'
import { accountScope } from '#app/lib/account-scope'
import { normalSubject } from '../lib/conversation-model.js'
import { validateMailSearchQuery } from '../lib/mail-search.js'
import { threadRouteFolderId } from '../lib/mail-ui-model.js'
import { firstName, type Person, personName, toPerson } from '../lib/thread-reading-model.js'
import type { MailMessage, MailThread } from '../state/mail-queries.js'
import { EDGE_LINK_CLASS } from './edge-actions.js'

const addressKey = (email: string): string => email.trim().toLowerCase()

/** Everyone on a thread's messages, by address. */
function messageAddresses(messages: MailMessage[]): Set<string> {
	const addresses = new Set<string>()
	for (const message of messages) {
		for (const person of [...(message.from ?? []), ...(message.to ?? []), ...(message.cc ?? [])]) {
			const key = addressKey(person.email)
			if (key) addresses.add(key)
		}
	}
	return addresses
}

const earliest = (messages: MailMessage[]): number =>
	Math.min(...messages.map((message) => message.date ?? Number.POSITIVE_INFINITY))

/**
 * A side thread of this one: another thread with the same subject, started
 * after this one, whose people are a strict subset of this thread's.
 */
export function findSideThread(
	thread: MailThread,
	messages: MailMessage[],
	candidates: MailThread[],
): MailThread | null {
	const subject = normalSubject(thread.subject ?? messages[0]?.subject).toLowerCase()
	if (!subject) return null
	const people = messageAddresses(messages)
	const started = thread.earliest_message_date ?? earliest(messages)
	return (
		candidates.find((candidate) => {
			if (candidate.id === thread.id) return false
			if (normalSubject(candidate.subject).toLowerCase() !== subject) return false
			if ((candidate.earliest_message_date ?? 0) <= started) return false
			const theirs = (candidate.participants ?? []).map((person) => addressKey(person.email)).filter(Boolean)
			return theirs.length > 0 && theirs.length < people.size && theirs.every((key) => people.has(key))
		}) ?? null
	)
}

/** "Grace", "Grace and Mary", "Grace, Mary and Alan". */
function namesList(names: string[]): string {
	if (names.length <= 1) return names[0] ?? ''
	return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** "Alan started a side thread with Grace": the starter, then everyone else but you. */
export function sideThreadText(side: MailThread, owner: string): string {
	const people: Person[] = (side.participants ?? []).map((participant) => toPerson(participant, owner))
	const starter = people[0] ?? toPerson(undefined, owner)
	const others = people.slice(1).filter((person) => !person.isOwner)
	const who = starter.isOwner ? 'You' : personName(starter, 'first')
	const with_ = namesList(others.map((person) => firstName(person)))
	return with_ ? `${who} started a side thread with ${with_}` : `${who} started a side thread`
}

/** The side-thread lookup's cache key: per account and thread, never under `mailKeys.all`. */
export function sideThreadKey(threadId: string, query: string | null) {
	return ['mail-side-thread', accountScope(), threadId, query] as const
}

/** A word-only search for a subject, so it always passes the search grammar. */
export function subjectSearch(subject: string): string | null {
	const words = normalSubject(subject)
		.replace(/[^\p{L}\p{N}\s]+/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim()
	if (!words) return null
	const checked = validateMailSearchQuery(words)
	return checked.valid ? checked.query : null
}

/**
 * Where the rest of a conversation is: messages of the thread that sit in
 * Trash (hidden from the stream, one click to show), and a side thread that
 * forked off with fewer people. Looked up lazily once per thread.
 */
export function ThreadStreamNotices({
	trashed,
	showTrashed,
	onToggleTrashed,
	thread,
	messages,
	owner,
}: {
	trashed: MailMessage[]
	showTrashed: boolean
	onToggleTrashed(): void
	thread: MailThread
	messages: MailMessage[]
	owner: string
}) {
	const query = subjectSearch(thread.subject ?? messages[0]?.subject ?? '')
	const side = useQuery({
		// Scoped to the account but outside the mail root: mail writes cancel and
		// refetch everything under that root, and this read-only lookup (started
		// as the thread opens, just before it is marked read) must survive them.
		queryKey: sideThreadKey(thread.id, query),
		queryFn: async () => {
			const { getThreads } = await import('#server/fns')
			const page = await getThreads({ data: { q: query as string } })
			return findSideThread(thread, messages, page.threads as MailThread[])
		},
		enabled: query !== null && messages.length > 0,
		staleTime: 5 * 60_000,
		retry: false,
	})
	const sideThread = side.data ?? null
	if (trashed.length === 0 && !sideThread) return null
	const count = trashed.length
	return (
		<div data-slot="thread-stream-notices" className="flex flex-col py-1 text-[13px] text-muted-foreground">
			{count > 0 ? (
				<p role="note" className="m-0 flex min-h-8 items-center justify-center gap-2">
					<Trash2 aria-hidden="true" className="size-3.5 shrink-0" />
					<span>
						{count} {count === 1 ? 'message is' : 'messages are'} in Trash
					</span>
					<button
						type="button"
						aria-expanded={showTrashed}
						onClick={onToggleTrashed}
						className={EDGE_LINK_CLASS}
					>
						{showTrashed ? 'Hide' : 'Show'}
					</button>
				</p>
			) : null}
			{sideThread ? (
				<p role="note" className="m-0 flex min-h-8 items-center justify-center gap-2">
					<GitFork aria-hidden="true" className="size-3.5 shrink-0" />
					<span>{sideThreadText(sideThread, owner)}</span>
					<Link
						to="/mail/f/$folderId/t/$threadId"
						params={{ folderId: threadRouteFolderId(sideThread), threadId: sideThread.id }}
						className={EDGE_LINK_CLASS}
					>
						Open
					</Link>
				</p>
			) : null}
		</div>
	)
}
