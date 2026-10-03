import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react'
import { GLASS_PANEL_CLASS } from '#shared/components/ui/glass'
import { cn } from '#shared/lib/utils'

/** A short confirmation that something left the screen, with an optional way to put it back. */
export type Toast = {
	message: string
	action?: { label: string; onAction: () => void }
}

type ToastContextValue = { showToast: (toast: Toast) => void }

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} })

/** How long a toast stays: long enough to reach its action, short when there is nothing to do. */
export const TOAST_DURATION_MS = 2200
export const TOAST_WITH_ACTION_DURATION_MS = 5000
/** The exit runs on `--dur-fast`; the toast unmounts once it has faded. */
export const TOAST_EXIT_MS = 120

export function useToast(): ToastContextValue {
	return useContext(ToastContext)
}

/**
 * One toast at a time at the bottom centre, above the mobile tab bar. It is
 * panel glass (it floats over content) and announced politely. A newer toast
 * replaces the current one, so an Undo always belongs to the last action.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
	const [current, setCurrent] = useState<(Toast & { id: number }) | null>(null)
	const [leaving, setLeaving] = useState(false)
	const nextId = useRef(0)
	const timers = useRef<ReturnType<typeof setTimeout>[]>([])

	const clearTimers = useCallback(() => {
		for (const timer of timers.current) clearTimeout(timer)
		timers.current = []
	}, [])

	const dismiss = useCallback(() => {
		clearTimers()
		setLeaving(true)
		timers.current.push(
			setTimeout(() => {
				setCurrent(null)
				setLeaving(false)
			}, TOAST_EXIT_MS),
		)
	}, [clearTimers])

	const showToast = useCallback(
		(toast: Toast) => {
			clearTimers()
			nextId.current += 1
			setLeaving(false)
			setCurrent({ ...toast, id: nextId.current })
			timers.current.push(
				setTimeout(dismiss, toast.action ? TOAST_WITH_ACTION_DURATION_MS : TOAST_DURATION_MS),
			)
		},
		[clearTimers, dismiss],
	)

	useEffect(() => clearTimers, [clearTimers])

	const value = useMemo(() => ({ showToast }), [showToast])

	return (
		<ToastContext value={value}>
			{children}
			<div className="toast-region" role="status" aria-live="polite" aria-atomic="true">
				{current ? (
					<ToastView key={current.id} toast={current} leaving={leaving} onDismiss={dismiss} />
				) : null}
			</div>
		</ToastContext>
	)
}

function ToastView({ toast, leaving, onDismiss }: { toast: Toast; leaving: boolean; onDismiss: () => void }) {
	const action = toast.action
	return (
		<div
			data-leaving={leaving ? 'true' : undefined}
			className={cn(GLASS_PANEL_CLASS, 'toast flex items-center gap-hairline text-sm font-medium')}
		>
			<span>{toast.message}</span>
			{action ? (
				<button
					type="button"
					className="press touch-target rounded-md px-cluster py-1 font-semibold text-cta-icon outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring"
					onClick={() => {
						action.onAction()
						onDismiss()
					}}
				>
					{action.label}
				</button>
			) : null}
		</div>
	)
}
