#!/usr/bin/env node
/**
 * Generates repo/lab banner images (SVG) in the style of modern OSS repos.
 *
 *   node scripts/create-banner.mjs                      # main repo banner → assets/banner.svg
 *   node scripts/create-banner.mjs ownmail "Your inbox. Your domain. No per-seat fees."
 *     → labs/ownmail/assets/banner.svg
 *
 * Pure SVG (no font binaries, no deps) so banners render identically on
 * GitHub in light and dark mode and diff cleanly in PRs.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const [, , labName, tagline] = process.argv

function esc(value) {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function banner({ kicker, title, subtitle }) {
	const W = 1280
	const H = 400
	return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(title)} — ${esc(subtitle)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="${W}" y2="${H}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#0b0b12"/>
      <stop offset="1" stop-color="#101024"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.82" cy="0.15" r="0.9">
      <stop offset="0" stop-color="#4f46e5" stop-opacity="0.55"/>
      <stop offset="0.45" stop-color="#2563eb" stop-opacity="0.18"/>
      <stop offset="1" stop-color="#0b0b12" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="beam" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#22d3ee"/>
      <stop offset="0.5" stop-color="#818cf8"/>
      <stop offset="1" stop-color="#e879f9"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>

  <!-- grid -->
  <g stroke="#ffffff" stroke-opacity="0.045">
    ${Array.from({ length: 15 }, (_, i) => `<line x1="${(i + 1) * 80}" y1="0" x2="${(i + 1) * 80}" y2="${H}"/>`).join('\n    ')}
    ${Array.from({ length: 4 }, (_, i) => `<line x1="0" y1="${(i + 1) * 80}" x2="${W}" y2="${(i + 1) * 80}"/>`).join('\n    ')}
  </g>

  <!-- flask mark -->
  <g transform="translate(96,96)">
    <path d="M24 0h32v10h-6v28l30 62a14 14 0 0 1-12.6 20H12.6A14 14 0 0 1 0 100l30-62V10h-6V0z"
      fill="none" stroke="url(#beam)" stroke-width="6" stroke-linejoin="round"/>
    <path d="M18 76h44l12 26a6 6 0 0 1-5.4 8H11.4a6 6 0 0 1-5.4-8l12-26z" fill="url(#beam)" fill-opacity="0.85"/>
    <circle cx="34" cy="58" r="5" fill="#22d3ee"/>
    <circle cx="48" cy="44" r="3.5" fill="#818cf8"/>
  </g>

  <text x="220" y="128" font-family="ui-sans-serif, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
    font-size="26" font-weight="600" letter-spacing="10" fill="#8b8ba7">${esc(kicker)}</text>
  <text x="216" y="216" font-family="ui-sans-serif, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
    font-size="84" font-weight="800" letter-spacing="-2" fill="#f4f4f8">${esc(title)}</text>
  <text x="220" y="272" font-family="ui-sans-serif, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
    font-size="30" font-weight="500" fill="#a5a5c0">${esc(subtitle)}</text>

  <rect x="220" y="308" width="560" height="4" rx="2" fill="url(#beam)"/>
  <text x="220" y="356" font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
    font-size="22" fill="#6e6e8f">github.com/nylas/labs</text>
</svg>
`
}

if (labName) {
	const dir = join(root, 'labs', labName, 'assets')
	mkdirSync(dir, { recursive: true })
	writeFileSync(
		join(dir, 'banner.svg'),
		banner({
			kicker: 'NYLAS LABS',
			title: labName,
			subtitle: tagline ?? `An experiment from Nylas Labs`,
		}),
	)
	console.log(`labs/${labName}/assets/banner.svg`)
} else {
	const dir = join(root, 'assets')
	mkdirSync(dir, { recursive: true })
	writeFileSync(
		join(dir, 'banner.svg'),
		banner({
			kicker: 'NYLAS',
			title: 'Labs',
			subtitle: 'Tomorrow’s products, shipped in public.',
		}),
	)
	console.log('assets/banner.svg')
}
