import type { CSSProperties } from 'react'
import { initials } from '#shared/lib/presentation'
import { cn } from '#shared/lib/utils'
import { type Person, personHue } from '../lib/thread-reading-model.js'

type AvatarSize = 18 | 20 | 24 | 28 | 32 | 40

/**
 * Box and initials size per avatar size: 32 in open message headers, 28 in
 * one-line rows, 24 in the thread header, 20 in folded stacks, 18 in
 * recipient chips and 40 on the sender card.
 */
const SIZE_CLASS: Record<AvatarSize, string> = {
	18: 'size-[18px] text-[8px]',
	20: 'size-5 text-[9px]',
	24: 'size-6 text-[10px]',
	28: 'size-7 text-[11px]',
	32: 'size-8 text-xs',
	40: 'size-10 text-sm',
}

/** The tint pairs in `tokens.css`, written out so Tailwind sees every class. */
const HUE_CLASS: Record<ReturnType<typeof personHue>, string> = {
	75: 'bg-avatar-75 text-avatar-75-foreground',
	250: 'bg-avatar-250 text-avatar-250-foreground',
	32: 'bg-avatar-32 text-avatar-32-foreground',
	158: 'bg-avatar-158 text-avatar-158-foreground',
	300: 'bg-avatar-300 text-avatar-300-foreground',
	200: 'bg-avatar-200 text-avatar-200-foreground',
}

/** How far each avatar in a stack tucks under the one before it: the stack's own geometry, like a primitive's. */
const STACK_OVERLAP: Record<20 | 24, number> = { 20: -5, 24: -6 }

/** The owner always wears the green pair; everyone else the hue their address hashes to. */
export function avatarHue(person: Person): ReturnType<typeof personHue> {
	return person.isOwner ? 158 : personHue(person.email)
}

/** "AT" for Alan Turing; a nameless address takes the first two letters of its local part ("PM" for pm-leads@). */
export function avatarInitials(person: Pick<Person, 'name' | 'email'>): string {
	if (person.name.trim()) return initials(person.name.trim())
	const local = person.email.split('@')[0] as string
	return (local.match(/[\p{L}\p{N}]/gu) ?? []).slice(0, 2).join('').toUpperCase() || '?'
}

/**
 * A person's initials on their tint, round. Decorative: the name always
 * appears beside it, so it is hidden from assistive technology.
 */
export function Avatar({
	person,
	size,
	ring = false,
	className,
	style,
}: {
	person: Person
	size: AvatarSize
	ring?: boolean
	className?: string
	style?: CSSProperties
}) {
	const hue = avatarHue(person)
	return (
		<span
			data-slot="avatar"
			data-hue={hue}
			aria-hidden="true"
			style={style}
			className={cn(
				'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold leading-none',
				SIZE_CLASS[size],
				HUE_CLASS[hue],
				ring && 'ring-2 ring-background',
				className,
			)}
		>
			{avatarInitials(person)}
		</span>
	)
}

/**
 * Overlapping avatars for a group: the thread header (24px, 6px overlap) and
 * folded runs (20px, 5px overlap), each ringed in the page colour.
 */
export function AvatarStack({ people, size, max = 4 }: { people: Person[]; size: 20 | 24; max?: number }) {
	const shown = people.slice(0, Math.max(1, max))
	return (
		<span data-slot="avatar-stack" aria-hidden="true" className="inline-flex shrink-0">
			{shown.map((person, index) => (
				<Avatar
					key={person.email || `${person.name}-${index}`}
					person={person}
					size={size}
					ring
					style={index > 0 ? { marginInlineStart: STACK_OVERLAP[size] } : undefined}
				/>
			))}
		</span>
	)
}
