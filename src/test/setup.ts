import '@testing-library/jest-dom';

// Mock Tauri APIs for testing outside of Tauri runtime
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

// Mock IntersectionObserver for lazy loading tests
class MockIntersectionObserver {
  callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    // Immediately trigger as visible
    setTimeout(() => {
      this.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    }, 0);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

(globalThis as Record<string, unknown>).IntersectionObserver = MockIntersectionObserver;
