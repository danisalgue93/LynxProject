import { expect, vi } from 'vitest';
// @testing-library/jest-dom v6 dropped the default export from /matchers; it now
// only exposes named exports. `import matchers from …` therefore resolved to
// undefined and expect.extend(undefined) threw "Cannot convert undefined or null
// to object" while loading this setup file — which made all three frontend test
// files fail to load, so the suite reported "no tests" and had never run.
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

// jsdom does not implement window.matchMedia — stub it so components that read
// media queries don't throw during test rendering.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Silence expected console.error noise from React / mocked hooks in tests.
vi.spyOn(console, 'error').mockImplementation(() => {});
