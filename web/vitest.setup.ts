import '@testing-library/jest-dom';

// jsdom does not implement EventSource. Importing <App /> constructs `new EventSource('/events')`
// (via useAgentStream), which would throw ReferenceError without a stub. We install a minimal,
// inert stub on globalThis so the hook constructs cleanly and yields NO messages — so App
// renders its empty state by default and tests stay hermetic (no real network/connection).
//
// The stub also records the most-recently-created instance on `MockEventSource.last` so a test
// MAY drive `onmessage`/`onopen` if it wants to exercise the live path. The 4-desk render test
// renders <DeskGrid> directly (deterministic) and does not depend on this.
class MockEventSource {
  static last: MockEventSource | null = null;

  url: string;
  onopen: ((this: EventSource, ev: Event) => unknown) | null = null;
  onmessage: ((this: EventSource, ev: MessageEvent) => unknown) | null = null;
  onerror: ((this: EventSource, ev: Event) => unknown) | null = null;
  readyState = 0;

  constructor(url: string | URL) {
    this.url = String(url);
    MockEventSource.last = this;
  }

  // Receive-only by design — no send/post method exists, mirroring the real read-only stream.
  close(): void {
    this.readyState = 2;
  }
}

// Expose for tests + satisfy `new EventSource(...)` in the hook under jsdom.
(globalThis as unknown as { EventSource: unknown }).EventSource = MockEventSource;

export { MockEventSource };
