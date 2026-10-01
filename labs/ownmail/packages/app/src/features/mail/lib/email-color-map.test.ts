import { describe, expect, it } from 'vitest'
import {
	chooseEmailColorStrategy,
	compositeColor,
	contrastRatio,
	DARK_READER_GROUND,
	DEFAULT_EMAIL_CANVAS,
	formatRgb,
	fromOklch,
	MIN_TEXT_CONTRAST,
	parseComputedColor,
	pixelsHaveLightMatte,
	type RgbColor,
	relativeLuminance,
	remapBorderColor,
	remapSurfaceColor,
	remapTextColor,
	sameColor,
	toOklch,
} from './email-color-map.js'

const rgb = (red: number, green: number, blue: number, alpha = 1): RgbColor => ({ red, green, blue, alpha })
const white = rgb(255, 255, 255)

describe('parseComputedColor', () => {
	it('reads legacy and modern rgb syntaxes', () => {
		expect(parseComputedColor('rgb(1, 2, 3)')).toEqual(rgb(1, 2, 3))
		expect(parseComputedColor('rgba(10, 20, 30, 0.5)')).toEqual(rgb(10, 20, 30, 0.5))
		expect(parseComputedColor('rgb(10 20 30 / 40%)')).toEqual(rgb(10, 20, 30, 0.4))
		expect(parseComputedColor('rgb(300, 20, 30, 2)')).toEqual(rgb(255, 20, 30, 1))
	})

	it('reports unknown syntaxes', () => {
		expect(parseComputedColor('oklch(0.5 0.1 120)')).toBeNull()
		expect(parseComputedColor('transparent')).toBeNull()
	})
})

describe('color utilities', () => {
	it('formats, compares, and composites colors', () => {
		expect(formatRgb(rgb(1.4, 2.6, 3))).toBe('rgb(1, 3, 3)')
		expect(sameColor(rgb(10, 10, 10), rgb(12, 12, 13))).toBe(true)
		expect(sameColor(rgb(10, 10, 10), rgb(30, 10, 10))).toBe(false)
		expect(compositeColor(rgb(0, 0, 0, 0.5), white)).toEqual(rgb(127.5, 127.5, 127.5, 1))
		const invisible = rgb(9, 9, 9, 0)
		expect(compositeColor(invisible, rgb(0, 0, 0, 0))).toBe(invisible)
	})

	it('measures WCAG luminance and contrast', () => {
		expect(relativeLuminance(white)).toBeCloseTo(1)
		expect(contrastRatio(white, rgb(0, 0, 0))).toBeCloseTo(21)
		expect(contrastRatio(rgb(0, 0, 0), white)).toBeCloseTo(21)
	})

	it('round-trips sRGB through OKLCH and maps out-of-gamut chroma back into sRGB', () => {
		const brand = rgb(31, 136, 61)
		expect(sameColor(fromOklch(toOklch(brand)), brand)).toBe(true)
		const vivid = fromOklch({ lightness: 0.7, chroma: 0.5, hue: 2 })
		for (const channel of [vivid.red, vivid.green, vivid.blue]) {
			expect(channel).toBeGreaterThanOrEqual(0)
			expect(channel).toBeLessThanOrEqual(255)
		}
		expect(fromOklch({ lightness: 1.3, chroma: 0.001, hue: 0 })).toEqual(white)
	})

	it('matches the app dark ground token and assumes a white authored canvas', () => {
		expect(toOklch(DARK_READER_GROUND).lightness).toBeCloseTo(0.12, 2)
		expect(DEFAULT_EMAIL_CANVAS).toEqual(white)
	})
})

describe('remapSurfaceColor', () => {
	it('lifts light neutral cards onto an elevated dark surface that keeps their ordering', () => {
		const card = remapSurfaceColor(white)
		const header = remapSurfaceColor(rgb(233, 233, 233))
		expect(toOklch(card).lightness).toBeCloseTo(0.185, 2)
		expect(toOklch(header).lightness).toBeGreaterThan(toOklch(card).lightness)
		expect(toOklch(remapSurfaceColor(rgb(160, 160, 160))).lightness).toBeCloseTo(0.3, 2)
	})

	it('keeps dark sections and saturated brand fills exactly', () => {
		const band = rgb(38, 38, 38)
		const button = rgb(31, 136, 61)
		expect(remapSurfaceColor(band)).toBe(band)
		expect(remapSurfaceColor(button)).toBe(button)
	})

	it('turns pale tints into a dark surface with the same hue', () => {
		const tint = rgb(255, 244, 214)
		const mapped = toOklch(remapSurfaceColor(tint))
		expect(mapped.lightness).toBeCloseTo(0.28, 2)
		expect(Math.abs(mapped.hue - toOklch(tint).hue)).toBeLessThan(0.1)
	})
})

