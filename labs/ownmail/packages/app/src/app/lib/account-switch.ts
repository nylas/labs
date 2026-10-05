import { type QueryClient, useIsMutating, useQueryClient } from '@tanstack/react-query'
import { type AnyRouter, useRouter, useRouterState } from '@tanstack/react-router'
import { type FormEvent, useCallback } from 'react'
import { isCalView } from '#features/calendar/lib/calendar'
import { resetCalendarConfirmedEffects } from '#features/calendar/state/calendar-state'
import { resetContactConfirmedEffects } from '#features/contacts/state/contacts-state'
import { resetMailOptimisticJournal } from '#features/mail/state/mail-mutations'
import {
	AUTH_PATH,
	CALENDAR_HOME_PATH,
	CONTACTS_HOME_PATH,
	MAIL_HOME_PATH,
	SETTINGS_PATH,
} from '../config/route-paths.js'
import { mailboxInfoQueryOptions } from '../query/mailbox-info.js'
import { resetAccountScope, setAccountScope } from './account-scope.js'
import { readSwitchingTo, setSwitchingTo, useAccountSwitchStatus } from './account-switch-status.js'

export type AccountSwitchTarget = { email: string; handle: string; active: boolean }

export const ACCOUNT_SWITCH_BLOCKED_MESSAGE = 'Finish saving your changes before switching inboxes.'

export const documentNavigation = {
	/* v8 ignore next 3 -- jsdom cannot perform document navigations; callers spy on this seam -- @preserve */
	assign(url: string) {
		window.location.assign(url)
	},
}

/** Keeps people in the section they were using; entity pages from the previous
 * inbox (threads, contacts, dated calendar views) do not exist in the next one. */
export function accountSwitchDestination(pathname: string): string {
	const calendarView = /^\/calendar\/([^/]+)/.exec(pathname)?.[1]
	if (calendarView && isCalView(calendarView)) return `${CALENDAR_HOME_PATH}/${calendarView}`
	if (/^\/calendar(?:\/|$)/.test(pathname)) return CALENDAR_HOME_PATH
	if (/^\/contacts(?:\/|$)/.test(pathname)) return CONTACTS_HOME_PATH
	if (/^\/settings(?:\/|$)/.test(pathname)) return SETTINGS_PATH
	return MAIL_HOME_PATH
}

/** Rotates the session cookie through the same hardened endpoint as the form. */
export async function requestAccountSwitch(handle: string): Promise<boolean> {
	try {
		const response = await fetch(AUTH_PATH, {
			method: 'POST',
			credentials: 'same-origin',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({ account: handle }).toString(),
		})
		return response.status === 204
	} catch {
		return false
	}
}

/** Posts the switch as a document navigation so the browser shows the server's
 * own response. A detached form carries only the chosen handle, independent of
 * a controlled select that React may already have reset. */
export function submitAccountSwitchNatively(handle: string): void {
	const form = document.createElement('form')
	form.method = 'post'
	form.action = AUTH_PATH
	form.hidden = true
	const input = document.createElement('input')
	input.type = 'hidden'
	input.name = 'account'
	input.value = handle
	form.appendChild(input)
	document.body.appendChild(form)
	form.submit()
}

/** Removes every client-side trace of the previous inbox, including optimistic
 * journals and confirmed-effect replays that live beside the query cache.
 * Query keys are partitioned by account, so this is defence in depth: the next
 * inbox could not read these entries even if they stayed. */
export async function clearAccountScopedState(queryClient: QueryClient): Promise<void> {
	await queryClient.cancelQueries()
	resetMailOptimisticJournal(queryClient)
	resetCalendarConfirmedEffects(queryClient)
	resetContactConfirmedEffects(queryClient)
	queryClient.clear()
	// The next mailbox response names the account the tab now belongs to.
	resetAccountScope()
}

/**
 * Loads the inbox the session now points at, in the section the person was
 * using. The caller has already announced the switch (`setSwitchingTo`), so
 * the app is unmounted while this runs. Shared by the in-app switcher and by
 * the reset that follows a session change made in another tab.
 */
export async function loadSwitchedAccount(
	queryClient: QueryClient,
	router: Pick<AnyRouter, 'navigate' | 'invalidate' | 'clearCache'>,
	pathname: string,
): Promise<void> {
	const destination = accountSwitchDestination(pathname)
	try {
		// Router loader data has its own cache, independent of TanStack Query.
		// Retire preloads and inactive matches before they can seed another account.
		router.clearCache()
		await clearAccountScopedState(queryClient)
		await router.navigate({ to: destination, replace: true })
		// Default invalidation is stale-while-revalidate: awaiting it alone can
		// unmount the switch loader while the committed matches still contain A.
		// Force a blocking reload before allowing any account content to remount.
		await router.invalidate({ sync: true, forcePending: true })
	} catch {
		// The session already points at the next inbox; a document load is the
		// only way left to guarantee nothing from the previous one renders.
		documentNavigation.assign(destination)
		return
	}
	// A mailbox request started before the session rotated may have answered
	// in between. The cache was cleared after it was cancelled, so what the
	// cache holds now is the next inbox: that, not arrival order, is the scope.
	setAccountScope(queryClient.getQueryData(mailboxInfoQueryOptions().queryKey)?.email)
	setSwitchingTo(null)
}

export function useAccountSwitch(accounts: readonly AccountSwitchTarget[]) {
	const queryClient = useQueryClient()
	const router = useRouter()
	const pathname = useRouterState({ select: (state) => state.location.pathname })
	// A pending optimistic write keeps a base snapshot of this inbox; switching
	// mid-flight could replay it into, or lose it from, the next inbox.
	const blocked = useIsMutating() > 0
	const switching = useAccountSwitchStatus()

	const onSubmit = useCallback(
		async (event: FormEvent<HTMLFormElement>) => {
			event.preventDefault()
			const handle = new FormData(event.currentTarget).get('account')
			const target = accounts.find((account) => account.handle === handle)
			// The rendered `blocked` value can trail a write started in this same tick.
			if (!target || target.active || queryClient.isMutating() > 0 || readSwitchingTo() !== null) return
			// From here the write lock rejects every tracked write (including a
			// pending compose autosave timer) until the next inbox has loaded.
			setSwitchingTo(target.email)
			if (!(await requestAccountSwitch(target.handle))) {
				submitAccountSwitchNatively(target.handle)
				return
			}
			await loadSwitchedAccount(queryClient, router, pathname)
		},
		[accounts, pathname, queryClient, router],
	)

	return { blocked, switching, onSubmit }
}
