/* Appearance preference only. Load synchronously in <head>, before styles. */
(function (root, createTheme) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = createTheme;
  else if (root.document && !root.PFTheme) root.PFTheme = createTheme(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function createTheme(w) {
  'use strict';
  const KEY = 'pf_theme';
  const MODES = ['light', 'dark', 'system'];
  const d = w.document;
  const root = d.documentElement;
  const listeners = new Set();
  let media = null, listening = false;
  try { media = w.matchMedia('(prefers-color-scheme: dark)'); } catch (_) {}

  // Keep the existing gold CSS namespace and storage value. Old dark/neon
  // preferences migrate without forcing the owner's choice back to light.
  function storedMode(value) {
    if (value === 'gold' || value === 'dark' || value === 'neon') return 'dark';
    return value === 'system' ? 'system' : 'light';
  }
  function read() {
    try { return w.localStorage.getItem(KEY); } catch (_) { return null; }
  }
  function save(mode) {
    try { w.localStorage.setItem(KEY, mode === 'dark' ? 'gold' : mode); } catch (_) {}
  }
  const saved = read();
  let mode = storedMode(saved), theme = null;
  function state() { return {preference: mode, resolved: theme}; }
  function resolve() {
    return mode === 'dark' || (mode === 'system' && media && media.matches) ? 'gold' : 'light';
  }
  function systemChanged() { if (mode === 'system') apply(false); }
  function listenToSystem() {
    const wanted = mode === 'system';
    if (!media || wanted === listening) return;
    try {
      if (typeof media.addEventListener === 'function' && typeof media.removeEventListener === 'function') {
        media[wanted ? 'addEventListener' : 'removeEventListener']('change', systemChanged);
      } else if (typeof media.addListener === 'function' && typeof media.removeListener === 'function') {
        media[wanted ? 'addListener' : 'removeListener'](systemChanged);
      } else return;
      listening = wanted;
    } catch (_) {}
  }
  function chrome() {
    // Native controls follow the resolved theme. Keep ticker/status-bar chrome
    // authoritative once the existing themeColor() helper is available.
    root.style.colorScheme = theme === 'gold' ? 'dark' : 'light';
    const meta = d.querySelector('meta[name="theme-color"]');
    if (meta) {
      let color = theme === 'gold' ? '#101923' : '#f7f6f2';
      try { if (typeof w.themeColor === 'function') color = w.themeColor(theme); } catch (_) {}
      meta.setAttribute('content', color);
    }
  }
  function repaintCharts() {
    try { if (typeof w.applyChartTheme === 'function') w.applyChartTheme(); } catch (_) {}
    // Both existing account heatmaps use theme-dependent colors. This changes
    // their appearance only; it does not reload the app or switch accounts.
    if (typeof w.renderHeatmap === 'function') {
      for (const suffix of ['', '-ag']) {
        try { w.renderHeatmap(suffix); } catch (_) {}
      }
    }
  }
  function emit() {
    for (const fn of [...listeners]) {
      try { fn(state()); } catch (_) {}
    }
    try { d.dispatchEvent(new w.CustomEvent('pf:theme', {detail: state()})); } catch (_) {}
  }
  function apply(preferenceChanged) {
    const next = resolve(), changed = theme !== next;
    theme = next;
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-theme-preference', mode);
    chrome();
    listenToSystem();
    if (changed) repaintCharts();
    if (changed || preferenceChanged) emit();
    return state();
  }
  function set(next) {
    if (!MODES.includes(next)) return state();
    const changed = mode !== next;
    mode = next;
    save(mode);
    return apply(changed);
  }
  function storageChanged(event) {
    if (!event || (event.key !== KEY && event.key !== null)) return;
    // Ignore sessionStorage and unrelated Storage objects when identifiable.
    try { if (event.storageArea && event.storageArea !== w.localStorage) return; } catch (_) {}
    const next = storedMode(event.key === null ? null : event.newValue);
    const changed = mode !== next;
    mode = next;
    apply(changed); // Never echo a storage event back into storage.
  }
  if (typeof w.addEventListener === 'function') w.addEventListener('storage', storageChanged);
  if (saved === 'dark' || saved === 'neon') save(mode);
  apply(false);
  if (typeof d.addEventListener === 'function') d.addEventListener('DOMContentLoaded', chrome, {once: true});

  return {
    preference: () => mode,
    resolved: () => theme,
    set,
    cycle: () => set(MODES[(MODES.indexOf(mode) + 1) % MODES.length]),
    // Subscribe immediately receives current state. The return value removes
    // the listener, allowing controls in replaced views to clean up properly.
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      try { fn(state()); } catch (_) {}
      return () => listeners.delete(fn);
    }
  };
});
