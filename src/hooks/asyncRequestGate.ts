/**
 * Owns the right to publish the result of one asynchronous request.
 * A newer request supersedes the previous one, while cancellation revokes the
 * current owner before an unmounted consumer can be updated.
 */
export function createAsyncRequestGate() {
  let current = 0;
  let active = false;
  return {
    begin() {
      current += 1;
      active = true;
      return current;
    },
    isCurrent(request: number) {
      return active && request === current;
    },
    cancel(request: number) {
      if (request !== current) return;
      active = false;
      current += 1;
    }
  };
}

/** Turns a synchronous loader throw into a rejected promise the hook can catch. */
export function invokeAsyncLoader<T>(loader: () => Promise<T>): Promise<T> {
  return Promise.resolve().then(loader);
}
