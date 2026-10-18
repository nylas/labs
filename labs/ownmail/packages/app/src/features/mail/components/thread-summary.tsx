import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { DEV_MOCK_SUMMARY_MESSAGE_ID, getDevMockThreadSummary } from '../server/thread-summary-mock.js'
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
 * The local mock app's provider (board 04): it asks the server only about the
 * mock roadmap thread, and the server answers only in mock mode
 * (`OWNMAIL_DEV_MOCKS`). Against a real mailbox it is null without a request.
 */
export const mockModeThreadSummaryProvider: ThreadSummarySource = {
	async summarize(messages) {
		if (!messages.some((message) => message.id === DEV_MOCK_SUMMARY_MESSAGE_ID)) return null
		return getDevMockThreadSummary()
	},
}

/** Production builds have no provider; development builds have the one only mock mode answers. */
/* v8 ignore next -- tests always run as a development build, so the production branch is never taken -- @preserve */
const defaultProvider: ThreadSummarySource | null = import.meta.env.DEV ? mockModeThreadSummaryProvider : null

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
		// A summary is optional: a provider that throws, rejects or answers with
		// anything but lines leaves the card with its facts.
		Promise.resolve()
			.then(() => provider.summarize(messages))
			.then((bullets) => {
				const lines = (Array.isArray(bullets) ? (bullets as unknown[]) : [])
					.filter((line): line is string => typeof line === 'string')
					.map((line) => line.trim())
					.filter(Boolean)
				if (current && lines.length > 0) setResult({ key, provider, bullets: lines })
			})
			.catch(() => {})
		return () => {
			current = false
		}
	}, [provider, key])

	return result && result.key === key && result.provider === provider ? result.bullets : null
}
