import { afterEach, expect, it, vi } from "vitest";
import { subscribeProject } from "./project";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("接続エラー後に作り直し、通知を再開し、解除後は再試行しない", () => {
  vi.useFakeTimers();
  const sources: MockSource[] = [];
  class MockSource {
    onmessage?: () => void;
    onerror?: () => void;
    close = vi.fn();
    constructor() {
      sources.push(this);
    }
  }
  vi.stubGlobal("EventSource", MockSource);
  const change = vi.fn(),
    status = vi.fn();
  const stop = subscribeProject(change, status);
  sources[0].onerror?.();
  expect(status).toHaveBeenLastCalledWith(false);
  expect(sources[0].close).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(1500);
  expect(sources).toHaveLength(2);
  sources[0].onmessage?.();
  expect(change).not.toHaveBeenCalled();
  sources[1].onerror?.();
  vi.advanceTimersByTime(1500);
  sources[2].onmessage?.();
  expect(status).toHaveBeenLastCalledWith(true);
  expect(change).toHaveBeenCalledOnce();
  sources[2].onerror?.();
  stop();
  vi.advanceTimersByTime(5000);
  expect(sources).toHaveLength(3);
});
