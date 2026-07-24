import { Button } from '@ownmail/app'

export const Variants = () => (
	<div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
		<Button>Send email</Button>
		<Button variant="secondary">Save draft</Button>
		<Button variant="outline">Cancel</Button>
		<Button variant="destructive">Delete</Button>
		<Button variant="ghost">Archive</Button>
		<Button variant="link">Learn more</Button>
	</div>
)

export const Sizes = () => (
	<div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
		<Button size="sm">Small</Button>
		<Button size="default">Default</Button>
		<Button size="lg">Large</Button>
	</div>
)

export const Disabled = () => <Button disabled>Sending…</Button>
