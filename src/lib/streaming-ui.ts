export interface BufferedMessageDeltaController {
  push(messageId: string, token: string): void;
  flush(): void;
  cancel(): void;
}

export function createBufferedMessageDeltaController(
  applyDelta: (messageId: string, delta: string) => void,
  options: {
    delayMs?: number;
    schedule?: (callback: () => void, delayMs: number) => unknown;
    cancelSchedule?: (handle: unknown) => void;
  } = {},
): BufferedMessageDeltaController {
  const delayMs = options.delayMs ?? 50;
  const schedule =
    options.schedule ?? ((callback, delay) => window.setTimeout(callback, delay));
  const cancelSchedule =
    options.cancelSchedule ?? ((handle) => window.clearTimeout(handle as number));
  const pending = new Map<string, string>();
  let scheduled: unknown;

  function flush() {
    if (scheduled !== undefined) {
      cancelSchedule(scheduled);
      scheduled = undefined;
    }
    if (!pending.size) {
      return;
    }

    const entries = Array.from(pending.entries());
    pending.clear();
    for (const [messageId, delta] of entries) {
      applyDelta(messageId, delta);
    }
  }

  function ensureScheduled() {
    if (scheduled !== undefined) {
      return;
    }
    scheduled = schedule(() => {
      scheduled = undefined;
      flush();
    }, delayMs);
  }

  return {
    push(messageId, token) {
      pending.set(messageId, `${pending.get(messageId) ?? ""}${token}`);
      ensureScheduled();
    },
    flush,
    cancel() {
      if (scheduled !== undefined) {
        cancelSchedule(scheduled);
        scheduled = undefined;
      }
      pending.clear();
    },
  };
}
