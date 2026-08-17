/* Hallmark · component: mobile tab bar · genre: modern-minimal · theme: Quiet
 * states: default · hover · focus · active · disabled · loading · error · success
 * contrast: pass (46–50) · pre-emit critique: P5 H5 E5 S5 R5 V5
 */
import { Link } from '@tanstack/react-router'
import { Calendar, Mail, Settings, Users } from 'lucide-react'
import { cn } from '#shared/lib/utils'
import {
	CALENDAR_HOME_PATH,
	CONTACTS_HOME_PATH,
	MAIL_HOME_PATH,
	SETTINGS_PATH,
} from '../config/route-paths.js'

export type MobileTab = 'mail' | 'calendar' | 'contacts' | 'settings'

const TABS = [
	{ id: 'mail', label: 'Mail', to: MAIL_HOME_PATH, icon: Mail },
	{ id: 'calendar', label: 'Calendar', to: CALENDAR_HOME_PATH, icon: Calendar },
	{ id: 'contacts', label: 'Contacts', to: CONTACTS_HOME_PATH, icon: Users },
	{ id: 'settings', label: 'Settings', to: SETTINGS_PATH, icon: Settings },
] as const

export function MobileTabBar({ active }: { active: MobileTab }) {
	return (
		<nav aria-label="Primary mobile" className="mobile-tab-bar md:hidden">
			{TABS.map((tab) => {
				const Icon = tab.icon
				const selected = tab.id === active
				return (
					<Link
						key={tab.id}
						to={tab.to}
						aria-current={selected ? 'page' : undefined}
						className={cn('mobile-tab', selected && 'mobile-tab-active')}
					>
						<span className="mobile-tab-icon" aria-hidden="true">
							<Icon className="h-5 w-5" strokeWidth={selected ? 2.25 : 1.75} />
						</span>
						<span className="mobile-tab-label">{tab.label}</span>
					</Link>
				)
			})}
		</nav>
	)
}
