import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import sharp from 'sharp'
import { createServer } from 'vite'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const screenshotsDir = resolve(packageRoot, '../../assets/screenshots')
const baseUrl = 'http://127.0.0.1:5173'
const viewport = { width: 1440, height: 900 }
const scale = 2
const width = viewport.width * scale
const height = viewport.height * scale

async function serverIsRunning() {
	try {
		const response = await fetch(`${baseUrl}/mail`)
		return response.ok || response.status === 307
	} catch {
		return false
	}
}

async function withDevUi() {
	if (await serverIsRunning()) return null
	Object.assign(process.env, {
		OWNMAIL_DEV_MOCKS: '1',
		SESSION_SECRET: 'ownmail-dev-session-secret-change-me',
		NYLAS_API_KEY: 'dev',
		NYLAS_CLIENT_ID: 'dev',
		NYLAS_REGION: 'us',
		APP_NAME: 'ownmail-dev',
		INBOX_EMAIL: 'ada@ownmail.com',
		TEMPLATE_VERSION: '0.1.2',
	})
	const server = await createServer({
		root: packageRoot,
		configFile: resolve(packageRoot, 'vite.config.local.ts'),
		server: { host: '127.0.0.1' },
	})
	await server.listen()
	return server
}

async function navigateTo(page, path) {
	await page.goto(path, { waitUntil: 'networkidle' })
	await page.waitForTimeout(150)
}

function darkOverlay(darkPng) {
	const encoded = darkPng.toString('base64')
	const topX = Math.round(width * 0.38)
	const bottomX = Math.round(width * 0.62)
	return Buffer.from(`
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="dark-side"><polygon points="${topX},0 ${width},0 ${width},${height} ${bottomX},${height}" /></clipPath>
  </defs>
  <image width="${width}" height="${height}" href="data:image/png;base64,${encoded}" clip-path="url(#dark-side)" />
</svg>`)
}

await mkdir(screenshotsDir, { recursive: true })
const server = await withDevUi()
const browser = await chromium.launch({ headless: true })

try {
	const lightContext = await browser.newContext({
		viewport,
		deviceScaleFactor: scale,
		colorScheme: 'light',
	})
	const darkContext = await browser.newContext({
		viewport,
		deviceScaleFactor: scale,
		colorScheme: 'dark',
	})
	await lightContext.addInitScript(() => localStorage.setItem('theme', 'light'))
	await darkContext.addInitScript(() => localStorage.setItem('theme', 'dark'))

	const lightPage = await lightContext.newPage()
	await lightPage.goto(`${baseUrl}/mail`, { waitUntil: 'networkidle' })
	await lightPage.getByText('The Dispatch', { exact: true }).first().click()
	const lightMail = await lightPage.screenshot()

	const darkPage = await darkContext.newPage()
	await darkPage.goto(`${baseUrl}/mail`, { waitUntil: 'networkidle' })
	await darkPage.getByText('The Dispatch', { exact: true }).first().click()
	const darkMail = await darkPage.screenshot()

	await sharp(lightMail)
		.composite([{ input: darkOverlay(darkMail) }])
		.png()
		.toFile(resolve(screenshotsDir, 'ownmail-mail-modes.png'))

	await navigateTo(lightPage, `${baseUrl}/calendar`)
	await lightPage.screenshot({ path: resolve(screenshotsDir, 'ownmail-calendar.png') })
	await lightPage.goto(`${baseUrl}/contacts`, { waitUntil: 'networkidle' })
	await lightPage.waitForTimeout(150)
	await lightPage.screenshot({ path: resolve(screenshotsDir, 'ownmail-contacts.png') })

	await lightContext.close()
	await darkContext.close()
} finally {
	await browser.close()
	if (server) {
		await server.close()
	}
}
