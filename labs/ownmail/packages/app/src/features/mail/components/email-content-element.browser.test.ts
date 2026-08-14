// @vitest-environment jsdom
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Browser, chromium, type Page } from 'playwright'
import sharp from 'sharp'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sanitizeEmailHtml } from '../lib/sanitize-email.js'

interface ElementMetrics {
	host: { left: number; right: number; width: number; height: number; scrollWidth: number }
	root: { left: number; right: number; width: number; height: number; transform: string }
	probe: { left: number; right: number; width: number; height: number; fontSize: number } | null
	scale: number
}

const componentDirectory = dirname(fileURLToPath(import.meta.url))
const fixturePath = '/email-content-element.browser.fixture.html'

async function settleLayout(page: Page, frames = 3): Promise<void> {
	await page.evaluate(async (frameCount) => {
		for (let frame = 0; frame < frameCount; frame += 1) {
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
		}
	}, frames)
}

async function mountEmail(
	page: Page,
	fixtureUrl: string,
	width: number,
	html: string,
	layoutMode: 'readable' | 'original' = 'readable',
): Promise<void> {
	await page.goto(fixtureUrl)
	await page.waitForFunction(() => document.documentElement.dataset.emailElementReady === 'true')
	await page.locator('ownmail-email').evaluate(
		(host, input) => {
			const element = host as HTMLElement & { emailHtml: string }
			const testWindow = window as Window & { __ownmailLastLayoutStatus?: unknown }
			host.addEventListener('email-layout-status', (event) => {
				testWindow.__ownmailLastLayoutStatus = (event as CustomEvent).detail
			})
			element.style.width = `${input.width}px`
			element.style.margin = '16px'
			element.dataset.layoutMode = input.layoutMode
			element.emailHtml = input.html
		},
		{ width, html, layoutMode },
	)
	await settleLayout(page)
}

async function readMetrics(page: Page, selector = '.probe'): Promise<ElementMetrics> {
	return page.locator('ownmail-email').evaluate((host, probeSelector) => {
		const root = host.shadowRoot?.querySelector<HTMLElement>('.email-root')
		if (!root) throw new Error('Production email root was not mounted')
		const probe = root.querySelector<HTMLElement>(probeSelector)
		const hostRect = host.getBoundingClientRect()
		const rootRect = root.getBoundingClientRect()
		const probeRect = probe?.getBoundingClientRect()
		const transform = getComputedStyle(root).transform
		const matrix = transform === 'none' ? new DOMMatrix() : new DOMMatrix(transform)
		return {
			host: {
				left: hostRect.left,
				right: hostRect.right,
				width: hostRect.width,
				height: hostRect.height,
				scrollWidth: host.scrollWidth,
			},
			root: {
				left: rootRect.left,
				right: rootRect.right,
				width: rootRect.width,
				height: rootRect.height,
				transform,
			},
			probe: probeRect
				? {
						left: probeRect.left,
						right: probeRect.right,
						width: probeRect.width,
						height: probeRect.height,
						fontSize: Number.parseFloat(getComputedStyle(probe).fontSize),
					}
				: null,
			scale: matrix.a,
		}
	}, selector)
}

function expectHorizontallyContained(metrics: ElementMetrics): void {
	expect(metrics.probe).not.toBeNull()
	expect(metrics.probe?.left).toBeGreaterThanOrEqual(metrics.host.left - 0.5)
	expect(metrics.probe?.right).toBeLessThanOrEqual(metrics.host.right + 0.5)
}

function relativeLuminance(red: number, green: number, blue: number): number {
	const channel = (value: number) => {
		const normalized = value / 255
		return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
	}
	return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
}

async function renderedContrast(
	image: Buffer,
): Promise<{ background: number; brightest: number; ratio: number }> {
	const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true })
	const background = relativeLuminance(data[0] ?? 0, data[1] ?? 0, data[2] ?? 0)
	let brightest = 0
	for (let offset = 0; offset < data.length; offset += info.channels) {
		brightest = Math.max(
			brightest,
			relativeLuminance(data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0),
		)
	}
	return { background, brightest, ratio: (brightest + 0.05) / (background + 0.05) }
}

