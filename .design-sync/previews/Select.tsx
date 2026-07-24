import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ownmail/app'

// The closed trigger shows the selected item's text (statically renderable).
// Opening the dropdown is interaction-driven and not shown in a static card.
export const Default = () => (
	<div style={{ maxWidth: 240 }}>
		<Select defaultValue="inbox">
			<SelectTrigger>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="inbox">Inbox</SelectItem>
				<SelectItem value="starred">Starred</SelectItem>
				<SelectItem value="sent">Sent</SelectItem>
				<SelectItem value="archive">Archive</SelectItem>
			</SelectContent>
		</Select>
	</div>
)
