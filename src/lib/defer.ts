export function runAfterInitialPaint(callback: () => void): () => void {
  type BrowserWindow = {
    requestIdleCallback?: (handler: IdleRequestCallback, options?: IdleRequestOptions) => number;
    cancelIdleCallback?: (handle: number) => void;
    requestAnimationFrame: Window["requestAnimationFrame"];
    cancelAnimationFrame: Window["cancelAnimationFrame"];
    setTimeout: Window["setTimeout"];
    clearTimeout: Window["clearTimeout"];
  };

  let active = true;
  const run = () => {
    if (active) callback();
  };

  if (typeof window === "undefined") {
    run();
    return () => {
      active = false;
    };
  }

  const browserWindow = window as unknown as BrowserWindow;
  if (browserWindow.requestIdleCallback) {
    const idleId = browserWindow.requestIdleCallback(run, { timeout: 1_000 });
    return () => {
      active = false;
      browserWindow.cancelIdleCallback?.(idleId);
    };
  }

  let timeoutId: number | null = null;
  const frameId = browserWindow.requestAnimationFrame(() => {
    timeoutId = browserWindow.setTimeout(run, 0);
  });

  return () => {
    active = false;
    browserWindow.cancelAnimationFrame(frameId);
    if (timeoutId !== null) browserWindow.clearTimeout(timeoutId);
  };
}
