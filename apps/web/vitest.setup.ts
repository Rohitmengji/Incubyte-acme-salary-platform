import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { navigation, resetNavigation } from './src/tests/navigation-mock';

vi.mock('next/navigation', () => navigation);

// Recharts' ResponsiveContainer and Radix measure elements; jsdom has no layout engine.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
const elementStubs = {
  scrollIntoView: () => {},
  hasPointerCapture: () => false,
  releasePointerCapture: () => {},
};
for (const [name, value] of Object.entries(elementStubs)) {
  if (!(name in Element.prototype))
    Object.defineProperty(Element.prototype, name, { value, configurable: true });
}

afterEach(() => {
  cleanup();
  resetNavigation();
  vi.unstubAllGlobals();
});
