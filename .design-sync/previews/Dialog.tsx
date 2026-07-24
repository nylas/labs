import { Button, Dialog, DialogContent, DialogTitle } from '@ownmail/app'

// Controlled `open` with no onOpenChange => stays open for a static preview.
export const Confirmation = () => (
	<Dialog open>
		<DialogContent className="p-6">
			<DialogTitle className="font-display text-lg font-semibold text-foreground">Discard this draft?</DialogTitle>
			<p className="mt-2 text-sm text-muted-foreground">
				Your message to ada@ownmail.com hasn’t been sent yet. Discarding removes it permanently.
			</p>
			<div className="mt-6 flex justify-end gap-2">
				<Button variant="outline">Keep editing</Button>
				<Button variant="destructive">Discard</Button>
			</div>
		</DialogContent>
	</Dialog>
)
