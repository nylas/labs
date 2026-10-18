// @vitest-environment jsdom
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Browser, chromium, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Held images in a real engine: the placeholder must keep the image's declared
 * box against the element's own rules (the readable layout's `height:auto`,
 * an inline `height:auto` from the sender), and show its alt text.
 */

const componentDirectory = dirname(fileURLToPath(import.meta.url))

type Box = { width: number; height: number; text: string; imageDisplay: string }

async function heldBox(
	page: Page,
	fixtureUrl: string,
	{ width, html, layoutMode }: { width: number; html: string; layoutMode: 'readable' | 'original' },
): Promise<Box> {
	await page.goto(fixtureUrl)
	await page.waitForFunction(() => document.documentElement.dataset.emailElementReady === 'true')
	return page.locator('ownmail-email').evaluate(
		async (host, input) => {
			const element = host as HTMLElement & { emailHtml: string }
			element.style.width = `${input.width}px`
			element.dataset.layoutMode = input.layoutMode
			element.emailHtml = input.html
			const testWindow = window as Window & { installEdgeState: (shadow: ShadowRoot, links: boolean) => void }
			testWindow.installEdgeState(host.shadowRoot as ShadowRoot, false)
			for (let frame = 0; frame < 3; frame += 1) {
				await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
			}
			const placeholder = host.shadowRoot?.querySelector<HTMLElement>('[data-ownmail-held-image]')
			const image = host.shadowRoot?.querySelector<HTMLElement>('img')
			if (!placeholder || !image) throw new Error('No placeholder was put in for the held image')
			const rect = placeholder.getBoundingClientRect()
			return {
				width: rect.width,
				height: rect.height,
				text: placeholder.innerText,
				imageDisplay: getComputedStyle(image).display,
			}
		},
		{ width, html, layoutMode },
	)
}

describe.runIf(existsSync(chromium.executablePath()))('held images in Chromium', () => {
	let server: ViteDevServer | undefined
	let browser: Browser | undefined
	let fixtureUrl = ''

	beforeAll(async () => {
		server = await createServer({
			appType: 'spa',
			configFile: false,
			logLevel: 'silent',
			root: componentDirectory,
			server: { host: '127.0.0.1', port: 0, strictPort: false },
		})
		await server.listen()
		const address = server.httpServer?.address()
		if (!address || typeof address === 'string') throw new Error('Vite fixture server failed to bind')
		fixtureUrl = `http://127.0.0.1:${address.port}/held-images.browser.fixture.html`
		browser = await chromium.launch({ headless: true })
	})

	afterAll(async () => {
		await browser?.close()
		await server?.close()
	})

	for (const layoutMode of ['readable', 'original'] as const) {
		it(`keeps an attribute-sized image at its declared box in the ${layoutMode} layout`, async () => {
			const page = await (browser as Browser).newPage({ viewport: { width: 900, height: 700 } })
			const box = await heldBox(page, fixtureUrl, {
				width: 600,
				html: '<p>Trip</p><img width="400" height="100" alt="Lisbon skyline">',
				layoutMode,
			})
			await page.close()
			expect(box.imageDisplay).toBe('none')
			expect(box.width).toBeCloseTo(400, 0)
			expect(box.height).toBeCloseTo(100, 0)
			expect(box.text).toBe('Lisbon skyline')
		})

		it(`keeps a width-only hero to the pane as a 54px band in the ${layoutMode} layout`, async () => {
			const page = await (browser as Browser).newPage({ viewport: { width: 900, height: 700 } })
			const box = await heldBox(page, fixtureUrl, {
				width: 343,
				html: '<p>News</p><img width="600" alt="The Dispatch" style="width:600px;height:auto">',
				layoutMode,
			})
			await page.close()
			expect(box.width).toBeLessThanOrEqual(343 + 0.5)
			expect(box.height).toBeCloseTo(54, 0)
			expect(box.text).toBe('The Dispatch')
		})
	}

	it('scales a declared box down with the pane, keeping its ratio', async () => {
		const page = await (browser as Browser).newPage({ viewport: { width: 900, height: 700 } })
		const box = await heldBox(page, fixtureUrl, {
			width: 300,
			html: '<p>Trip</p><img width="600" height="200" alt="Banner">',
			layoutMode: 'readable',
		})
		await page.close()
		expect(box.width).toBeCloseTo(300, 0)
		expect(box.height).toBeCloseTo(100, 0)
	})
})
