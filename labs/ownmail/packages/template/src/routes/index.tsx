import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { devMailboxEmail } from '../server/dev-mocks.js'
import { platform, usingDevMocks } from '../server/platform.js'
import { getSession } from '../server/session.js'

const homeState = createServerFn({ method: 'GET' }).handler(async () => {
	const { env } = await platform()
	if (await usingDevMocks()) {
		return {
			loggedIn: true,
			email: devMailboxEmail(env.INBOX_EMAIL),
			appName: env.APP_NAME,
		}
	}
	const session = await getSession(getRequest())
	return {
		loggedIn: session !== null,
		email: env.INBOX_EMAIL,
		appName: env.APP_NAME,
	}
})

export const Route = createFileRoute('/')({
	loader: () => homeState(),
	component: Home,
})

function Home() {
	const { loggedIn, email, appName } = Route.useLoaderData()
	return (
		<main className="min-h-screen bg-white text-neutral-950">
			<section className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-12">
				<p className="text-sm font-medium uppercase tracking-normal text-neutral-500">{appName}</p>
				<h1 className="mt-4 text-4xl font-semibold tracking-normal text-neutral-950 sm:text-5xl">
					Your mailbox is ready.
				</h1>
				<p className="mt-4 max-w-xl text-base leading-7 text-neutral-600">
					Sign in with your ownmail address to read mail, send messages, and manage your calendar.
				</p>
				<div className="mt-8 flex flex-wrap items-center gap-3">
					<a
						href={loggedIn ? '/mail' : '/auth'}
						className="inline-flex h-11 items-center justify-center rounded-md bg-neutral-950 px-5 text-sm font-medium text-white hover:bg-neutral-800"
					>
						{loggedIn ? 'Open inbox' : 'Sign in'}
					</a>
					{email ? <span className="text-sm text-neutral-500">{email}</span> : null}
				</div>
			</section>
		</main>
	)
}