async function firstRenderedPixel(image: Buffer): Promise<[number, number, number]> {
	const { data } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true })
	return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0]
}

describe.runIf(existsSync(chromium.executablePath()))('production email element in Chromium', () => {
	let browser: Browser | undefined
	let server: ViteDevServer | undefined
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
		fixtureUrl = `http://127.0.0.1:${address.port}${fixturePath}`
		browser = await chromium.launch({ headless: true })
	})

	afterAll(async () => {
		await browser?.close()
		await server?.close()
	})

	it('registers the production custom element and contains fixed descendants', async () => {
		if (!browser) throw new Error('Chromium failed to launch')
		const exploit = ':host{position:fixed!important;inset:0!important;z-index:99999!important}'
		const sanitized = sanitizeEmailHtml(
			`<style>${exploit}</style><style>.takeover{position:fixed;inset:0;z-index:99999}</style><div class="takeover probe">Message</div>`,
		)
		expect(sanitized).not.toContain(':host')
		expect(sanitized).toContain('.takeover{position:fixed;inset:0;z-index:99999}')

		const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
		await mountEmail(page, fixtureUrl, 320, sanitized)
		const result = await page.locator('ownmail-email').evaluate((host) => {
			const probe = host.shadowRoot?.querySelector<HTMLElement>('.probe')
			if (!probe) throw new Error('Fixed descendant was not rendered')
			const hostStyle = getComputedStyle(host)
			const hostRect = host.getBoundingClientRect()
			const childRect = probe.getBoundingClientRect()
			return {
				registeredClass: customElements.get('ownmail-email')?.name ?? null,
				position: hostStyle.position,
				inset: hostStyle.inset,
				zIndex: hostStyle.zIndex,
				childContained:
					childRect.left >= hostRect.left &&
					childRect.top >= hostRect.top &&
					childRect.right <= hostRect.right &&
					childRect.bottom <= hostRect.bottom,
			}
		})
		await page.close()

		expect(result).toEqual({
			registeredClass: expect.any(String),
			position: 'static',
			inset: 'auto',
			zIndex: 'auto',
			childContained: true,
		})
	})

	it.each([
		{ viewportWidth: 320, hostWidth: 288 },
		{ viewportWidth: 375, hostWidth: 343 },
		{ viewportWidth: 414, hostWidth: 382 },
		{ viewportWidth: 768, hostWidth: 448 },
	])(
		'contains readable nested legacy tables in a $viewportWidth px viewport',
		async ({ viewportWidth, hostWidth }) => {
			if (!browser) throw new Error('Chromium failed to launch')
			const page = await browser.newPage({ viewport: { width: viewportWidth, height: 800 } })
			await mountEmail(
				page,
				fixtureUrl,
				hostWidth,
				`<table width="600" style="width:600px"><tr><td>
					<table width="800" style="width:800px"><tr><td>
						<table class="probe" width="1200" style="width:1200px"><tr><td class="probe-text" style="font-size:8px">Legacy newsletter</td></tr></table>
					</td></tr></table>
				</td></tr></table>`,
			)
			const metrics = await readMetrics(page, '.probe-text')
			const pageOverflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			)
			const layoutStatus = await page.evaluate(
				() =>
					(window as Window & { __ownmailLastLayoutStatus?: { reflowed?: boolean } })
						.__ownmailLastLayoutStatus,
			)
			await page.close()

			expectHorizontallyContained(metrics)
			expect(metrics.scale).toBe(1)
			expect((metrics.probe?.fontSize ?? 0) * metrics.scale).toBeGreaterThanOrEqual(12)
			expect(metrics.host.width).toBeCloseTo(hostWidth, 0)
			expect(pageOverflow).toBe(0)
			expect(layoutStatus?.reflowed).toBe(true)
		},
	)

	it('keeps fitting when sender CSS declares transform:none!important', async () => {
		if (!browser) throw new Error('Chromium failed to launch')
		const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
		await mountEmail(
			page,
			fixtureUrl,
			320,
			'<style>.email-root{transform:none!important}</style><table class="probe" width="800" style="width:800px"><tr><td>Wide</td></tr></table>',
			'original',
		)
		const metrics = await readMetrics(page)
		await page.close()

		expectHorizontallyContained(metrics)
	})

	it('does not let an offscreen hidden preheader change visible-content fitting', async () => {
		if (!browser) throw new Error('Chromium failed to launch')
		const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
		const visible =
			'<table class="probe" width="600" style="width:600px"><tr><td>Newsletter</td></tr></table>'
		await mountEmail(page, fixtureUrl, 375, visible, 'original')
		const baseline = await readMetrics(page)
		await mountEmail(
			page,
			fixtureUrl,
			375,
			`<div style="position:absolute;left:9999px;width:1px;height:1px;overflow:hidden">Preview text</div>${visible}`,
			'original',
		)
		const withPreheader = await readMetrics(page)
		await page.close()

		expectHorizontallyContained(withPreheader)
		expect(withPreheader.probe?.width).toBeCloseTo(baseline.probe?.width ?? 0, 0)
		expect(withPreheader.scale).toBeCloseTo(baseline.scale, 3)
	})

	it('does not let a clipped zero-height preheader contaminate original fitting', async () => {
		if (!browser) throw new Error('Chromium failed to launch')
		const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
		const visible =
			'<table class="probe" width="600" style="width:600px"><tr><td>Newsletter</td></tr></table>'
		await mountEmail(page, fixtureUrl, 343, visible, 'original')
		const baseline = await readMetrics(page)
		await mountEmail(
			page,
			fixtureUrl,
			343,
			`<div style="max-height:0;overflow:hidden;white-space:nowrap">${'Hidden preview '.repeat(300)}</div>${visible}`,
			'original',
		)
		const withPreheader = await readMetrics(page)
		await page.close()

		expectHorizontallyContained(withPreheader)
		expect(withPreheader.scale).toBeCloseTo(baseline.scale, 3)
		expect(withPreheader.host.height).toBeCloseTo(baseline.host.height, 0)
	})

	it('wraps sender nowrap content before it becomes unreadably small', async () => {
		if (!browser) throw new Error('Chromium failed to launch')
		const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
		await mountEmail(
			page,
			fixtureUrl,
			320,
			`<div class="probe" style="font-size:16px;line-height:20px;white-space:nowrap">${'A long legacy subject '.repeat(24)}</div>`,
		)
		const metrics = await readMetrics(page)
		await page.close()

		expectHorizontallyContained(metrics)
		expect((metrics.probe?.fontSize ?? 0) * metrics.scale).toBeGreaterThanOrEqual(12)
		expect(metrics.probe?.height).toBeGreaterThanOrEqual(20)
	})

	it('neutralizes non-table minimum widths and raises text to the readable floor', async () => {
		if (!browser) throw new Error('Chromium failed to launch')
		const page = await browser.newPage({ viewport: { width: 375, height: 700 } })
		await mountEmail(
			page,
			fixtureUrl,
			343,
			'<style>#wide{min-width:1200px!important;font-size:8px!important}</style><div id="wide" class="probe">Readable body text</div>',
		)
		const metrics = await readMetrics(page)
		await page.close()

		expectHorizontallyContained(metrics)
		expect(metrics.scale).toBe(1)
		expect(metrics.probe?.fontSize).toBeGreaterThanOrEqual(12)
	})

	it('normalizes archaic font and center elements without clipping', async () => {
		if (!browser) throw new Error('Chromium failed to launch')
		const page = await browser.newPage({ viewport: { width: 375, height: 700 } })
		await mountEmail(
			page,
			fixtureUrl,
			343,
			'<center class="probe" style="min-width:1200px!important"><font class="legacy-font" style="font-size:8px!important">Archaic centered copy</font></center>',
		)
		const metrics = await readMetrics(page)
		const fontSize = await page.locator('ownmail-email').evaluate((host) => {
			const font = host.shadowRoot?.querySelector<HTMLElement>('.legacy-font')
			return font ? Number.parseFloat(getComputedStyle(font).fontSize) : 0
		})
		await page.close()

		expectHorizontallyContained(metrics)
		expect(metrics.scale).toBe(1)
		expect(fontSize).toBeGreaterThanOrEqual(12)
	})

	it('fits RTL legacy content from its logical inline start', async () => {
		if (!browser) throw new Error('Chromium failed to launch')
		const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
		await mountEmail(
			page,
			fixtureUrl,
			375,
			'<html dir="rtl"><body dir="rtl"><table class="probe" width="800" style="width:800px"><tr><td>رسالة بريد إلكتروني</td></tr></table></body></html>',
			'original',
		)
		const metrics = await readMetrics(page)
		const direction = await page.locator('ownmail-email').evaluate((host) => ({
			mode: host.shadowRoot?.querySelector('.email-root')?.getAttribute('data-ownmail-direction'),
			left: (host.shadowRoot?.querySelector('.email-root') as HTMLElement | null)?.style.left,
		}))
		await page.close()

		expectHorizontallyContained(metrics)
		expect(direction.mode).toBe('rtl')
		expect(direction.left).toMatch(/^-/)
		const leftInset = (metrics.probe?.left ?? 0) - metrics.host.left
		const rightInset = metrics.host.right - (metrics.probe?.right ?? 0)
		expect(rightInset).toBeLessThanOrEqual(leftInset + 1)
	})

	it('evaluates sender width media queries against the reading pane', async () => {
		if (!browser) throw new Error('Chromium failed to launch')
		const page = await browser.newPage({ viewport: { width: 1_200, height: 700 } })
		await mountEmail(
			page,
			fixtureUrl,
			320,
			'<style>.desktop{display:block}.mobile{display:none}@media screen and (max-width:600px), only screen and (max-device-width:40rem){.desktop{display:none}.mobile{display:block}}</style><div class="desktop">Desktop</div><div class="mobile probe">Mobile</div>',
		)
		const state = await page.locator('ownmail-email').evaluate((host) => {
			const root = host.shadowRoot
			const mobile = root?.querySelector<HTMLElement>('.mobile')
			const desktop = root?.querySelector<HTMLElement>('.desktop')
			return {
				mobile: mobile ? getComputedStyle(mobile).display : null,
				desktop: desktop ? getComputedStyle(desktop).display : null,
				css: root?.querySelector('style')?.textContent ?? '',
			}
		})
		await page.close()

		expect(state.mobile).toBe('block')
		expect(state.desktop).toBe('none')
		expect(state.css).toContain('@container ownmail-email (max-width:600px)')
		expect(state.css).toContain('@container ownmail-email (max-width:40rem)')
	})

	it('evaluates adaptive sender colors from the app theme instead of the OS theme', async () => {
		if (!browser) throw new Error('Chromium failed to launch')
		const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
		const html = `<style>
			.probe{background-color:rgb(245,245,245);color:rgb(20,20,20)}
			@media (prefers-color-scheme:dark){.probe{background-color:rgb(10,20,30);color:rgb(240,240,240)}}
			@media (prefers-color-scheme:light){.probe{background-color:rgb(245,245,245);color:rgb(20,20,20)}}
		</style><div class="probe">Adaptive message</div>`
		for (const testCase of [
			{ app: 'light', os: 'light', background: 'rgb(245, 245, 245)' },
			{ app: 'light', os: 'dark', background: 'rgb(245, 245, 245)' },
			{ app: 'dark', os: 'light', background: 'rgb(10, 20, 30)' },
			{ app: 'dark', os: 'dark', background: 'rgb(10, 20, 30)' },
		] as const) {
			await page.emulateMedia({ colorScheme: testCase.os })
			await mountEmail(page, fixtureUrl, 375, html)
			const state = await page.locator('ownmail-email').evaluate((host, appTheme) => {
				host.setAttribute('data-email-theme', appTheme)
				const probe = host.shadowRoot?.querySelector<HTMLElement>('.probe')
				const providerStyle = host.shadowRoot?.querySelector('.email-root style')?.textContent ?? ''
				return {
					background: probe ? getComputedStyle(probe).backgroundColor : null,
					rootBackground: host.shadowRoot?.querySelector('.email-root')
						? getComputedStyle(host.shadowRoot.querySelector('.email-root') as Element).backgroundColor
						: null,
					providerStyle,
				}
			}, testCase.app)
			expect(state.background, `${testCase.app} app / ${testCase.os} OS`).toBe(testCase.background)
			expect(state.rootBackground).toBe('rgba(0, 0, 0, 0)')
			expect(state.providerStyle).toContain('style(--ownmail-email-theme: dark)')
			expect(state.providerStyle).not.toContain('prefers-color-scheme')
		}
		await page.close()
	})

	it('preserves media and CSS-background fidelity with a transparent accessible dark canvas', async () => {
		if (!browser) throw new Error('Chromium failed to launch')
		const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
		const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
		const redBackground =
			'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%221%22%20height%3D%221%22%3E%3Crect%20width%3D%221%22%20height%3D%221%22%20fill%3D%22%23ff0000%22%2F%3E%3C%2Fsvg%3E'
		await mountEmail(
			page,
			fixtureUrl,
			375,
			`<a class="focus-link" style="--ownmail-link-color:#111!important;color:#111!important;outline:none!important;box-shadow:none!important" href="https://example.com">Read more</a>
			<img class="photo" src="${pixel}" alt="Photo"><picture><source srcset="${pixel}"><img class="picture-img" src="${pixel}" alt="Picture"></picture>
			<svg class="logo" width="20" height="20"><rect width="20" height="20" fill="#123456"/></svg><canvas class="art" width="20" height="20"></canvas>
			<div class="background" style="background-image:url('${redBackground}');width:80px;height:40px">Background copy</div>`,
		)
		const state = await page.locator('ownmail-email').evaluate((host) => {
			host.setAttribute('data-email-theme', 'dark')
			host.setAttribute('data-dark-invert', '')
			const root = host.shadowRoot?.querySelector<HTMLElement>('.email-root')
			const link = root?.querySelector<HTMLAnchorElement>('.focus-link')
			link?.focus()
			const background = root?.querySelector<HTMLElement>('.background')
			const media = ['.photo', '.picture-img', '.logo', '.art'].map((selector) => {
				const element = root?.querySelector<HTMLElement>(selector)
				const style = element ? getComputedStyle(element) : null
				return { filter: style?.filter ?? null, background: style?.backgroundColor ?? null }
			})
			const linkStyle = link ? getComputedStyle(link) : null
			return {
				rootBackground: root ? getComputedStyle(root).backgroundColor : null,
				media,
				backgroundMarked: background?.hasAttribute('data-ownmail-background-media') ?? false,
				backgroundImage: background ? getComputedStyle(background).backgroundImage : null,
				backgroundLayerImage: background ? getComputedStyle(background, '::before').backgroundImage : null,
				backgroundLayerFilter: background ? getComputedStyle(background, '::before').filter : null,
				linkOutline: linkStyle?.outlineStyle ?? null,
				linkOutlineWidth: linkStyle?.outlineWidth ?? null,
				linkFocusRing: linkStyle?.boxShadow ?? null,
				linkColor: linkStyle?.color ?? null,
			}
		})
		const backgroundPixel = await firstRenderedPixel(
			await page.locator('ownmail-email .background').screenshot(),
		)
		await page.close()

		expect(state.rootBackground).toBe('rgb(255, 255, 255)')
		for (const media of state.media) {
			expect(media.filter).not.toBe('none')
			expect(media.background).toBe('rgb(255, 255, 255)')
		}
		expect(state.backgroundMarked).toBe(true)
		expect(state.backgroundImage).toBe('none')
		expect(state.backgroundLayerImage).not.toBe('none')
		expect(state.backgroundLayerFilter).not.toBe('none')
		expect(backgroundPixel[0]).toBeGreaterThan(150)
		expect(backgroundPixel[0]).toBeGreaterThan(backgroundPixel[1] * 2)
		expect(backgroundPixel[0]).toBeGreaterThan(backgroundPixel[2] * 2)
		expect(backgroundPixel[1]).toBeLessThan(80)
		expect(backgroundPixel[2]).toBeLessThan(80)
		expect(state.linkOutline).not.toBe('none')
		expect(state.linkOutlineWidth).toBe('2px')
		expect(state.linkFocusRing).not.toBe('none')
		expect(state.linkColor).not.toBe('rgb(17, 17, 17)')
	})

	it('renders non-adaptive plain text with dark-mode pixel contrast', async () => {
		if (!browser) throw new Error('Chromium failed to launch')
		const page = await browser.newPage({ viewport: { width: 500, height: 300 } })
		await mountEmail(
			page,
			fixtureUrl,
			320,
			'<p class="probe" style="font-size:32px;line-height:40px;margin:0">MMMM</p>',
		)
		await page.locator('ownmail-email').evaluate((host) => {
			document.body.style.background = 'rgb(17,24,39)'
			host.setAttribute('data-email-theme', 'dark')
			host.setAttribute('data-dark-invert', '')
		})
		await settleLayout(page)
		const contrast = await renderedContrast(await page.locator('ownmail-email').screenshot())
		await page.close()

		expect(contrast.background).toBeLessThan(0.03)
		expect(contrast.brightest).toBeGreaterThan(0.6)
		expect(contrast.ratio).toBeGreaterThanOrEqual(4.5)
	})

	it('makes no remote image request before opt-in and loads after consent', async () => {
		if (!browser) throw new Error('Chromium failed to launch')
		const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
		let requests = 0
		await page.route('https://images.example.test/**', async (route) => {
			requests += 1
			await route.fulfill({
				contentType: 'image/gif',
				body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'),
			})
		})
		await mountEmail(
			page,
			fixtureUrl,
			375,
			'<img class="remote probe" src="https://images.example.test/tracker.gif" width="600" height="240">',
		)
		const blocked = await page.locator('ownmail-email').evaluate((host) => {
			const image = host.shadowRoot?.querySelector<HTMLImageElement>('.remote')
			return {
				src: image?.getAttribute('src') ?? null,
				widthAttribute: image?.getAttribute('width'),
				heightAttribute: image?.getAttribute('height'),
				width: image?.width,
				height: image?.height,
			}
		})
		expect(requests).toBe(0)
		expect(blocked.src).toBeNull()
		expect(blocked.widthAttribute).toBe('600')
		expect(blocked.heightAttribute).toBe('240')
		expect((blocked.width ?? 0) / (blocked.height ?? 1)).toBeCloseTo(2.5, 1)

		const request = page.waitForRequest('https://images.example.test/tracker.gif')
		await page.locator('ownmail-email').evaluate((host) => host.setAttribute('data-load-remote-images', ''))
		await request
		await settleLayout(page)
		const loadedSrc = await page
			.locator('ownmail-email')
			.evaluate(
				(host) => host.shadowRoot?.querySelector<HTMLImageElement>('.remote')?.getAttribute('src') ?? null,
			)
		await page.close()

		expect(requests).toBe(1)
		expect(loadedSrc).toBe('https://images.example.test/tracker.gif')
	})

	it('remeasures after late intrinsic media creates new overflow', async () => {
		if (!browser) throw new Error('Chromium failed to launch')
		const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
		await mountEmail(
			page,
			fixtureUrl,
			375,
			'<style>.probe{max-width:none!important}</style><img class="probe" alt="Late media" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" width="100" height="40">',
			'original',
		)
		const before = await readMetrics(page)
		await page.locator('ownmail-email').evaluate((host) => {
			const image = host.shadowRoot?.querySelector<HTMLElement>('.probe')
			if (!image) throw new Error('Late media probe was not rendered')
			const testWindow = window as Window & { __ownmailLayoutStatuses?: number }
			testWindow.__ownmailLayoutStatuses = 0
			host.addEventListener('email-layout-status', () => {
				testWindow.__ownmailLayoutStatuses = (testWindow.__ownmailLayoutStatuses ?? 0) + 1
			})
			image.style.width = '900px'
			image.dispatchEvent(new Event('load'))
		})
		await settleLayout(page, 5)
		const after = await readMetrics(page)
		const layoutStatuses = await page.evaluate(
			() => (window as Window & { __ownmailLayoutStatuses?: number }).__ownmailLayoutStatuses ?? 0,
		)
		await page.close()

		expect(layoutStatuses, JSON.stringify({ before, after })).toBeGreaterThan(0)
		expectHorizontallyContained(after)
		expect(after.scale < before.scale || (after.probe?.width ?? 0) > (before.probe?.width ?? 0)).toBe(true)
		expect(after.host.height).toBeGreaterThan(0)
	})
})
