import { Input } from '@ownmail/app'

export const Default = () => (
	<div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 320 }}>
		<Input placeholder="ada@ownmail.com" />
		<Input type="password" defaultValue="correct-horse" />
		<Input placeholder="Read-only" disabled />
	</div>
)
