/* Hallmark · component: mobile app navigation · genre: modern-minimal · theme: Quiet
 * states: default · hover · focus · pressed · current
 * contrast: pass (46–50) · pre-emit critique: P5 H5 E5 S5 R5 V5
 */
import { Link } from '@tanstack/react-router'
import { Calendar, Mail, Settings, Users } from 'lucide-react'
import type { ComponentType } from 'react'
import { cn } from '#shared/lib/utils'
import {
	CALENDAR_HOME_PATH,
	CONTACTS_HOME_PATH,
	MAIL_HOME_PATH,
	SETTINGS_PATH,
} from '../config/route-paths.js'

export type MobileAppDestination = 'mail' | 'calendar' | 'contacts' | 'settings'

const DESTINATIONS: Array<{
	id: MobileAppDestination
	label: string
	to: string
	icon: ComponentType<{ className?: string; strokeWidth?: number }>
}> = [
	{ id: 'mail', label: 'Mail', to: MAIL_HOME_PATH, icon: Mail },
	{ id: 'calendar', label: 'Calendar', to: CALENDAR_HOME_PATH, icon: Calendar },
	{ id: 'contacts', label: 'Contacts', to: CONTACTS_HOME_PATH, icon: Users },
	{ id: 'settings', label: 'Settings', to: SETTINGS_PATH, icon: Settings },
]

/** Persistent one-handed navigation for app destinations on narrow viewports. */
export function MobileAppNav({ active }: { active: MobileAppDestination }) {
	return (
		<nav aria-label="Primary mobile" className="mobile-app-nav md:hidden">
			{DESTINATIONS.map((destination) => {
				const isActive = destination.id === active
				const Icon = destination.icon
				return (
					<Link
						key={destination.id}
						to={destination.to}
						aria-current={isActive ? 'page' : undefined}
						className={cn('mobile-app-nav-item', isActive && 'mobile-app-nav-item-active')}
					>
						<Icon className="h-5 w-5" strokeWidth={isActive ? 2.25 : 1.75} />
						<span>{destination.label}</span>
					</Link>
				)
			})}
		</nav>
	)
}
