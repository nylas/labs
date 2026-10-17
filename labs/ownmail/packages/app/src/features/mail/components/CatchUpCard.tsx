import { CornerDownRight, Paperclip, UserPlus } from 'lucide-react'
import { useId, useState } from 'react'
import { cn } from '#shared/lib/utils'
import { type CatchUpFacts, personName } from '../lib/thread-reading-model.js'
import type { MailMessage } from '../state/mail-queries.js'
import { useThreadSummary } from './thread-summary.js'

/** People named one fact each before the rest are counted. */
const MAX_JOINED = 3

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`

const factClass =
	'inline-flex h-[26px] max-w-full items-center gap-control rounded-full bg-muted px-hairline text-xs font-medium text-foreground/80 [&_svg]:size-3.5 [&_svg]:shrink-0'
const quietButtonClass =
	'inline-flex h-7 items-center gap-control rounded-md px-hairline text-xs font-medium text-foreground/70 transition-[background-color,color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-muted hover:text-foreground press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted aria-pressed:text-foreground'

/**
 * "Since you last read, Tuesday" (board 04): the facts about the messages that
 * arrived since the reader was last here (how many, who joined, which files
 * replaced earlier versions, what asks the reader something), a way to the
 * first of them, and, only when a summary provider answers, a short summary
 * with "Answer {First}" and "Show sources". No adjectives: the facts come
 * from the reading model, never from a guess.
 */
export function CatchUpCard({
	facts,
	sinceLabel,
	summaryMessages,
	onJumpToFirstNew,
	onAnswer,
	onShowSources,
}: {
	facts: CatchUpFacts
	/** The day the reader last read the thread: "Tuesday", "yesterday", "Oct 12". */
	sinceLabel: string
	/** The new messages; the summary is made from these. */
	summaryMessages: MailMessage[]
	onJumpToFirstNew(): void
	/** Reply to the message that asks the reader something. */
	onAnswer(messageId: string): void
	/** Highlight the messages the summary was made from; an empty list clears it. */
	onShowSources(ids: string[]): void
}) {
	const headingId = useId()
	const summary = useThreadSummary(summaryMessages)
	const [showingSources, setShowingSources] = useState(false)
	const question = facts.questionsToYou[0]
	const since = sinceLabel.trim()
	const joined = facts.joined.slice(0, MAX_JOINED)
	const moreJoined = facts.joined.length - joined.length

	const toggleSources = () => {
		const next = !showingSources
		setShowingSources(next)
		onShowSources(next ? summaryMessages.map((message) => message.id) : [])
	}

	return (
		<section
			aria-labelledby={headingId}
			data-slot="catch-up-card"
			className="flex flex-col gap-hairline rounded-[0.75rem] border border-border bg-card p-5 text-card-foreground"
		>
			<div className="flex items-baseline gap-cluster">
				<h2 id={headingId} className="m-0 min-w-0 flex-1 text-base font-semibold">
					{since ? `Since you last read, ${since}` : 'Since you last read'}
				</h2>
				<button
					type="button"
					onClick={onJumpToFirstNew}
					className="shrink-0 rounded-sm text-xs font-semibold text-cta-icon hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					Jump to first new
				</button>
			</div>

			<ul aria-label="What changed" className="m-0 flex list-none flex-wrap gap-cluster p-0">
				<li className={cn(factClass, 'font-data tabular-nums')}>
					{plural(facts.newCount, 'new message', 'new messages')}
				</li>
				{joined.map((person) => (
					<li key={person.email || person.name} className={factClass}>
						<UserPlus aria-hidden="true" />
						<span className="truncate">{personName(person, 'full')} joined</span>
					</li>
				))}
				{moreJoined > 0 ? (
					<li className={factClass}>
						<UserPlus aria-hidden="true" />
						{plural(moreJoined, 'more person joined', 'more people joined')}
					</li>
				) : null}
				{facts.replacedFiles.map((file) => (
					<li key={file.file} className={factClass}>
						<Paperclip aria-hidden="true" />
						<span className="truncate">
							{file.file} replaces {file.replaces}
						</span>
					</li>
				))}
				{facts.questionsToYou.length > 0 ? (
					<li className={cn(factClass, 'bg-amber-soft text-amber-soft-foreground')}>
						<CornerDownRight aria-hidden="true" />
						{plural(facts.questionsToYou.length, 'question to you', 'questions to you')}
					</li>
				) : null}
			</ul>

			{summary ? (
				<>
					<hr className="m-0 h-px border-0 bg-border" />
					<div className="flex flex-col gap-cluster">
						<p className="m-0 flex flex-wrap items-center gap-control text-xs text-muted-foreground">
							<span className="font-semibold">Summary</span>
							<span>
								· from the{' '}
								{summaryMessages.length === 1 ? 'new message' : `${summaryMessages.length} new messages`}
							</span>
						</p>
						<ul className="m-0 list-disc pl-region text-[15px] leading-[1.6] text-foreground">
							{summary.map((line, index) => (
								// A provider may repeat a line; the position keeps each bullet its own.
								// biome-ignore lint/suspicious/noArrayIndexKey: the bullets are replaced whole, never reordered
								<li key={index}>{line}</li>
							))}
						</ul>
						<div className="flex gap-cluster">
							{question ? (
								<button
									type="button"
									onClick={() => onAnswer(question.messageId)}
									className="inline-flex h-7 items-center rounded-md border border-cta-line bg-card px-hairline text-xs font-semibold text-foreground transition-[background-color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-muted press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								>
									Answer {personName(question.from, 'first')}
								</button>
							) : null}
							<button
								type="button"
								aria-pressed={showingSources}
								onClick={toggleSources}
								className={quietButtonClass}
							>
								Show sources
							</button>
						</div>
					</div>
				</>
			) : null}
		</section>
	)
}
