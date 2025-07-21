'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ 
  children,
  defaultTheme = 'system',
  storageKey = 'theme'
}: {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}) {
  const [theme, setTheme] = useState<Theme>(defaultTheme);
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');
  const [mounted, setMounted] = useState(false);

  // Apply theme to document element
  const applyTheme = (theme: 'light' | 'dark') => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    if (theme === 'dark') {
      root.classList.add('dark');
    }
    setResolvedTheme(theme);
  };

  // Apply system theme based on media query
  const applySystemTheme = () => {
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(systemPrefersDark ? 'dark' : 'light');
  };

  // Handle theme changes
  const handleThemeChange = (newTheme: Theme) => {
    setTheme(newTheme);
    localStorage.setItem(storageKey, newTheme);
    
    if (newTheme === 'system') {
      applySystemTheme();
    } else {
      applyTheme(newTheme);
    }
  };

  // Initialize theme on mount
  useEffect(() => {
    setMounted(true);
    
    // Get saved theme from localStorage
    const saved = localStorage.getItem(storageKey) as Theme;
    const initialTheme = saved && ['light', 'dark', 'system'].includes(saved) ? saved : defaultTheme;
    
    setTheme(initialTheme);
    
    if (initialTheme === 'system') {
      applySystemTheme();
      
      // Listen for system theme changes
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleSystemThemeChange = () => {
        if (theme === 'system') {
          applySystemTheme();
        }
      };
      
      mediaQuery.addEventListener('change', handleSystemThemeChange);
      return () => {
        mediaQuery.removeEventListener('change', handleSystemThemeChange);
      };
    } else {
      applyTheme(initialTheme);
    }
  }, [storageKey, defaultTheme]);

  // Listen for system theme changes when theme is 'system'
  useEffect(() => {
    if (!mounted || theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = () => {
      applySystemTheme();
    };

    mediaQuery.addEventListener('change', handleSystemThemeChange);
    return () => {
      mediaQuery.removeEventListener('change', handleSystemThemeChange);
    };
  }, [theme, mounted]);

  // Prevent hydration mismatch
  if (!mounted) {
    return <>{children}</>;
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme: handleThemeChange, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}; 