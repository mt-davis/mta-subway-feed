'use client';

/**
 * Theme store — light / dark / system preference, persisted to localStorage.
 *
 * Designed for `useSyncExternalStore`: a single subscribe + getSnapshot pair
 * that any component can read without prop-drilling. We sync three things:
 *
 *   1. The user's explicit preference (localStorage key `theme`).
 *   2. The system `prefers-color-scheme` change events (matters when no
 *      explicit pref is set).
 *   3. Cross-tab `storage` events so toggling in one tab updates siblings.
 *
 * The actual `<html class="dark">` toggle is handled in two places: an inline
 * <script> in app/layout.tsx for the very first paint (avoids FOUC), and
 * `setThemePreference` here for runtime toggles.
 */

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'theme';
const listeners = new Set<() => void>();
let mq: MediaQueryList | null = null;
let initialized = false;

// We cache the snapshot so useSyncExternalStore doesn't see a fresh
// reference on every read. It's a primitive ('light' | 'dark') so equality
// is structural, but recomputing on every render still wastes work.
let cachedResolved: ResolvedTheme = 'dark';

function readStoredPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    // localStorage can throw in private mode / sandboxed iframes.
  }
  return 'system';
}

function readSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark';
  if (!mq) mq = window.matchMedia('(prefers-color-scheme: dark)');
  return mq.matches ? 'dark' : 'light';
}

function recomputeResolved(): ResolvedTheme {
  const pref = readStoredPreference();
  return pref === 'system' ? readSystemTheme() : pref;
}

function applyClass(theme: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

function notify() {
  for (const fn of listeners) fn();
}

function ensureInitialized() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  cachedResolved = recomputeResolved();

  if (!mq) mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', () => {
    // Only react to OS-level changes when the user hasn't pinned a preference.
    if (readStoredPreference() !== 'system') return;
    const next = recomputeResolved();
    if (next === cachedResolved) return;
    cachedResolved = next;
    applyClass(next);
    notify();
  });

  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    const next = recomputeResolved();
    if (next === cachedResolved) return;
    cachedResolved = next;
    applyClass(next);
    notify();
  });
}

export function getThemePreference(): ThemePreference {
  return readStoredPreference();
}

export function getResolvedTheme(): ResolvedTheme {
  ensureInitialized();
  return cachedResolved;
}

/**
 * SSR snapshot for useSyncExternalStore. We assume `dark` because that's
 * what the inline FOUC script defaults to when no preference is stored.
 * Components that depend on this should be prepared for one client-side
 * re-render after hydration if the user actually prefers light.
 */
export function getResolvedThemeServerSnapshot(): ResolvedTheme {
  return 'dark';
}

export function setThemePreference(pref: ThemePreference) {
  try {
    if (pref === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // ignore — toggle still works for the duration of the session
  }
  const next = recomputeResolved();
  cachedResolved = next;
  applyClass(next);
  notify();
}

export function subscribeToTheme(onChange: () => void): () => void {
  ensureInitialized();
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}
