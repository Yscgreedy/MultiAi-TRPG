import { describe, expect, it } from "vitest";

import { createBufferedMessageDeltaController } from "@/lib/streaming-ui";

describe("streaming UI buffering", () => {
  it("batches token deltas by message while preserving order", () => {
    const applied: Array<{ messageId: string; delta: string }> = [];
    let scheduled: (() => void) | undefined;
    const controller = createBufferedMessageDeltaController(
      (messageId, delta) => applied.push({ messageId, delta }),
      {
        schedule: (callback) => {
          scheduled = callback;
          return "scheduled";
        },
        cancelSchedule: () => {
          scheduled = undefined;
        },
      },
    );

    controller.push("msg-a", "你");
    controller.push("msg-a", "好");
    controller.push("msg-b", "在");
    controller.push("msg-a", "。");

    expect(applied).toEqual([]);

    scheduled?.();

    expect(applied).toEqual([
      { messageId: "msg-a", delta: "你好。" },
      { messageId: "msg-b", delta: "在" },
    ]);
  });

  it("flushes pending token deltas immediately", () => {
    const applied: Array<{ messageId: string; delta: string }> = [];
    const controller = createBufferedMessageDeltaController(
      (messageId, delta) => applied.push({ messageId, delta }),
      {
        schedule: () => "scheduled",
        cancelSchedule: () => undefined,
      },
    );

    controller.push("msg-a", "线");
    controller.push("msg-a", "索");
    controller.flush();

    expect(applied).toEqual([{ messageId: "msg-a", delta: "线索" }]);
  });
});
