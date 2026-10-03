import { useQueryClient } from '@tanstack/react-query'
import {
	createContext,
	lazy,
	type ReactNode,
	Suspense,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react'
import { draftQueryOptions } from '#features/mail/state/mail-queries'
import { getDraft } from '#server/fns'
import { useToast } from '#shared/components/Toaster'
import type { ComposeSeed, ComposeWindowHandle } from './ComposeWindow.js'

// The composer (and the sanitizer it shares with the reader) stays out of the
// startup bundle. It is fetched once the page is idle; after that, pressing C
// renders the loaded component synchronously. Only a composer opened before the
// fetch settles goes through `lazy` and waits for it.
type ComposeWindowComponent = typeof import('./ComposeWindow.js').ComposeWindow
let loadedComposeWindow: ComposeWindowComponent | null = null
export function loadComposeWindow(): Promise<ComposeWindowComponent> {
	return import('./ComposeWindow.js').then((module) => {
		loadedComposeWindow = module.ComposeWindow
		return module.ComposeWindow
	})
}
const LazyComposeWindow = lazy(() => loadComposeWindow().then((component) => ({ default: component })))

function whenIdle(callback: () => void): () => void {
	if (typeof window.requestIdleCallback === 'function') {
		const handle = window.requestIdleCallback(callback, { timeout: 4000 })
		return () => window.cancelIdleCallback(handle)
	}
	const handle = window.setTimeout(callback, 1500)
	return () => window.clearTimeout(handle)
}

/** What opens a composer: a saved draft by id, or the fields of a new message, reply or forward. */
export type ComposeRequest = Exclude<ComposeSeed, { kind: 'draft' }> | { kind: 'draft'; draftId: string }

type ComposeContextValue = {
	/** Opens the composer over the current page. An open composer is closed (and its draft saved) first. */
	openCompose: (request: ComposeRequest) => Promise<void>
	/** The reply being written, so its thread can make room for it; null when nothing is being composed. */
	composing: { kind: ComposeSeed['kind']; threadId?: string } | null
	/** A thread offers the place under its last message where its reply is written. */
	registerInlineSlot: (threadId: string, slot: HTMLElement | null) => void
}

const ComposeContext = createContext<ComposeContextValue>({
	openCompose: async () => {},
	composing: null,
	registerInlineSlot: () => {},
})

export function useCompose(): ComposeContextValue {
	return useContext(ComposeContext)
}

type OpenComposer = {
	id: number
	seed: ComposeSeed
	returnFocus: HTMLElement | null
	/** Fixed when the composer opens, so the load settling never remounts it and drops its draft. */
	Window: ComposeWindowComponent | typeof LazyComposeWindow
}

/**
 * Compose is app state, not a page (design.md "Reading"): one composer floats
 * over whatever is on screen, in any module, and a reply sits in its thread when
 * that thread is open. It lives under the account's tree, so switching inbox
 * unmounts it rather than carrying a draft across.
 */
export function ComposeProvider({ children }: { children: ReactNode }) {
	const queryClient = useQueryClient()
	const { showToast } = useToast()
	const [open, setOpen] = useState<OpenComposer | null>(null)
	const openRef = useRef<OpenComposer | null>(null)
	openRef.current = open
	const [slots, setSlots] = useState<Record<string, HTMLElement>>({})
	const windowHandle = useRef<ComposeWindowHandle>(null)
	const nextId = useRef(0)

	useEffect(
		() =>
			whenIdle(() => {
				void loadComposeWindow().catch(
					/* v8 ignore next -- @preserve a failed warm-up is retried by the lazy component when compose opens */
					() => {},
				)
			}),
		[],
	)

	const finish = useCallback(
		(message?: string) => {
			const returnFocus = openRef.current?.returnFocus
			openRef.current = null
			setOpen(null)
			if (message) showToast({ message })
			// Focus goes back to whatever opened the composer, if it is still on screen.
			if (returnFocus?.isConnected) returnFocus.focus()
		},
		[showToast],
	)

	const openCompose = useCallback(
		async (request: ComposeRequest) => {
			const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
			if (openRef.current) {
				await windowHandle.current?.close()
				// The open draft could not be saved: keep it, and its error, on screen.
				if (openRef.current) return
			}
			let seed: ComposeSeed
			if (request.kind === 'draft') {
				try {
					const draft = await queryClient.fetchQuery(
						draftQueryOptions(request.draftId, (draftId) => getDraft({ data: { draftId } })),
					)
					seed = { kind: 'draft', draft }
				} catch {
					showToast({ message: 'Could not open the draft. Try again from Drafts.' })
					return
				}
			} else seed = request
			nextId.current += 1
			setOpen({ id: nextId.current, seed, returnFocus, Window: loadedComposeWindow ?? LazyComposeWindow })
		},
		[queryClient, showToast],
	)

	const registerInlineSlot = useCallback((threadId: string, slot: HTMLElement | null) => {
		setSlots((current) => {
			if (slot) return current[threadId] === slot ? current : { ...current, [threadId]: slot }
			if (!(threadId in current)) return current
			const { [threadId]: _removed, ...rest } = current
			return rest
		})
	}, [])

	const threadId = open && open.seed.kind !== 'draft' ? open.seed.threadId : undefined
	const composing = useMemo(
		() => (open ? { kind: open.seed.kind, ...(threadId ? { threadId } : {}) } : null),
		[open, threadId],
	)
	const value = useMemo(
		() => ({ openCompose, composing, registerInlineSlot }),
		[openCompose, composing, registerInlineSlot],
	)
	// A reply is written in its thread when that thread is on screen; otherwise it floats.
	const inlineSlot = open?.seed.kind === 'reply' && threadId ? (slots[threadId] ?? null) : null

	return (
		<ComposeContext value={value}>
			{children}
			{open ? (
				<Suspense fallback={null}>
					<open.Window
						key={open.id}
						seed={open.seed}
						inlineSlot={inlineSlot}
						handleRef={windowHandle}
						onClosed={() => finish()}
						onSent={() => finish('Sent')}
					/>
				</Suspense>
			) : null}
		</ComposeContext>
	)
}
