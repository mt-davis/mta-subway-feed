'use client';

import { useSyncExternalStore } from 'react';
import {
  getResolvedTheme,
  getResolvedThemeServerSnapshot,
  setThemePreference,
  subscribeToTheme,
} from '@/lib/theme';

/**
 * Sun / moon toggle that flips between light and dark.
 *
 * Single-press cycles the explicit preference (light ⇄ dark). The system
 * option lives in lib/theme.ts and is the implicit default the very first
 * time the app loads — once the user clicks this button we pin them to
 * an explicit choice, which is what most map apps do (Google Maps,
 * Citymapper) because it's the least surprising behavior.
 */
export default function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribeToTheme,
    getResolvedTheme,
    getResolvedThemeServerSnapshot,
  );

  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={() => setThemePreference(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="
        inline-flex items-center justify-center
        w-8 h-8 rounded-lg
        text-gray-600 hover:text-gray-900
        hover:bg-gray-100
        dark:text-gray-300 dark:hover:text-white
        dark:hover:bg-gray-800
        transition-colors
        focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
      "
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}
