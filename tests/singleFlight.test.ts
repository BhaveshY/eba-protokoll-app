import { describe, expect, it } from "vitest";
import { SingleFlight } from "../src/lib/singleFlight";

describe("SingleFlight", () => {
  it("rejects a second job while the first is active and accepts another after completion", async () => {
    const gate = deferred<void>();
    const runner = new SingleFlight();
    let started = 0;

    const first = runner.run(async () => {
      started += 1;
      await gate.promise;
      return "first";
    });
    const second = runner.run(async () => {
      started += 1;
      return "second";
    });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(started).toBe(1);

    gate.resolve();
    await expect(first).resolves.toBe("first");

    const third = runner.run(async () => {
      started += 1;
      return "third";
    });
    await expect(third).resolves.toBe("third");
    expect(started).toBe(2);
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
