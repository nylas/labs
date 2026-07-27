// @vitest-environment jsdom
import { type Browser, chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { shadowStyleText } from '../lib/email-render.js'
import { sanitizeEmailHtml } from '../lib/sanitize-email.js'

describe('email CSS boundary in Chromium', () => {
	let browser: Browser

	beforeAll(async () => {
		browser = await chromium.launch({ headless: true })
	})

	afterAll(async () => {
		await browser.close()
	})

	it('removes host takeover CSS and contains fixed descendants inside the email surface', async () => {
		const exploit = ':host{position:fixed!important;inset:0!important;z-index:99999!important}'
		const sanitized = sanitizeEmailHtml(
			`<style>${exploit}</style><style>.takeover{position:fixed;inset:0;z-index:99999}</style><div class="takeover">Message</div>`,
		)
		expect(sanitized).not.toContain(':host')
		expect(sanitized).toContain('.takeover{position:fixed;inset:0;z-index:99999}')

		const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
		await page.setContent('<ownmail-email style="display:block;width:320px;margin:80px"></ownmail-email>')
		const result = await page.locator('ownmail-email').evaluate(
			(host, input) => {
				const shadow = host.attachShadow({ mode: 'open' })
				const root = document.createElement('div')
				root.className = 'email-root'
				root.innerHTML = input.sanitized
				shadow.append(root)
				const ownmailStyle = document.createElement('style')
				ownmailStyle.textContent = input.ownmailCss
				shadow.append(ownmailStyle)

				const hostStyle = getComputedStyle(host)
				const hostRect = host.getBoundingClientRect()
				const childRect = (root.querySelector('.takeover') as HTMLElement).getBoundingClientRect()
				return {
					position: hostStyle.position,
					inset: hostStyle.inset,
					zIndex: hostStyle.zIndex,
					childContained:
						childRect.left >= hostRect.left &&
						childRect.top >= hostRect.top &&
						childRect.right <= hostRect.right &&
						childRect.bottom <= hostRect.bottom,
				}
			},
			{ sanitized, ownmailCss: shadowStyleText() },
		)
		await page.close()

		expect(result).toEqual({ position: 'static', inset: 'auto', zIndex: 'auto', childContained: true })
	})
})
