import { initials } from '#shared/lib/presentation'
import { cn } from '#shared/lib/utils'

export function ContactAvatar({ name, className }: { name: string; className?: string }) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				'flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground',
				className,
			)}
		>
			{initials(name)}
		</span>
	)
}
