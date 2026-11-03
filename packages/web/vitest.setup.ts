import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

// jsdom has no layout, so the few browser features the components lean on are stubbed.
if (typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string) => {
    return { matches: false, media: query, addEventListener: () => {
      return undefined;
    }, removeEventListener: () => {
      return undefined;
    } } as unknown as MediaQueryList;
  };
}

class NoopObserver {
  observe(): void {
    return undefined;
  }

  unobserve(): void {
    return undefined;
  }

  disconnect(): void {
    return undefined;
  }
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = NoopObserver;
}

if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {
    return undefined;
  };
}

// Radix Select asks for pointer capture, which jsdom does not have.
if (typeof Element.prototype.hasPointerCapture !== "function") {
  Element.prototype.hasPointerCapture = () => {
    return false;
  };
  Element.prototype.setPointerCapture = () => {
    return undefined;
  };
  Element.prototype.releasePointerCapture = () => {
    return undefined;
  };
}
