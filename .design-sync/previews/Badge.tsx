import { Badge } from '@ownmail/app'

export const Variants = () => (
	<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
		<Badge>New</Badge>
		<Badge variant="secondary">Draft</Badge>
		<Badge variant="outline">Archived</Badge>
		<Badge variant="destructive">Overdue</Badge>
	</div>
)
