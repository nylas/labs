/// <reference types="vite/client" />
import { createRootRoute, HeadContent, Link, Outlet, Scripts } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { Compass } from 'lucide-react'
import { appMeta, DARK_THEME_COLOR, LIGHT_THEME_COLOR } from '../app/config/app-meta.js'
import { MAIL_HOME_PATH } from '../app/config/route-paths.js'
import { INITIAL_ROOT_CLASS_NAME } from '../app/config/theme.js'
import { OwnmailQueryProvider } from '../app/query/query-provider.js'
import { platform } from '../server/platform.js'
import { DEFAULT_SITE_NAME, siteNameFromEnv } from '../server/site-config.js'
import appCss from '../styles.css?url'

const rootState = createServerFn({ method: 'GET' }).handler(async () => {
	const { env } = await platform()
	return { siteName: siteNameFromEnv(env) }
})

export const Route = createRootRoute({
	loader: async () => rootState(),
	head: (context) => {
		const siteName = context?.loaderData?.siteName ?? DEFAULT_SITE_NAME
		const { title, description } = appMeta(siteName)
		return {
			meta: [
				{ charSet: 'utf-8' },
				{ name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
				{ name: 'description', content: description },
				{ name: 'color-scheme', content: 'light dark' },
				{ name: 'mobile-web-app-capable', content: 'yes' },
				{ name: 'apple-mobile-web-app-capable', content: 'yes' },
				{ name: 'apple-mobile-web-app-title', content: siteName },
				{ name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
				{ title },
			],
			links: [
				{ rel: 'stylesheet', href: appCss },
				{ rel: 'manifest', href: '/manifest.webmanifest' },
				{ rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
			],
		}
	},
	component: RootComponent,
	errorComponent: AppError,
	notFoundComponent: NotFoundComponent,
})

function AppError() {
	return (
		<div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center">
			<div>
				<p className="font-display text-sm font-semibold text-foreground">We couldn’t load this page.</p>
				<p className="mt-1 text-sm text-muted-foreground">
					Check your connection and try again. If it persists, sign in again.
				</p>
			</div>
			<div className="flex gap-3">
				<button
					type="button"
					onClick={() => window.location.reload()}
					className="rounded-lg border border-border px-4 py-2 text-sm font-medium"
				>
					Retry
				</button>
				<Link to="/login" className="rounded-lg border border-border px-4 py-2 text-sm font-medium">
					Sign in
				</Link>
			</div>
		</div>
	)
}

function NotFoundComponent() {
	return (
		<div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-6 text-center">
			<div className="flex h-14 w-14 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-sm">
				<Compass className="h-6 w-6" />
			</div>
			<div>
				<p className="font-display text-sm font-semibold text-foreground">Page not found</p>
				<p className="mt-1 text-sm text-muted-foreground">
					The page you’re looking for doesn’t exist or has moved.
				</p>
			</div>
			<Link
				to={MAIL_HOME_PATH}
				className="mt-1 flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
			>
				Back to mail
			</Link>
		</div>
	)
}

function RootComponent() {
	return (
		<html lang="en" className={INITIAL_ROOT_CLASS_NAME} suppressHydrationWarning>
			<head>
				<HeadContent />
				<meta name="theme-color" media="(prefers-color-scheme: light)" content={LIGHT_THEME_COLOR} />
				<meta name="theme-color" media="(prefers-color-scheme: dark)" content={DARK_THEME_COLOR} />
				<script
					// biome-ignore lint/security/noDangerouslySetInnerHtml: inline theme bootstrap avoids flash
					dangerouslySetInnerHTML={{
						__html: `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'){document.documentElement.classList.remove('light');document.documentElement.classList.add('dark')}}catch(e){}})()`,
					}}
				/>
			</head>
			<body suppressHydrationWarning>
				<OwnmailQueryProvider>
					<Outlet />
				</OwnmailQueryProvider>
				<Scripts />
			</body>
		</html>
	)
}
