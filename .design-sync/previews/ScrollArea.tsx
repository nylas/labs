import { ScrollArea } from '@ownmail/app'

const threads: Array<[string, string]> = [
	['Ada Lovelace', 'Re: Analytical Engine notes'],
	['Charles Babbage', 'Difference Engine funding'],
	['Grace Hopper', 'Compiler demo Thursday'],
	['Alan Turing', 'On computable numbers'],
	['Katherine Johnson', 'Trajectory review'],
	['Margaret Hamilton', 'Apollo guidance build'],
	['Dennis Ritchie', 'C draft for review'],
	['Barbara Liskov', 'Substitution principle notes'],
]

// Fixed-height region whose content overflows — the bottom fade gradient
// appears on mount. The overlay scrollbar is hover-gated (not shown statically).
export const MessageList = () => (
	<div style={{ height: 220, width: 320 }} className="overflow-hidden rounded-lg border border-border bg-card">
		<ScrollArea className="h-full" aria-label="Threads">
			<ul className="divide-y divide-border">
				{threads.map(([name, subject]) => (
					<li key={name} className="px-3 py-2">
						<div className="text-sm font-medium text-foreground">{name}</div>
						<div className="text-xs text-muted-foreground">{subject}</div>
					</li>
				))}
			</ul>
		</ScrollArea>
	</div>
)
