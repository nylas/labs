import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import type { MailMessage } from '../state/mail-queries.js'

/**
 * The catch-up card's optional summary. OwnMail has no assistant of its own:
 * a provider is supplied by whoever adds one, and without a provider (or when
 * it has nothing to say) the summary block is not rendered at all. The facts
 * row never depends on it.
 */
export type ThreadSummarySource = {
	/** Short sentences about these messages, or null when there is nothing to say. */
	summarize(messages: MailMessage[]): Promise<string[] | null>
}

/**
 * The local mock app's provider: the three canvas bullets for the mock Q3
 * roadmap thread (board 04), so the summary block can be checked against the
 * board. It answers for the mock thread's message ids only and returns null
 * for everything else, so it never speaks about real mail.
 */
export const devMockThreadSummaryProvider: ThreadSummarySource = {
	async summarize(messages) {
		const ids = new Set(messages.map((message) => message.id))
		if (!ids.has('msg-roadmap-14')) return null
		return [
			'Alan asked for two changes: a firm date for calendar sync and search moved down.',
			'Grace made both in v4 and added Mary for launch dates.',
			'Open: Mary asks you to confirm legal sign-off by Oct 20.',
		]
	},
}

/** Development builds (the local mock app among them) get the mock provider; production gets none. */
/* v8 ignore next -- tests always run as a development build, so the production branch is never taken -- @preserve */
const defaultProvider: ThreadSummarySource | null = import.meta.env.DEV ? devMockThreadSummaryProvider : null

export const ThreadSummaryContext = createContext<ThreadSummarySource | null>(defaultProvider)

/** Supplies the summary provider to the catch-up cards beneath it; null turns summaries off. */
export function ThreadSummaryProvider({
	provider,
	children,
}: {
	provider: ThreadSummarySource | null
	children: ReactNode
}) {
	return <ThreadSummaryContext value={provider}>{children}</ThreadSummaryContext>
}

const summaryKey = (messages: MailMessage[]): string => messages.map((message) => message.id).join('\n')

/**
 * The summary of these messages from the provider in context, or null while it
 * is loading, when there is no provider, when it fails or has nothing to say.
 * A summary is only ever returned for the messages it was made from
 * (design.md "Content-ready transitions"): a new set of messages shows nothing
 * until its own summary arrives.
 */
export function useThreadSummary(messages: MailMessage[]): string[] | null {
	const provider = useContext(ThreadSummaryContext)
	const key = summaryKey(messages)
	const [result, setResult] = useState<{
		key: string
		provider: ThreadSummarySource
		bullets: string[]
	} | null>(null)

	// biome-ignore lint/correctness/useExhaustiveDependencies: the key stands for the messages it was made from
	useEffect(() => {
		if (!provider || messages.length === 0) return
		let current = true
		provider
			.summarize(messages)
			.then((bullets) => {
				const lines = (bullets ?? []).map((line) => line.trim()).filter(Boolean)
				if (current && lines.length > 0) setResult({ key, provider, bullets: lines })
			})
			.catch(() => {
				// A summary is optional: a failing provider leaves the card with its facts.
			})
		return () => {
			current = false
		}
	}, [provider, key])

	return result && result.key === key && result.provider === provider ? result.bullets : null
}
