import { Button, Tooltip, TooltipContent, TooltipTrigger } from '@ownmail/app'

// `defaultOpen` renders the tooltip surface for a static preview. Top padding
// leaves room for the content, which opens above the trigger by default.
export const OnButton = () => (
	<div style={{ paddingTop: 52, display: 'flex', justifyContent: 'center' }}>
		<Tooltip defaultOpen>
			<TooltipTrigger asChild>
				<Button variant="outline" size="icon" aria-label="Star thread">
					★
				</Button>
			</TooltipTrigger>
			<TooltipContent>Star this thread</TooltipContent>
		</Tooltip>
	</div>
)
