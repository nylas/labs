/* Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 · genre: modern-minimal · theme: Quiet */
import {
	BellOff,
	ChevronsDown,
	ChevronsUp,
	Download,
	Mail,
	Map as MapIcon,
	MessagesSquare,
} from 'lucide-react'
import {
	Fragment,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react'
import { createPortal } from 'react-dom'
import { accountScope } from '#app/lib/account-scope'
import { isThreadMuted, toggleThreadMuted } from '#app/preferences/preference-values'
import {
	type EmailLayoutPreference,
	type ThreadView,
	useUserPreferences,
	useUserPreferencesReady,
} from '#app/preferences/user-preferences'
import { ToolbarSeparator } from '#shared/components/ui/toolbar'
import { useIdentityState } from '#shared/hooks/use-identity-state'
import type { EmailColorMode, EmailLayoutMode } from '../lib/email-render.js'
import {
	originalColorSenders,
	setSenderOriginalColors,
	trustSenderImages,
} from '../lib/image-sender-trust.js'
import {
	forwardDraftSearch,
	messageHasHtml,
	replyAllDraftSearch,
	replyDraftSearch,
	threadLabels,
} from '../lib/mail-ui-model.js'
import {
	bounceFor,
	catchUpFacts,
	dateSpanLabel,
	firstName,
	foldPlan,
	messageNewText,
	newSinceDivider,
	type Person,
	participantsLabel,
	shortDayLabel,
	subjectStandIn,
	supersededInvites,
	systemEvents,
	type ThreadFile,
	threadFiles,
	threadMap,
	threadParticipants,
	toPerson,
	type UnreadSnapshot,
} from '../lib/thread-reading-model.js'
import {
	attachmentDetails,
	CATCH_UP_MIN_MESSAGES,
	hashTarget,
	isLookalikeSender,
	isTrashed,
	lineDateLabel,
	messageAnchorId,
	placeDrafts,
	resendSeed,
	type StreamEntry,
	stepMessage,
	streamEntries,
	streamMessages,
	VIRTUALIZE_AFTER,
} from '../lib/thread-stream.js'
import type { MailMessage, MailThread, ThreadHeaderFacts } from '../state/mail-queries.js'
import { formatSize } from './AttachmentLink.js'
import { CatchUpCard } from './CatchUpCard.js'
import { useCompose } from './ComposeProvider.js'
import { type ConversationReply, ConversationTranscript } from './ConversationTranscript.js'
import { DraftInThread, draftAnchorId } from './DraftInThread.js'
import type { EmailDisplayStatus } from './EmailHtml.js'
import { JumpToNewPill } from './JumpToNewPill.js'
import { MessageBody } from './MessageBody.js'
import { PartialLoadNotice } from './PartialLoadNotice.js'
import { useMediaQuery, useReaderClock } from './reader-hooks.js'
import { ThreadColumn } from './ThreadColumn.js'
import { CONVERSATION_LAYOUT_OPTIONS, ThreadDisplayMenu } from './ThreadDisplayMenu.js'
import { ThreadFilesShelf } from './ThreadFilesShelf.js'
import { ThreadMapDots } from './ThreadMapDots.js'
import { type ThreadMapFilter, ThreadMapPanel, threadMapNamesYou } from './ThreadMapPanel.js'
import { ThreadMessagesPlaceholder } from './ThreadMessagesPlaceholder.js'
import { type InviteVersion, type OpenMessageActions, ThreadOpenMessage } from './ThreadOpenMessage.js'
import { type ReaderMenuItem, ReaderMoreMenu, ThreadStepper } from './ThreadReaderControls.js'
import { ThreadReaderHeader } from './ThreadReaderHeader.js'
import { ThreadStreamNotices } from './ThreadStreamNotices.js'
import { FoldedMessagesRow, NewSinceDivider, OneLineMessageRow, SystemLine } from './ThreadStreamRows.js'
import { ThreadViewSwitch } from './ThreadViewSwitch.js'
import { VirtualStreamItem } from './VirtualStreamItem.js'

/** A pane toolbar renders an element with this id to host the thread's view controls and stepper. */
export const THREAD_TOOLBAR_ACTIONS_ID = 'thread-toolbar-actions'
/** The desktop toolbar's last slot: the reader's More menu. */
export const THREAD_TOOLBAR_MORE_ID = 'thread-toolbar-more'
/** The phone thread screen's top bar hosts the More menu here. */
export const THREAD_MOBILE_MORE_ID = 'thread-mobile-more'
/** A pane renders an element with this id, over its content below the toolbar, to dock the thread map panel. */
export const THREAD_MAP_DOCK_ID = 'thread-map-dock'

/** The toolbar takes the thread actions from Tailwind's `md` breakpoint, where it is the 44px desktop row. */
const TOOLBAR_ACTIONS_QUERY = '(min-width: 48rem)'
/** Below `md` the reader is the phone thread screen. */
const PHONE_QUERY = '(max-width: 47.999rem)'
/** `g` then `m` within this long opens the thread map. */
const CHORD_TIMEOUT_MS = 1000

type ToolbarSlots = {
	desktop: boolean
	actions: HTMLElement | null
	more: HTMLElement | null
	mapDock: HTMLElement | null
}

/**
 * Where the thread controls render: the desktop toolbar's slots, the phone top
 * bar's More slot, or neither (panes without a toolbar, such as search), in
 * which case they sit beside the subject. `undefined` until mounted, so
 * server markup never paints the controls in one place and then moves them.
 */
function useToolbarSlots(): ToolbarSlots | undefined {
	const [slots, setSlots] = useState<ToolbarSlots | undefined>(undefined)
	useLayoutEffect(() => {
		const query = window.matchMedia?.(TOOLBAR_ACTIONS_QUERY)
		const update = () => {
			const desktop = query?.matches !== false
			setSlots({
				desktop,
				actions: desktop ? document.getElementById(THREAD_TOOLBAR_ACTIONS_ID) : null,
				more: document.getElementById(desktop ? THREAD_TOOLBAR_MORE_ID : THREAD_MOBILE_MORE_ID),
				mapDock: document.getElementById(THREAD_MAP_DOCK_ID),
			})
		}
		update()
		query?.addEventListener('change', update)
		return () => query?.removeEventListener('change', update)
	}, [])
	return slots
}

/** Where the visible part of a scroll viewport ends: its bottom, above any bar it scrolls under. */
function visibleBottom(viewport: HTMLElement): number {
	return (
		viewport.getBoundingClientRect().bottom -
		(Number.parseFloat(getComputedStyle(viewport).paddingBottom) || 0)
	)
}

/** The nearest scrolling ancestor: the reader's scroll area viewport. */
function scrollParent(element: HTMLElement): HTMLElement | null {
	for (let node = element.parentElement; node; node = node.parentElement) {
		const { overflowY } = getComputedStyle(node)
		if (overflowY === 'auto' || overflowY === 'scroll') return node
	}
	return null
}

const isTypingTarget = (target: EventTarget | null): boolean =>
	target instanceof HTMLElement &&
	(target.isContentEditable ||
		/^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
		target.closest('ownmail-email') !== null)

/**
 * The canonical thread reader: subject, thread-level attachments, and the
 * expandable message list. Shared by the folder thread route, the compose backdrop,
 * and search results so there is a single reading-pane implementation. `children`
 * render after the last message, inside the same scroll flow.
 *
 * The optional Conversation view shows the same thread as a chat transcript.
 * `mailboxEmail` is the signed-in address (its messages sit on the right) and
 * `reply` supplies the existing reply entry points for the pinned input, which
 * replaces `children` in that view.
 *
 * `headerFacts` are the thread's header facts when the caller has looked them
 * up; `failedMessageIds` are messages the server could not load (the reader
 * says so and offers `onRetryLoad`); `knownSenders` are other people this
 * mailbox writes with, for the lookalike-sender check.
 */
export function ThreadConversation({
	thread,
	messages,
	mailboxEmail,
	reply,
	headerFacts,
	failedMessageIds,
	knownSenders,
	onRetryLoad,
	onDiscardDraft,
	children,
}: {
	thread: MailThread
	messages: MailMessage[]
	mailboxEmail?: string
	reply?: ConversationReply
	headerFacts?: ThreadHeaderFacts
	failedMessageIds?: string[]
	knownSenders?: Person[]
	onRetryLoad?: () => void
	onDiscardDraft?: (draftId: string) => void
	children?: ReactNode
}) {
	return (
		<ThreadConversationController
			key={thread.id}
			thread={thread}
			messages={messages}
			mailboxEmail={mailboxEmail}
			reply={reply}
			headerFacts={headerFacts}
			failedMessageIds={failedMessageIds}
			knownSenders={knownSenders}
			onRetryLoad={onRetryLoad}
			onDiscardDraft={onDiscardDraft}
		>
			{children}
		</ThreadConversationController>
	)
}

type ReaderExtras = {
	headerFacts: ThreadHeaderFacts | undefined
	failedMessageIds: string[] | undefined
	knownSenders: Person[] | undefined
	onRetryLoad: (() => void) | undefined
	onDiscardDraft: ((draftId: string) => void) | undefined
}

function ThreadConversationController({
	thread,
	messages,
	mailboxEmail,
	reply,
	children,
	...extras
}: {
	thread: MailThread
	messages: MailMessage[]
	mailboxEmail: string | undefined
	reply: ConversationReply | undefined
	children?: ReactNode
} & ReaderExtras) {
	const [preferences, savePreferences] = useUserPreferences()
	// The saved view is not known while rendering on the server and hydrating.
	// Until it is, the messages are a neutral placeholder, so a person whose
	// default is Conversation never sees the standard reader first.
	const preferencesReady = useUserPreferencesReady()
	// The toolbar switch flips this thread only, in memory. The flip lives under
	// the thread's identity and is remembered against the default it overrode:
	// once a new default is chosen (from the command palette) it is dropped, not
	// kept for later.
	const [viewOverride, setViewOverride] = useIdentityState<{ view: ThreadView; over: ThreadView } | null>(
		[thread.id],
		() => null,
	)
	// What was unread when the thread first loaded, before opening it marked it
	// read: the "new since" divider, the catch-up card and the map's "You
	// stopped here" all read this, for as long as the thread stays open.
	const [snapshot] = useIdentityState<UnreadSnapshot>([thread.id], () => ({
		unreadIds: messages.filter((message) => message.unread === true).map((message) => message.id),
	}))
	const overrideStands = viewOverride?.over === preferences.threadView
	if (viewOverride && !overrideStands) setViewOverride(null)
	const threadView = viewOverride && overrideStands ? viewOverride.view : preferences.threadView
	const [displayStatuses, setDisplayStatuses] = useState<Map<string, EmailDisplayStatus>>(() => new Map())
	const [loadRemoteImagesForThread, setLoadRemoteImagesForThread] = useState(false)
	const [trustedDuringThisView, setTrustedDuringThisView] = useState<Set<string>>(() => new Set())
	const [retryRevision, setRetryRevision] = useState(0)
	const [senderTrustStatus, setSenderTrustStatus] = useState<{
		address?: string
		state: 'idle' | 'loading' | 'error'
	}>({ state: 'idle' })
	const [originalSenders, setOriginalSenders] = useState<ReadonlySet<string>>(() => new Set())
	const [originalColorStatus, setOriginalColorStatus] = useState<'idle' | 'error'>('idle')
	const latestMessageId = messages.at(-1)?.id

	useEffect(() => {
		let active = true
		void originalColorSenders(accountScope()).then((senders) => {
			if (active) setOriginalSenders(new Set(senders))
		})
		return () => {
			active = false
		}
	}, [])

	const onSenderOriginalColorsChange = useCallback(async (address: string, enabled: boolean) => {
		const update = (include: boolean) =>
			setOriginalSenders((current) => {
				const next = new Set(current)
				if (include) next.add(address)
				else next.delete(address)
				return next
			})
		update(enabled)
		setOriginalColorStatus('idle')
		if (await setSenderOriginalColors(address, enabled, accountScope())) return
		update(!enabled)
		setOriginalColorStatus('error')
	}, [])

	const onDisplayStatus = useCallback((messageId: string, status: EmailDisplayStatus | null) => {
		setDisplayStatuses((current) => {
			const next = new Map(current)
			if (status) next.set(messageId, status)
			else next.delete(messageId)
			return next
		})
	}, [])

	const onTrustSender = useCallback(async (address: string) => {
		setSenderTrustStatus({ address, state: 'loading' })
		const trusted = await trustSenderImages(address, accountScope())
		if (!trusted) {
			setSenderTrustStatus({ address, state: 'error' })
			return
		}
		setTrustedDuringThisView((current) => new Set(current).add(address.trim().toLowerCase()))
		setSenderTrustStatus({ address, state: 'idle' })
	}, [])

	// Reset expansion state as part of the conversation identity so a thread swap
	// cannot paint once with the previous thread's open message IDs. Including the
	// latest message also preserves the existing behaviour when a new reply arrives.
	return (
		<ThreadConversationContent
			key={latestMessageId}
			thread={thread}
			messages={messages}
			mailboxEmail={mailboxEmail}
			reply={reply}
			snapshot={snapshot}
			threadView={threadView}
			onThreadViewChange={(view) => setViewOverride({ view, over: preferences.threadView })}
			preferencesReady={preferencesReady}
			muted={isThreadMuted(preferences, thread.id)}
			onToggleMuted={() => savePreferences(toggleThreadMuted(preferences, thread.id))}
			displayStatuses={displayStatuses}
			// `clean` belongs to the Conversation view; the standard reader lays it out as readable.
			layoutMode={preferences.emailLayoutMode === 'original' ? 'original' : 'readable'}
			colorMode={preferences.emailColorMode}
			darkenEmail={preferences.emailDarkMode}
			loadRemoteImagesForThread={loadRemoteImagesForThread}
			trustedDuringThisView={trustedDuringThisView}
			originalColorSenders={originalSenders}
			originalColorStatus={originalColorStatus}
			onSenderOriginalColorsChange={(address, enabled) => void onSenderOriginalColorsChange(address, enabled)}
			retryRevision={retryRevision}
			senderTrustStatus={senderTrustStatus}
			onDisplayStatus={onDisplayStatus}
			onLayoutModeChange={(emailLayoutMode) => savePreferences({ ...preferences, emailLayoutMode })}
			onColorModeChange={(emailColorMode) => savePreferences({ ...preferences, emailColorMode })}
			onShowThreadImages={() => setLoadRemoteImagesForThread(true)}
			onAlwaysShowImages={() => savePreferences({ ...preferences, remoteImagePolicy: 'always' })}
			onTrustSender={(address) => void onTrustSender(address)}
			onRetryImages={() => setRetryRevision((current) => current + 1)}
			{...extras}
		>
			{children}
		</ThreadConversationContent>
	)
}

/** The quoted text a "Quote selection in reply" seeds: the selection inside that message, else its own words. */
function quotedText(message: MailMessage): string {
	const selection = window.getSelection()
	const anchor = selection?.anchorNode
	const article = document.getElementById(messageAnchorId(message.id))
	const selected = selection && anchor && article?.contains(anchor) ? selection.toString().trim() : ''
	const text = selected || messageNewText(message)
	return `${text
		.split('\n')
		.map((line) => `> ${line}`.trimEnd())
		.join('\n')}\n\n`
}

const sendAt = (message: MailMessage): number | undefined => {
	const value = (message as { send_at?: unknown }).send_at
	return typeof value === 'number' ? value : undefined
}

function ThreadConversationContent({
	thread,
	messages,
	mailboxEmail,
	reply,
	snapshot,
	threadView,
	onThreadViewChange,
	preferencesReady,
	muted,
	onToggleMuted,
	displayStatuses,
	layoutMode,
	colorMode,
	darkenEmail,
	loadRemoteImagesForThread,
	trustedDuringThisView,
	originalColorSenders,
	originalColorStatus,
	onSenderOriginalColorsChange,
	retryRevision,
	senderTrustStatus,
	onDisplayStatus,
	onLayoutModeChange,
	onColorModeChange,
	onShowThreadImages,
	onAlwaysShowImages,
	onTrustSender,
	onRetryImages,
	headerFacts,
	failedMessageIds,
	knownSenders,
	onRetryLoad,
	onDiscardDraft,
	children,
}: {
	thread: MailThread
	messages: MailMessage[]
	mailboxEmail: string | undefined
	reply: ConversationReply | undefined
	snapshot: UnreadSnapshot
	threadView: ThreadView
	onThreadViewChange: (view: ThreadView) => void
	preferencesReady: boolean
	muted: boolean
	onToggleMuted: () => void
	displayStatuses: ReadonlyMap<string, EmailDisplayStatus>
	layoutMode: EmailLayoutMode
	colorMode: EmailColorMode
	darkenEmail: boolean
	loadRemoteImagesForThread: boolean
	trustedDuringThisView: ReadonlySet<string>
	originalColorSenders: ReadonlySet<string>
	originalColorStatus: 'idle' | 'error'
	onSenderOriginalColorsChange: (address: string, enabled: boolean) => void
	retryRevision: number
	senderTrustStatus: { address?: string; state: 'idle' | 'loading' | 'error' }
	onDisplayStatus: (messageId: string, status: EmailDisplayStatus | null) => void
	onLayoutModeChange: (mode: EmailLayoutPreference) => void
	onColorModeChange: (mode: EmailColorMode) => void
	onShowThreadImages: () => void
	onAlwaysShowImages: () => void
	onTrustSender: (address: string) => void
	onRetryImages: () => void
	children?: ReactNode
} & ReaderExtras) {
	const owner = mailboxEmail ?? ''
	const slots = useToolbarSlots()
	const phone = useMediaQuery(PHONE_QUERY)
	const clock = useReaderClock()
	const { openCompose } = useCompose()
	const rootRef = useRef<HTMLDivElement>(null)
	const filesShelfId = useId()
	const conversation = threadView === 'conversation'

	// ---- What the stream holds --------------------------------------------------
	const [showTrashed, setShowTrashed] = useState(false)
	const trashed = useMemo(
		() => messages.filter((message) => message.ownmailDraft !== true && isTrashed(message)),
		[messages],
	)
	const visible = useMemo(() => streamMessages(messages, showTrashed), [messages, showTrashed])
	const visibleIds = useMemo(() => new Set(visible.map((message) => message.id)), [visible])
	const drafts = useMemo(() => placeDrafts(messages, visibleIds), [messages, visibleIds])
	const people = useMemo(() => threadParticipants(visible, owner), [visible, owner])
	const ownerFirstName = useMemo(() => {
		const self = people.find((person) => person.isOwner)
		return self?.name ? firstName(self) : ''
	}, [people])
	const bounces = useMemo(() => bounceFor(visible, owner), [visible, owner])
	const bounceByOriginal = useMemo(
		() => new Map(bounces.map((bounce) => [bounce.originalId, { address: bounce.address }])),
		[bounces],
	)
	const invites = useMemo(() => {
		const byMessage = new Map<string, InviteVersion>()
		const byId = new Map(visible.map((message) => [message.id, message]))
		for (const { latestId, versions } of supersededInvites(visible).values()) {
			const earlier = versions.slice(0, -1)
			byMessage.set(latestId, {
				kind: 'latest',
				updateCount: earlier.length,
				earlierVersions: earlier.map((id) => byId.get(id) as MailMessage),
			})
			for (const id of earlier) byMessage.set(id, { kind: 'superseded', latestId })
		}
		return byMessage
	}, [visible])

	const [mapOpen, setMapOpen] = useState(false)
	const [mapFilter, setMapFilter] = useState<ThreadMapFilter>('all')

	// ---- Which messages are open ------------------------------------------------
	const [targetId, setTargetId] = useState<string | undefined>(undefined)
	// Your own mail that bounced or waits to be sent opens, so its state is on screen.
	const [openIds, setOpenIds] = useState<Set<string>>(
		() =>
			new Set([
				...bounces.map((bounce) => bounce.originalId),
				...visible
					.filter((message) => (sendAt(message) ?? 0) * 1000 > Date.now())
					.map((message) => message.id),
			]),
	)
	const [closedIds, setClosedIds] = useState<Set<string>>(() => new Set())
	const [expandedRuns, setExpandedRuns] = useState<Set<string>>(() => new Set())
	const plan = useMemo(
		() =>
			foldPlan(visible, {
				owner,
				ownerFirstName,
				unreadIds: snapshot.unreadIds,
				...(targetId ? { targetId } : {}),
				expandedRuns,
				openIds,
				...(clock ? { now: clock.now, tz: clock.tz } : {}),
			}),
		[visible, owner, ownerFirstName, snapshot, targetId, expandedRuns, openIds, clock],
	)
	const divider = useMemo(() => {
		const found = newSinceDivider(visible, snapshot, clock?.now ?? Date.now(), clock?.tz ?? 'UTC')
		// The day is the reader's own; until the page is in the browser the divider says only how many.
		return found && !clock ? { ...found, label: `${found.count} new`, since: null } : found
	}, [visible, snapshot, clock])
	const events = useMemo(() => systemEvents(visible, owner), [visible, owner])
	const unreadVisible = useMemo(
		() => visible.filter((message) => snapshot.unreadIds.includes(message.id)),
		[visible, snapshot],
	)
	const showCatchUp = visible.length >= CATCH_UP_MIN_MESSAGES && unreadVisible.length > 0 && divider !== null
	const entries = useMemo(
		() =>
			streamEntries({
				messages: visible,
				plan,
				closedIds,
				divider,
				events,
				catchUp: showCatchUp,
				drafts,
			}),
		[visible, plan, closedIds, divider, events, showCatchUp, drafts],
	)
	const files = useMemo(() => threadFiles(visible, owner), [visible, owner])
	const details = useMemo(
		() => attachmentDetails(visible, owner, clock?.now ?? Date.now(), clock?.tz ?? 'UTC', formatSize),
		[visible, owner, clock],
	)
	const map = useMemo(() => threadMap(visible, snapshot, owner), [visible, snapshot, owner])
	const namesYouIds = useMemo(
		() => (mapOpen ? threadMapNamesYou(visible, owner, ownerFirstName) : []),
		[mapOpen, visible, owner, ownerFirstName],
	)
	const allKnownSenders = useMemo(() => [...people, ...(knownSenders ?? [])], [people, knownSenders])

	// ---- Focus: the stepper, j/k and the map follow one message ----------------
	const [currentId, setCurrentId] = useState<string | undefined>(
		() => visible.find((message) => snapshot.unreadIds.includes(message.id))?.id ?? visible.at(-1)?.id,
	)
	const currentIndex = Math.max(
		0,
		visible.findIndex((message) => message.id === currentId),
	)
	const pendingScroll = useRef<string | null>(null)
	const [filesOpen, setFilesOpen] = useState(false)
	const [sourceIds, setSourceIds] = useState<ReadonlySet<string>>(() => new Set())

	const openMessage = useCallback((messageId: string) => {
		setOpenIds((current) => new Set(current).add(messageId))
		setClosedIds((current) => {
			if (!current.has(messageId)) return current
			const next = new Set(current)
			next.delete(messageId)
			return next
		})
		setCurrentId(messageId)
	}, [])

	// Only an open message has a header to close it from.
	const closeMessage = useCallback((messageId: string) => {
		setOpenIds((current) => {
			const next = new Set(current)
			next.delete(messageId)
			return next
		})
		setClosedIds((current) => new Set(current).add(messageId))
	}, [])

	/** Opens a message wherever it is (unfolding its run) and scrolls it into view. */
	const goTo = useCallback(
		(messageId: string) => {
			const run = plan.find((item) => item.kind === 'folded' && item.ids.includes(messageId))
			if (run?.kind === 'folded') setExpandedRuns((current) => new Set([...current, ...run.ids]))
			pendingScroll.current = messageId
			openMessage(messageId)
		},
		[plan, openMessage],
	)

	// Scroll a message the reader moved to into view once it is laid out.
	useEffect(() => {
		const messageId = pendingScroll.current
		const element = messageId ? document.getElementById(messageAnchorId(messageId)) : null
		if (!element) return
		pendingScroll.current = null
		element.scrollIntoView?.({ block: 'start' })
		element.querySelector<HTMLElement>('[data-slot="message-header"]')?.focus?.({ preventScroll: true })
	})

	// Stepping is offered only while there is more than one message.
	const step = useCallback(
		(direction: 1 | -1) => {
			const next = visible[stepMessage(currentIndex, direction, visible.length)] as MailMessage
			if (next.id !== currentId) goTo(next.id)
		},
		[visible, currentIndex, currentId, goTo],
	)

	// A link to `#message-<id>` opens that message, once, when the thread opens.
	// biome-ignore lint/correctness/useExhaustiveDependencies: read once per thread, not on every change
	useEffect(() => {
		const target = hashTarget(window.location.hash, visible)
		if (target) {
			setTargetId(target)
			goTo(target)
		}
	}, [])

	// The thread opens where the reader left off: a draft of theirs first, else
	// the "new since" divider, when it is not already in view.
	const openedAt = useRef(false)
	useEffect(() => {
		if (openedAt.current || conversation || !preferencesReady || !clock) return
		openedAt.current = true
		if (window.location.hash) return
		const draft = drafts.at(-1)?.draft
		const root = rootRef.current as HTMLElement
		const element = draft
			? document.getElementById(draftAnchorId(draft.id))
			: root.querySelector<HTMLElement>('[data-slot="new-since-divider"]')
		const viewport = scrollParent(root)
		if (!element || !viewport || viewport.scrollTop > 0) return
		const top = element.getBoundingClientRect().top - viewport.getBoundingClientRect().top
		if (top > viewport.clientHeight * 0.6) element.scrollIntoView?.({ block: 'start' })
	}, [conversation, preferencesReady, clock, drafts])

	// j / k step through messages, g m opens the thread map. In a split view the
	// list keeps its own j / k while focus is in it.
	const multiple = visible.length > 1
	useEffect(() => {
		if (conversation || !multiple) return
		let chordAt = 0
		function onKeyDown(event: KeyboardEvent) {
			if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return
			if (isTypingTarget(event.target)) return
			if (event.target instanceof Element && event.target.closest('[role="menu"], [role="dialog"]')) return
			if (document.querySelector('[role="dialog"]')) return
			const root = rootRef.current
			// The reader's own keys act when focus is in it, or on nothing at all.
			const inReader =
				root !== null &&
				(event.target === document.body ||
					(event.target instanceof Node &&
						root.closest('[data-testid="thread-reader"]')?.contains(event.target)) ||
					(event.target instanceof Node && root.contains(event.target)))
			const focusInList = event.target instanceof Element && event.target.closest('[data-nav-row]') !== null
			const key = event.key
			if (key === 'g') {
				chordAt = Date.now()
				return
			}
			if (key === 'm' && Date.now() - chordAt < CHORD_TIMEOUT_MS && !focusInList) {
				chordAt = 0
				event.preventDefault()
				event.stopImmediatePropagation()
				setMapOpen((current) => !current)
				return
			}
			chordAt = 0
			// Beside a list, j / k with nothing focused (or a row focused) stay the list's.
			const listBeside = document.querySelector('[data-nav-row]') !== null
			if (!inReader || (listBeside && (focusInList || event.target === document.body))) return
			if (key === 'j' || key === 'k') {
				event.preventDefault()
				event.stopImmediatePropagation()
				step(key === 'j' ? 1 : -1)
			}
		}
		window.addEventListener('keydown', onKeyDown, true)
		return () => window.removeEventListener('keydown', onKeyDown, true)
	}, [conversation, multiple, step])

	// ---- New messages below the fold (phone) ---------------------------------
	const [belowCount, setBelowCount] = useState(0)
	// biome-ignore lint/correctness/useExhaustiveDependencies: a changed stream (a run unfolded, a message opened) moves what is below the fold
	useEffect(() => {
		if (!phone || conversation || unreadVisible.length === 0) return
		const viewport = scrollParent(rootRef.current as HTMLElement)
		if (!viewport) return
		const update = () => {
			const bottom = visibleBottom(viewport)
			setBelowCount(
				unreadVisible.filter((message) => {
					const element = document.getElementById(messageAnchorId(message.id))
					return element !== null && element.getBoundingClientRect().top > bottom
				}).length,
			)
		}
		update()
		viewport.addEventListener('scroll', update, { passive: true })
		return () => viewport.removeEventListener('scroll', update)
	}, [phone, conversation, unreadVisible, entries])
	// The pill shows only while a viewport has new messages below it.
	const jumpToNextNew = useCallback(() => {
		const bottom = visibleBottom(scrollParent(rootRef.current as HTMLElement) as HTMLElement)
		const next = unreadVisible.find(
			(message) =>
				(document.getElementById(messageAnchorId(message.id)) as HTMLElement).getBoundingClientRect().top >
				bottom,
		)
		if (next) goTo(next.id)
	}, [unreadVisible, goTo])

	// ---- Replies ---------------------------------------------------------------
	// Your own message, in a new composer: to send it again, or now.
	const editAndResend = useCallback(
		(message: MailMessage) => void openCompose({ kind: 'new', ...resendSeed(message) }),
		[openCompose],
	)
	const actions = useMemo<OpenMessageActions>(
		() => ({
			onToggle: closeMessage,
			onReply: (message) =>
				void openCompose({ kind: 'reply', threadId: thread.id, ...replyDraftSearch(message) }),
			onForward: (message) =>
				void openCompose({ kind: 'forward', threadId: thread.id, ...forwardDraftSearch(message) }),
			onQuote: (message) =>
				void openCompose({
					kind: 'reply',
					threadId: thread.id,
					...replyDraftSearch(message),
					body: quotedText(message),
				}),
			onMuteThread: () => {
				if (!muted) onToggleMuted()
			},
			onAddBack: (message, person) => {
				const search = replyAllDraftSearch(message, owner)
				void openCompose({
					kind: 'reply',
					threadId: thread.id,
					...search,
					to: [search.to, person.email].filter(Boolean).join(', '),
				})
			},
			onEditResend: (message) => editAndResend(message),
			onSendNow: (message) => editAndResend(message),
			onCancelSchedule: () => {},
			onShowMessage: goTo,
			onDisplayStatus,
		}),
		[closeMessage, openCompose, thread.id, muted, onToggleMuted, owner, editAndResend, goTo, onDisplayStatus],
	)

	const display = useCallback(
		(message: MailMessage) => {
			const sender = message.from?.[0]?.email?.trim().toLowerCase() ?? ''
			return {
				darkenEmail,
				layoutMode,
				colorMode: colorMode === 'original' || originalColorSenders.has(sender) ? 'original' : 'automatic',
				loadRemoteImagesForThread,
				loadRemoteImagesForSender: trustedDuringThisView.has(sender),
				retryRevision,
				bodyFontSize: phone ? 17 : 16,
			} as const
		},
		[
			darkenEmail,
			layoutMode,
			colorMode,
			originalColorSenders,
			loadRemoteImagesForThread,
			trustedDuringThisView,
			retryRevision,
			phone,
		],
	)

	// ---- Toolbar controls --------------------------------------------------------
	const hasHtmlMessages = messages.some(messageHasHtml)
	const latest = visible.at(-1)
	const displayMenu = hasHtmlMessages ? (
		<ThreadDisplayMenu
			messages={messages}
			statuses={displayStatuses}
			{...(conversation
				? {
						layoutMode: layoutMode === 'original' ? 'original' : 'clean',
						layoutOptions: CONVERSATION_LAYOUT_OPTIONS,
					}
				: { layoutMode })}
			colorMode={colorMode}
			showColorControl={darkenEmail}
			senderTrustStatus={senderTrustStatus}
			originalColorSenders={originalColorSenders}
			originalColorStatus={originalColorStatus}
			onSenderOriginalColorsChange={onSenderOriginalColorsChange}
			onLayoutModeChange={onLayoutModeChange}
			onColorModeChange={onColorModeChange}
			onShowThreadImages={onShowThreadImages}
			onAlwaysShowImages={onAlwaysShowImages}
			onTrustSender={onTrustSender}
			onRetryImages={onRetryImages}
		/>
	) : null
	// A single plain message has no display options: the switch stands alone.
	const viewGroup = displayMenu ? (
		<div data-slot="thread-actions" className="flex min-w-0 shrink-0 items-center gap-control">
			<ThreadViewSwitch value={threadView} onChange={onThreadViewChange} />
			{displayMenu}
		</div>
	) : (
		<ThreadViewSwitch value={threadView} onChange={onThreadViewChange} />
	)
	const stepper =
		!conversation && multiple ? (
			<ThreadStepper position={currentIndex + 1} count={visible.length} onStep={step} />
		) : null
	const allOpen = entries.every((entry) => entry.kind !== 'line' && entry.kind !== 'folded')
	const allClosed = !entries.some((entry) => entry.kind === 'open')
	const menuItems = (withView: boolean): ReaderMenuItem[] => [
		...(withView
			? [
					conversation
						? {
								kind: 'action' as const,
								label: 'Messages view',
								icon: Mail,
								onSelect: () => onThreadViewChange('messages'),
							}
						: {
								kind: 'action' as const,
								label: 'Conversation view',
								icon: MessagesSquare,
								onSelect: () => onThreadViewChange('conversation'),
							},
				]
			: []),
		{
			kind: 'action',
			label: muted ? 'Unmute thread' : 'Mute thread',
			icon: BellOff,
			pressed: muted,
			onSelect: onToggleMuted,
		},
		...(!conversation && multiple
			? [
					{
						kind: 'action' as const,
						label: 'Thread map',
						icon: MapIcon,
						shortcut: 'g m',
						pressed: mapOpen,
						onSelect: () => setMapOpen((current) => !current),
					},
					{
						kind: 'action' as const,
						label: `Expand all ${visible.length} messages`,
						icon: ChevronsDown,
						disabled: allOpen,
						onSelect: () => {
							setOpenIds(new Set(visible.map((message) => message.id)))
							setExpandedRuns(new Set(visible.map((message) => message.id)))
							setClosedIds(new Set())
						},
					},
					{
						kind: 'action' as const,
						label: `Collapse all ${visible.length} messages`,
						icon: ChevronsUp,
						disabled: allClosed,
						onSelect: () => {
							setOpenIds(new Set())
							setClosedIds(new Set(visible.map((message) => message.id)))
						},
					},
				]
			: []),
		...(latest && latest.ownmailDraft !== true
			? [
					{ kind: 'separator' as const, key: 'download' },
					{
						kind: 'link' as const,
						label: 'Download raw email',
						icon: Download,
						href: `/messages/${encodeURIComponent(latest.id)}/download`,
						download: true,
					},
				]
			: []),
	]
	// On a phone the display options earn a place beside More only when they have something to offer.
	const displayHasNews = [...displayStatuses.values()].some(
		(status) => status.layoutAvailable || status.remoteImages?.hasRemoteImages === true,
	)
	let headerActions: ReactNode = null
	let toolbarPortals: ReactNode = null
	// On a phone the top bar's More holds the view choice too.
	const phoneBar = slots !== undefined && !slots.desktop && slots.more !== null
	if (slots && ((!slots.actions && !phoneBar) || !slots.more)) {
		// What no toolbar slot takes sits beside the subject.
		headerActions = (
			<div className="flex min-w-0 shrink-0 items-center gap-control">
				{slots.actions || phoneBar ? null : (
					<>
						{viewGroup}
						{stepper}
					</>
				)}
				{slots.more ? null : <ReaderMoreMenu items={menuItems(false)} />}
			</div>
		)
	}
	if (slots && (slots.actions || slots.more)) {
		toolbarPortals = (
			<>
				{slots.actions
					? createPortal(
							<>
								{viewGroup}
								{stepper ? (
									<>
										<ToolbarSeparator />
										{stepper}
									</>
								) : null}
							</>,
							slots.actions,
						)
					: null}
				{slots.more
					? createPortal(
							<>
								{!slots.desktop && displayHasNews ? displayMenu : null}
								<ReaderMoreMenu items={menuItems(!slots.desktop)} />
							</>,
							slots.more,
						)
					: null}
			</>
		)
	}

	// ---- Header -------------------------------------------------------------------
	const title = subjectStandIn(
		thread.subject ?? visible[0]?.subject,
		visible[0]?.body ?? visible[0]?.snippet ?? '',
	)
	const named = participantsLabel(people, 4)
	const shownPeople = useMemo(() => {
		const self = people.filter((person) => person.isOwner)
		const others = people.filter((person) => !person.isOwner)
		return [...others.slice(0, 4 - self.length), ...self]
	}, [people])
	const dates = visible.map((message) => message.date ?? 0).filter((date) => date > 0)
	const span =
		clock && dates.length > 0
			? dateSpanLabel(Math.min(...dates), Math.max(...dates), clock.now, clock.tz)
			: ''
	const dayLabel = useCallback(
		(seconds: number) => (clock ? shortDayLabel(seconds, clock.now, clock.tz) : ''),
		[clock],
	)

	const virtual = visible.length > VIRTUALIZE_AFTER
	const renderEntry = (entry: StreamEntry): ReactNode => {
		switch (entry.kind) {
			case 'open':
				return (
					<ThreadOpenMessage
						message={entry.message}
						{...(entry.prev ? { prev: entry.prev } : {})}
						owner={owner}
						{...(headerFacts?.byMessage[entry.message.id]
							? { facts: headerFacts.byMessage[entry.message.id] }
							: {})}
						knownSenders={allKnownSenders}
						lookalike={isLookalikeSender(entry.message, allKnownSenders, owner)}
						{...(invites.get(entry.message.id) ? { invite: invites.get(entry.message.id) } : {})}
						{...(bounceByOriginal.get(entry.message.id)
							? { bounce: bounceByOriginal.get(entry.message.id) }
							: {})}
						attachmentDetails={details}
						display={display(entry.message)}
						actions={actions}
						current={entry.message.id === currentId}
					/>
				)
			case 'line':
				return (
					<ThreadColumn>
						<OneLineMessageRow
							message={entry.message}
							owner={owner}
							date={clock ? lineDateLabel(entry.message.date, clock.now, clock.tz) : ''}
							onOpen={openMessage}
						/>
					</ThreadColumn>
				)
			case 'folded':
				return (
					<ThreadColumn>
						<FoldedMessagesRow
							item={clock ? entry.item : { ...entry.item, span: '' }}
							onExpand={(ids) => setExpandedRuns((current) => new Set([...current, ...ids]))}
						/>
					</ThreadColumn>
				)
			case 'divider':
				return (
					<ThreadColumn>
						<NewSinceDivider label={entry.label} />
					</ThreadColumn>
				)
			case 'catch-up':
				// The card shows only above new messages, so there is always a first one.
				return (
					<ThreadColumn>
						<div data-slot="catch-up" className="reader-catch-up">
							<CatchUpCard
								facts={catchUpFacts(visible, snapshot, owner, ownerFirstName)}
								sinceLabel={divider?.since ?? ''}
								summaryMessages={unreadVisible}
								onJumpToFirstNew={() => goTo((unreadVisible[0] as MailMessage).id)}
								onAnswer={(messageId: string) =>
									actions.onReply(visible.find((candidate) => candidate.id === messageId) as MailMessage)
								}
								onShowSources={(ids: string[]) => {
									setSourceIds(new Set(ids))
									for (const id of ids) openMessage(id)
									const first = ids[0]
									if (first) goTo(first)
								}}
							/>
						</div>
					</ThreadColumn>
				)
			case 'system':
				return (
					<ThreadColumn>
						<SystemLine text={entry.text} />
					</ThreadColumn>
				)
			case 'draft': {
				const to = entry.message.to?.[0]
				const replyToFirstName = to ? firstName(toPerson(to, owner)) : undefined
				return (
					<ThreadColumn>
						<div data-draft-id={entry.message.id} className="reader-draft">
							<DraftInThread
								draft={entry.message}
								{...(replyToFirstName ? { replyToFirstName } : {})}
								onResume={() => void openCompose({ kind: 'draft', draftId: entry.message.id })}
								onDiscard={() => onDiscardDraft?.(entry.message.id)}
							/>
						</div>
					</ThreadColumn>
				)
			}
		}
	}

	return (
		<div
			ref={rootRef}
			data-slot="thread-conversation"
			className={conversation ? 'flex min-h-full flex-col bg-background' : 'reader min-h-full bg-background'}
		>
			{toolbarPortals}
			<div className={conversation ? 'contents' : 'reader-layout'}>
				<div className={conversation ? 'contents' : 'reader-main'}>
					<ThreadReaderHeader
						subject={title.text}
						isStandIn={title.isStandIn}
						people={shownPeople}
						names={named.names}
						more={named.more}
						messageCount={visible.length}
						span={span}
						fileCount={files.length}
						filesOpen={filesOpen}
						filesShelfId={filesShelfId}
						onToggleFiles={() => setFilesOpen((current) => !current)}
						labels={threadLabels(thread)}
						actions={headerActions}
					/>
					{filesOpen ? (
						<ThreadColumn>
							<div id={filesShelfId} data-slot="thread-files-shelf" className="reader-files-shelf">
								<ThreadFilesShelf
									files={files}
									onDownloadAll={() => downloadAll(files)}
									onOpenFile={(file: ThreadFile) =>
										window.open(attachmentUrl(file.attachmentId, file.messageId), '_blank', 'noopener')
									}
								/>
							</div>
						</ThreadColumn>
					) : null}

					{!preferencesReady ? (
						<ThreadMessagesPlaceholder />
					) : conversation ? (
						<ConversationTranscript
							threadId={thread.id}
							messages={messages}
							mailboxEmail={mailboxEmail}
							loadRemoteImagesForThread={loadRemoteImagesForThread}
							trustedDuringThisView={trustedDuringThisView}
							cleanDesigned={layoutMode !== 'original'}
							onDisplayStatus={onDisplayStatus}
							reply={reply}
							renderOriginal={(message) => (
								<MessageBody message={message} {...display(message)} onDisplayStatus={onDisplayStatus} />
							)}
						>
							{children}
						</ConversationTranscript>
					) : (
						<div data-slot="thread-messages" className="reader-messages">
							{failedMessageIds && failedMessageIds.length > 0 ? (
								<ThreadColumn>
									<PartialLoadNotice
										failedCount={failedMessageIds.length}
										shownCount={messages.filter((message) => message.ownmailDraft !== true).length}
										onRetry={() => onRetryLoad?.()}
									/>
								</ThreadColumn>
							) : null}
							<div data-slot="thread-message-stream" data-navigation-content="">
								{entries.map((entry) => (
									<Fragment key={entry.key}>
										{entry.separated ? (
											<div aria-hidden="true" data-slot="stream-rule" data-before={entry.kind}>
												<ThreadColumn>
													<div className="reader-rule" />
												</ThreadColumn>
											</div>
										) : null}
										<VirtualStreamItem
											kind={entry.kind}
											{...(entry.kind === 'open' || entry.kind === 'line'
												? { anchorId: messageAnchorId(entry.message.id) }
												: {})}
											virtual={virtual}
											pinned={
												(entry.kind === 'open' || entry.kind === 'line') &&
												(entry.message.id === currentId || sourceIds.has(entry.message.id))
											}
											highlight={
												(entry.kind === 'open' || entry.kind === 'line') && sourceIds.has(entry.message.id)
											}
										>
											{renderEntry(entry)}
										</VirtualStreamItem>
									</Fragment>
								))}
							</div>
							<ThreadColumn>
								<ThreadStreamNotices
									trashed={trashed}
									showTrashed={showTrashed}
									onToggleTrashed={() => setShowTrashed((current) => !current)}
									thread={thread}
									messages={visible}
									owner={owner}
								/>
							</ThreadColumn>
							{children}
						</div>
					)}
				</div>
				{!conversation && preferencesReady && multiple ? (
					<ThreadMapDots
						entries={map.entries}
						stoppedBeforeIndex={map.stoppedBeforeIndex}
						currentId={currentId}
						dateLabel={dayLabel}
						onSelect={goTo}
						onOpenPanel={() => setMapOpen(true)}
					/>
				) : null}
			</div>
			{!conversation && multiple && slots
				? dock(
						<ThreadMapPanel
							open={mapOpen}
							entries={map.entries}
							stoppedBeforeIndex={map.stoppedBeforeIndex}
							filter={mapFilter}
							onFilter={setMapFilter}
							selectedId={currentId}
							onSelect={goTo}
							onClose={() => setMapOpen(false)}
							namesYouIds={namesYouIds}
						/>,
						slots.mapDock,
					)
				: null}
			{!conversation && phone ? (
				<div data-slot="jump-to-new" className="reader-jump">
					<JumpToNewPill count={belowCount} onJump={jumpToNextNew} />
				</div>
			) : null}
		</div>
	)
}

/** The map panel floats over the pane, below its toolbar, where the pane offers a dock. */
const dock = (panel: ReactNode, target: HTMLElement | null): ReactNode =>
	target ? createPortal(panel, target) : panel

const attachmentUrl = (attachmentId: string, messageId: string): string =>
	`/attachments/${encodeURIComponent(attachmentId)}?message_id=${encodeURIComponent(messageId)}`

/** Downloads every file in turn through the attachment route; the browser saves each one. */
function downloadAll(files: Array<{ attachmentId: string; messageId: string; filename: string }>) {
	files.forEach((file, index) => {
		window.setTimeout(() => {
			const link = document.createElement('a')
			link.href = attachmentUrl(file.attachmentId, file.messageId)
			link.download = file.filename
			link.rel = 'noopener'
			document.body.appendChild(link)
			link.click()
			link.remove()
		}, index * 400)
	})
}

export { formatSize }
