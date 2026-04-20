import { describe, expect, it, vi } from "vitest";
import {
  buildQuery,
  contentTypeFor,
  transcribe,
  TranscriptionCancelled,
  TranscriptionError,
} from "../src/lib/deepgram";
import type { TranscribeOptions } from "../src/lib/types";

const baseOpts: TranscribeOptions = {
  language: "multi",
  multichannel: true,
  keyterms: [],
};

const wavBlob = () => new Blob([new Uint8Array(2048)], { type: "audio/wav" });

function fakeFetch(
  responses: Array<
    | Response
    | Error
    | { status: number; body?: string; json?: unknown }
  >
): { fn: typeof fetch; calls: number } {
  let i = 0;
  return {
    get calls() {
      return i;
    },
    fn: ((..._args: Parameters<typeof fetch>) => {
      const r = responses[i++];
      if (r instanceof Error) return Promise.reject(r);
      if (r instanceof Response) return Promise.resolve(r);
      const init: ResponseInit = { status: r.status };
      if (r.json !== undefined) {
        return Promise.resolve(
          new Response(JSON.stringify(r.json), {
            ...init,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return Promise.resolve(new Response(r.body ?? "", init));
    }) as unknown as typeof fetch,
  };
}

describe("contentTypeFor", () => {
  it.each([
    ["x.wav", "audio/wav"],
    ["x.mp3", "audio/mpeg"],
    ["x.m4a", "audio/mp4"],
    ["x.mp4", "video/mp4"],
    ["x.flac", "audio/flac"],
    ["x.webm", "audio/webm"],
    ["x.unknown", "application/octet-stream"],
  ])("maps %s", (name, expected) => {
    expect(contentTypeFor(name)).toBe(expected);
  });
});

describe("buildQuery", () => {
  it("sets core defaults", () => {
    const q = buildQuery({ ...baseOpts });
    expect(q.get("model")).toBe("nova-3");
    expect(q.get("language")).toBe("multi");
    expect(q.get("multichannel")).toBe("true");
    expect(q.get("diarize")).toBe("true");
    expect(q.get("utterances")).toBe("true");
    expect(q.get("smart_format")).toBe("true");
  });
  it("appends keyterms, skipping blanks", () => {
    const q = buildQuery({
      ...baseOpts,
      keyterms: ["Baugesuch", "  ", "", "Rohbau"],
    });
    expect(q.getAll("keyterm")).toEqual(["Baugesuch", "Rohbau"]);
  });
});

describe("transcribe", () => {
  it("requires api key", async () => {
    await expect(
      transcribe({
        blob: wavBlob(),
        filename: "x.wav",
        apiKey: "",
        options: baseOpts,
      })
    ).rejects.toBeInstanceOf(TranscriptionError);
  });

  it("rejects empty blob", async () => {
    await expect(
      transcribe({
        blob: new Blob([]),
        filename: "x.wav",
        apiKey: "k",
        options: baseOpts,
      })
    ).rejects.toThrow(/leer/);
  });

  it("returns parsed JSON on 200", async () => {
    const ff = fakeFetch([
      { status: 200, json: { results: { utterances: [] } } },
    ]);
    const out = await transcribe({
      blob: wavBlob(),
      filename: "x.wav",
      apiKey: "k",
      options: baseOpts,
      fetchImpl: ff.fn,
      sleep: async () => {},
    });
    expect(out).toEqual({ results: { utterances: [] } });
  });

  it("retries on 5xx then succeeds", async () => {
    const ff = fakeFetch([
      { status: 503, body: "busy" },
      { status: 502, body: "bad" },
      { status: 200, json: { results: { utterances: [] } } },
    ]);
    const out = await transcribe({
      blob: wavBlob(),
      filename: "x.wav",
      apiKey: "k",
      options: baseOpts,
      fetchImpl: ff.fn,
      sleep: async () => {},
    });
    expect(out).toEqual({ results: { utterances: [] } });
    expect(ff.calls).toBe(3);
  });

  it("fails after MAX_RETRIES 5xx", async () => {
    const ff = fakeFetch([
      { status: 503, body: "x" },
      { status: 503, body: "x" },
      { status: 503, body: "x" },
    ]);
    await expect(
      transcribe({
        blob: wavBlob(),
        filename: "x.wav",
        apiKey: "k",
        options: baseOpts,
        fetchImpl: ff.fn,
        sleep: async () => {},
      })
    ).rejects.toThrow(/503/);
  });

  it("surfaces 4xx immediately", async () => {
    const ff = fakeFetch([{ status: 401, body: "bad token" }]);
    await expect(
      transcribe({
        blob: wavBlob(),
        filename: "x.wav",
        apiKey: "k",
        options: baseOpts,
        fetchImpl: ff.fn,
        sleep: async () => {},
      })
    ).rejects.toThrow(/401/);
    expect(ff.calls).toBe(1);
  });

  it("translates AbortError to TranscriptionCancelled", async () => {
    const ff = fakeFetch([
      Object.assign(new DOMException("aborted", "AbortError")) as unknown as Error,
    ]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      transcribe({
        blob: wavBlob(),
        filename: "x.wav",
        apiKey: "k",
        options: baseOpts,
        fetchImpl: ff.fn,
        sleep: async () => {},
        signal: controller.signal,
      })
    ).rejects.toBeInstanceOf(TranscriptionCancelled);
  });

  it("retries on network error, then succeeds", async () => {
    const ff = fakeFetch([
      new TypeError("network down"),
      { status: 200, json: { results: { utterances: [] } } },
    ]);
    const out = await transcribe({
      blob: wavBlob(),
      filename: "x.wav",
      apiKey: "k",
      options: baseOpts,
      fetchImpl: ff.fn,
      sleep: async () => {},
    });
    expect(out).toEqual({ results: { utterances: [] } });
    expect(ff.calls).toBe(2);
  });

  it("fires upload callback at least once", async () => {
    const ff = fakeFetch([
      { status: 200, json: { results: { utterances: [] } } },
    ]);
    const events: Array<{ sent: number; total: number }> = [];
    await transcribe({
      blob: wavBlob(),
      filename: "x.wav",
      apiKey: "k",
      options: baseOpts,
      fetchImpl: ff.fn,
      sleep: async () => {},
      onUpload: (p) => events.push(p),
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1].sent).toBe(2048);
  });
});

// Silence unused imports warning in older vitest
void vi;
