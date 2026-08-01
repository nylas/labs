import { useEffect, useState } from 'react'
import { applyThemeClass, initialThemeIsDark, subscribeToTheme, THEME_STORAGE_KEY } from '../config/theme.js'

export function useThemeToggleState(): { isDark: boolean; mounted: boolean } {
	const [isDark, setIsDark] = useState(false)
	const [mounted, setMounted] = useState(false)

	useEffect(() => {
		const nextDark = initialThemeIsDark(localStorage.getItem(THEME_STORAGE_KEY))
		applyThemeClass(nextDark)
		setIsDark(nextDark)
		setMounted(true)
		return subscribeToTheme(setIsDark)
	}, [])

	return { isDark, mounted }
}