describe('remapTextColor', () => {
	const ground = DARK_READER_GROUND

	it('keeps readable authored text when its surface is unchanged', () => {
		const onButton = rgb(255, 255, 255)
		expect(remapTextColor(onButton, rgb(31, 136, 61), rgb(31, 136, 61))).toBe(onButton)
	})

	it('flips neutral body and muted text light while preserving their emphasis', () => {
		const body = remapTextColor(rgb(31, 35, 40), white, ground)
		const muted = remapTextColor(rgb(89, 99, 110), white, ground)
		expect(contrastRatio(body, ground)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
		expect(contrastRatio(muted, ground)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
		expect(toOklch(body).lightness).toBeGreaterThan(toOklch(muted).lightness)
	})

	it('raises colored text only as far as contrast needs and keeps its hue', () => {
		const link = rgb(9, 105, 218)
		const mapped = remapTextColor(link, white, ground)
		expect(contrastRatio(mapped, ground)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
		expect(contrastRatio(mapped, ground)).toBeLessThan(6)
		expect(Math.abs(toOklch(mapped).hue - toOklch(link).hue)).toBeLessThan(0.15)
	})

	it('composites translucent text and darkens text that fails on a light surface', () => {
		const translucent = remapTextColor(rgb(0, 0, 0, 0.6), white, ground)
		expect(contrastRatio(translucent, ground)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
		const paleOnPaper = remapTextColor(rgb(200, 200, 200), white, white)
		expect(contrastRatio(paleOnPaper, white)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
	})
})

describe('remapBorderColor', () => {
	it('maps light hairlines and leaves dark or invisible strokes alone', () => {
		const surface = remapSurfaceColor(white)
		expect(remapBorderColor(rgb(209, 217, 224), surface)).not.toBeNull()
		expect(toOklch(remapBorderColor(rgb(209, 217, 224), surface) as RgbColor).lightness).toBeGreaterThan(
			toOklch(surface).lightness,
		)
		expect(toOklch(remapBorderColor(rgb(170, 220, 255), surface) as RgbColor).lightness).toBeCloseTo(0.45, 2)
		expect(remapBorderColor(rgb(30, 30, 30), surface)).toBeNull()
		expect(remapBorderColor(rgb(255, 255, 255, 0), surface)).toBeNull()
	})
})

describe('chooseEmailColorStrategy', () => {
	const base = {
		theme: 'dark',
		colorMode: 'automatic',
		senderDarkStyles: false,
		lightMatteArtwork: false,
	} as const

	it('chooses the presentation for each theme and message shape', () => {
		expect(chooseEmailColorStrategy({ ...base, theme: 'light' })).toBe('original')
		expect(chooseEmailColorStrategy({ ...base, colorMode: 'original' })).toBe('original')
		expect(chooseEmailColorStrategy({ ...base, senderDarkStyles: true, lightMatteArtwork: true })).toBe(
			'native',
		)
		expect(chooseEmailColorStrategy({ ...base, lightMatteArtwork: true })).toBe('paper')
		expect(chooseEmailColorStrategy(base)).toBe('remap')
	})
})

describe('pixelsHaveLightMatte', () => {
	const sample = (fill: [number, number, number, number], width = 8, height = 6) =>
		Array.from({ length: width * height }, () => fill).flat()

	it('detects an opaque border matching a light canvas', () => {
		expect(pixelsHaveLightMatte(sample([255, 255, 255, 255]), 8, 6, white)).toBe(true)
	})

	it('rejects transparent, tiny, mismatched, and dark-canvas samples', () => {
		expect(pixelsHaveLightMatte(sample([255, 255, 255, 0]), 8, 6, white)).toBe(false)
		expect(pixelsHaveLightMatte(sample([40, 40, 40, 255]), 8, 6, white)).toBe(false)
		expect(pixelsHaveLightMatte(sample([255, 255, 255, 255], 4, 4), 4, 4, white)).toBe(false)
		expect(pixelsHaveLightMatte(sample([20, 20, 20, 255]), 8, 6, rgb(20, 20, 20))).toBe(false)
		expect(pixelsHaveLightMatte([], 8, 6, white)).toBe(false)
	})
})
