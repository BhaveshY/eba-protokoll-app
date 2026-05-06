import { describe, expect, it } from "vitest";
import {
  type DisplayMediaSession,
  installWindowsLoopbackDisplayMediaHandler,
  windowsLoopbackStreams,
} from "../electron/systemAudio";

describe("windowsLoopbackStreams", () => {
  it("chooses the first screen source and grants Windows loopback audio", async () => {
    const calls: unknown[] = [];
    const streams = await windowsLoopbackStreams({
      getSources: async (options) => {
        calls.push(options);
        return [
          { id: "screen:1", name: "Entire Screen" },
          { id: "screen:2", name: "Second Screen" },
        ];
      },
    });

    expect(calls).toEqual([
      { types: ["screen"], thumbnailSize: { width: 0, height: 0 } },
    ]);
    expect(streams).toEqual({
      video: { id: "screen:1", name: "Entire Screen" },
      audio: "loopback",
    });
  });

  it("throws if Electron cannot provide a screen source", async () => {
    await expect(
      windowsLoopbackStreams({
        getSources: async () => [],
      })
    ).rejects.toThrow(/screen source/i);
  });
});

describe("installWindowsLoopbackDisplayMediaHandler", () => {
  it("does not install a handler outside Windows", () => {
    const session = fakeSession();
    const installed = installWindowsLoopbackDisplayMediaHandler(
      "darwin",
      session,
      { getSources: async () => [] }
    );

    expect(installed).toBe(false);
    expect(session.handler).toBeNull();
  });

  it("installs a Windows handler that returns loopback streams", async () => {
    const session = fakeSession();
    const installed = installWindowsLoopbackDisplayMediaHandler(
      "win32",
      session,
      {
        getSources: async () => [{ id: "screen:1", name: "Entire Screen" }],
      }
    );

    expect(installed).toBe(true);
    expect(session.handler).not.toBeNull();

    const streams = await new Promise((resolve) => {
      session.handler?.({}, resolve);
    });
    expect(streams).toEqual({
      video: { id: "screen:1", name: "Entire Screen" },
      audio: "loopback",
    });
  });
});

function fakeSession() {
  const value = {
    handler: null as null | ((request: unknown, callback: (streams: unknown) => void) => void),
    setDisplayMediaRequestHandler(
      handler: ((request: unknown, callback: (streams: unknown) => void) => void) | null
    ) {
      this.handler = handler;
    },
  };
  return value as typeof value & DisplayMediaSession;
}
