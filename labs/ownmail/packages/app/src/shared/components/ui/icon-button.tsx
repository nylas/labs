import type * as React from 'react'
import { Button } from './button.js'

/** An icon-only action: a required accessible name and the shared 44px touch target. */
export function IconButton({
	label,
	...props
}: Omit<React.ComponentProps<typeof Button>, 'aria-label' | 'size' | 'asChild'> & { label: string }) {
	return <Button type="button" variant="ghost" size="icon" aria-label={label} title={label} {...props} />
}
