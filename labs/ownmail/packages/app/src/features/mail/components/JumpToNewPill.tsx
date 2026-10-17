import { ArrowDown } from 'lucide-react'
import { GLASS_PANEL_CLASS } from '#shared/components/ui/glass'

/**
 * The phone reader's "2 more new" pill (board 03). It floats over the
 * conversation, so it is panel glass, 20px clear of the reply bar (at least
 * 76px tall, see `MobileReplyBar`). The button is the 36px pill itself, so its
 * focus outline follows the pill; a transparent layer 4px past each edge keeps
 * the 44px touch target. The pill overrides the panel's 12px corner, and
 * focus is an outline because the panel recipe owns `box-shadow`.
 */
export function JumpToNewPill({ count, onJump }: { count: number; onJump: () => void }) {
	if (count <= 0) return null
	return (
		<button
			type="button"
			data-slot="jump-to-new"
			onClick={onJump}
			className={`${GLASS_PANEL_CLASS} [--glass-radius:9999px] fixed bottom-[calc(max(4.75rem,var(--mobile-tab-bar-height)+1px+var(--safe-area-bottom))+1.25rem)] left-1/2 z-30 inline-flex h-9 -translate-x-1/2 items-center jump-pill text-[13px] font-semibold whitespace-nowrap text-foreground transition-[scale] duration-[var(--dur-press)] ease-[var(--ease-press)] after:absolute after:-inset-1 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-ring active:scale-[0.97] md:hidden`}
		>
			<ArrowDown className="size-4 text-cta-icon" aria-hidden="true" />
			{count} more new
		</button>
	)
}
