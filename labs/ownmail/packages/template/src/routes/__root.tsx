/// <reference types="vite/client" />
import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import { APP_DESCRIPTION, APP_TITLE, DARK_THEME_COLOR, LIGHT_THEME_COLOR } from '../components/app-meta.js'
import { INITIAL_ROOT_CLASS_NAME } from '../components/theme.js'
import appCss from '../styles.css?url'

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: 'utf-8' },
			{ name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
			{ name: 'description', content: APP_DESCRIPTION },
			{ name: 'color-scheme', content: 'light dark' },
			{ name: 'apple-mobile-web-app-capable', content: 'yes' },
			{ name: 'apple-mobile-web-app-title', content: 'OwnMail' },
			{ name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
			{ title: APP_TITLE },
		],
		links: [
			{ rel: 'stylesheet', href: appCss },
			{ rel: 'manifest', href: '/manifest.webmanifest' },
			{ rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
		],
	}),
	component: RootComponent,
})

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
				<Outlet />
				<Scripts />
			</body>
		</html>
	)
}
