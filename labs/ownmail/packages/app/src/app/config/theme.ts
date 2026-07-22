export const THEME_STORAGE_KEY = 'theme'
export const ROOT_BACKGROUND_CLASS = 'bg-background'

export function initialThemeIsDark(savedTheme: string | null): boolean {
	return savedTheme === 'dark'
}

export function themeClassName(isDark: boolean): 'dark' | 'light' {
	return isDark ? 'dark' : 'light'
}

export function rootThemeClassNames(isDark: boolean): string[] {
	return [ROOT_BACKGROUND_CLASS, themeClassName(isDark)]
}

export function themeToggleLabel(mounted: boolean, isDark: boolean): string {
	if (!mounted) return 'Toggle theme'
	return isDark ? 'Switch to light mode' : 'Switch to dark mode'
}

export const INITIAL_ROOT_CLASS_NAME = rootThemeClassNames(false).join(' ')
