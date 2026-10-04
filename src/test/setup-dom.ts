// Browser APIs the editor uses that jsdom doesn't implement. Node-environment
// tests have no DOM, so there is nothing to patch.

if (typeof window !== "undefined") {
  class ObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }

  globalThis.ResizeObserver ??= ObserverStub as any;
  globalThis.IntersectionObserver ??= ObserverStub as any;

  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as any;

  window.requestIdleCallback ??= ((callback: IdleRequestCallback) =>
    window.setTimeout(() =>
      callback({ didTimeout: false, timeRemaining: () => 0 }),
    )) as any;
  window.cancelIdleCallback ??= ((id: number) =>
    window.clearTimeout(id)) as any;

  Element.prototype.scrollIntoView ??= function scrollIntoView() {};

  // Floating toolbars position themselves from the selection's range rects.
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
  Range.prototype.getClientRects ??= () =>
    ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as any;
}
