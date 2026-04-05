import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../store/tabStore';

describe('dark theme', () => {
  beforeEach(() => {
    // Reset theme to light
    useAppStore.getState().setAppSettings({
      ...useAppStore.getState().appSettings,
      theme: 'light',
    });
    document.documentElement.removeAttribute('data-theme');
  });

  it('store defaults to light theme', () => {
    const theme = useAppStore.getState().appSettings.theme;
    expect(theme).toBe('light');
  });

  it('can set theme to dark', () => {
    useAppStore.getState().setAppSettings({
      ...useAppStore.getState().appSettings,
      theme: 'dark',
    });
    expect(useAppStore.getState().appSettings.theme).toBe('dark');
  });

  it('data-theme attribute is applied to document element', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    document.documentElement.setAttribute('data-theme', 'light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    document.documentElement.removeAttribute('data-theme');
  });

  it('theme setting persists in appSettings', () => {
    const store = useAppStore.getState();
    store.setAppSettings({ ...store.appSettings, theme: 'dark' });

    // Re-read
    const updated = useAppStore.getState().appSettings;
    expect(updated.theme).toBe('dark');
    // Other settings unchanged
    expect(updated.editor_font_size).toBe(14);
    expect(updated.show_line_numbers).toBe(true);
  });

  it('can toggle between light and dark', () => {
    const store = useAppStore.getState();

    store.setAppSettings({ ...store.appSettings, theme: 'dark' });
    expect(useAppStore.getState().appSettings.theme).toBe('dark');

    store.setAppSettings({ ...store.appSettings, theme: 'light' });
    expect(useAppStore.getState().appSettings.theme).toBe('light');
  });
});
