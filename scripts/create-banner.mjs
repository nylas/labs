#!/usr/bin/env node
/**
 * Generates repo/lab banner images (SVG) using the nylas.com design system.
 *
 *   node scripts/create-banner.mjs                      # repo banner → assets/banner.svg
 *   node scripts/create-banner.mjs ownmail "Your inbox. Your domain. No per-seat fees."
 *     → labs/ownmail/assets/banner.svg
 *
 * Design tokens mirror nylas.com (agent-accounts-2026.css --aap-* variables):
 * light-first white canvas, black Manrope display type, Inter/JetBrains Mono
 * support text, hairline #d8d8d8 rules, teal #0b9b8a accent, and the
 * signature teal→magenta gradient used sparingly. Pure SVG — no font
 * binaries — so banners render on GitHub in light/dark mode and diff cleanly.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// The real nylas.com typefaces, embedded so GitHub renders them faithfully.
// Latin subsets (scripts/fonts/, ~54KB total) → data URIs; external font
// loads are blocked inside <img> SVGs, data: URIs are not.
function fontFace(family, weight, file) {
	const data = readFileSync(join(root, 'scripts', 'fonts', file)).toString('base64')
	return `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${data}) format('woff2')}`
}
const EMBEDDED_FONTS = [
	fontFace('Manrope', 800, 'manrope-800.woff2'),
	fontFace('Inter', 500, 'inter-500.woff2'),
	fontFace('JetBrains Mono', 400, 'jbmono-400.woff2'),
	fontFace('JetBrains Mono', 700, 'jbmono-700.woff2'),
].join('\n    ')

// nylas.com 2026 tokens
const T = {
	bg: '#ffffff',
	ink: '#000000',
	inkMuted: '#8e8e8e',
	ruleLight: '#d8d8d8',
	cardDark: '#212121',
	codeDark: '#151515',
	textOnDark: '#d8d8d8',
	accent: '#0b9b8a',
	pink: '#e01be0',
	fontHead: `'Manrope', 'Inter', -apple-system, 'Segoe UI', system-ui, sans-serif`,
	fontBody: `'Inter', -apple-system, 'Segoe UI', system-ui, sans-serif`,
	fontMono: `'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace`,
}

const [, , labName, tagline] = process.argv

function esc(value) {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * nylas.com-style layout: white canvas framed by hairlines, heavy black
 * display type left, a dark terminal card right, gradient used once as a
 * thin signature rule.
 */
function banner({ kicker, title, subtitle, command }) {
	const W = 1280
	const H = 400
	const M = 64 // rail margin
	return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(title)} — ${esc(subtitle)}">
  <defs>
    <style>
    ${EMBEDDED_FONTS}
    </style>
    <linearGradient id="signature" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${T.accent}"/>
      <stop offset="1" stop-color="${T.pink}"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="${T.bg}"/>

  <!-- hairline frame, nylas.com rail style -->
  <line x1="${M}" y1="0" x2="${M}" y2="${H}" stroke="${T.ruleLight}"/>
  <line x1="${W - M}" y1="0" x2="${W - M}" y2="${H}" stroke="${T.ruleLight}"/>
  <line x1="0" y1="72" x2="${W}" y2="72" stroke="${T.ruleLight}"/>
  <line x1="0" y1="${H - 56}" x2="${W}" y2="${H - 56}" stroke="${T.ruleLight}"/>

  <!-- kicker row -->
  <g font-family="${T.fontMono}" font-size="15" letter-spacing="3">
    <text x="${M + 32}" y="46" fill="${T.ink}" font-weight="700">NYLAS</text>
    <text x="${M + 104}" y="46" fill="${T.accent}" font-weight="700">/ ${esc(kicker)}</text>
  </g>
  <circle cx="${W - M - 118}" cy="41" r="5" fill="${T.accent}"/>
  <text x="${W - M - 102}" y="46" font-family="${T.fontMono}" font-size="14" fill="${T.inkMuted}">LIVE NOW</text>

  <!-- display type -->
  <text x="${M + 30}" y="192" font-family="${T.fontHead}" font-size="88" font-weight="800" letter-spacing="-3.5" fill="${T.ink}">${esc(title)}</text>
  <rect x="${M + 32}" y="216" width="88" height="6" fill="url(#signature)"/>
  <text x="${M + 32}" y="266" font-family="${T.fontBody}" font-size="27" font-weight="500" fill="${T.inkMuted}">${esc(subtitle)}</text>

  <!-- terminal card, nylas.com dark-card style -->
  <g transform="translate(${W - M - 384}, 116)">
    <rect width="352" height="150" rx="12" fill="${T.cardDark}"/>
    <rect width="352" height="150" rx="12" fill="none" stroke="#404040"/>
    <rect y="0" width="352" height="38" rx="12" fill="${T.codeDark}"/>
    <rect y="26" width="352" height="12" fill="${T.codeDark}"/>
    <circle cx="22" cy="19" r="5" fill="#404040"/>
    <circle cx="40" cy="19" r="5" fill="#404040"/>
    <circle cx="58" cy="19" r="5" fill="#404040"/>
    <g font-family="${T.fontMono}" font-size="17">
      <text x="24" y="76" fill="${T.accent}">$</text>
      <text x="42" y="76" fill="#ffffff">${esc(command)}</text>
      <text x="24" y="112" fill="${T.textOnDark}">▲ deployed. you own it.</text>
    </g>
  </g>

  <!-- footer row -->
  <text x="${M + 32}" y="${H - 22}" font-family="${T.fontMono}" font-size="14" fill="${T.inkMuted}">github.com/nylas/labs</text>
  <text x="${W - M - 32}" y="${H - 22}" text-anchor="end" font-family="${T.fontMono}" font-size="14" fill="${T.inkMuted}">MIT · powered by nylas.com</text>
</svg>
`
}

if (labName) {
	const dir = join(root, 'labs', labName, 'assets')
	mkdirSync(dir, { recursive: true })
	writeFileSync(
		join(dir, 'banner.svg'),
		banner({
			kicker: 'LABS',
			title: labName,
			subtitle: tagline ?? 'An experiment from Nylas Labs',
			command: `npx ${labName}`,
		}),
	)
	console.log(`labs/${labName}/assets/banner.svg`)
} else {
	const dir = join(root, 'assets')
	mkdirSync(dir, { recursive: true })
	writeFileSync(
		join(dir, 'banner.svg'),
		banner({
			kicker: 'LABS',
			title: 'Nylas Labs',
			subtitle: 'Tomorrow’s products, shipped in public.',
			command: 'npx ownmail',
		}),
	)
	console.log('assets/banner.svg')
}
