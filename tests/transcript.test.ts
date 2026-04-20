import { describe, expect, it } from "vitest";
import {
  formatTimestamp,
  formatTranscript,
  humanSize,
  responseToSegments,
  safeProject,
  sampleQuotes,
} from "../src/lib/transcript";

describe("formatTimestamp", () => {
  it("pads hours, minutes, seconds", () => {
    expect(formatTimestamp(0)).toBe("00:00:00");
    expect(formatTimestamp(65)).toBe("00:01:05");
    expect(formatTimestamp(3661)).toBe("01:01:01");
  });
});

describe("responseToSegments", () => {
  const resp = (utterances: any[]) => ({ results: { utterances } });

  it("maps channel 0 to Ich for recorded stereo", () => {
    const segs = responseToSegments(
      resp([
        { start: 0, end: 1, channel: 0, speaker: 0, transcript: "Guten Morgen." },
        { start: 1.2, end: 2, channel: 1, speaker: 0, transcript: "Hallo." },
        { start: 2.1, end: 3, channel: 1, speaker: 1, transcript: "Tag." },
      ]),
      true
    );
    expect(segs.map((s) => s.speaker)).toEqual(["Ich", "Sprecher 1", "Sprecher 2"]);
  });

  it("never produces Ich for imported files", () => {
    const segs = responseToSegments(
      resp([
        { start: 0, end: 1, speaker: 0, transcript: "Hallo." },
        { start: 1, end: 2, speaker: 1, transcript: "Ja." },
      ]),
      false
    );
    expect(segs.map((s) => s.speaker)).toEqual(["Sprecher 1", "Sprecher 2"]);
    expect(segs.every((s) => s.speaker !== "Ich")).toBe(true);
  });

  it("sorts segments by start", () => {
    const segs = responseToSegments(
      resp([
        { start: 5, end: 6, speaker: 0, transcript: "three" },
        { start: 0, end: 1, speaker: 1, transcript: "one" },
        { start: 2, end: 3, speaker: 0, transcript: "two" },
      ]),
      false
    );
    expect(segs.map((s) => s.text)).toEqual(["one", "two", "three"]);
  });

  it("drops empty text", () => {
    const segs = responseToSegments(
      resp([
        { start: 0, end: 1, speaker: 0, transcript: "  " },
        { start: 1, end: 2, speaker: 0, transcript: "real" },
      ]),
      false
    );
    expect(segs).toHaveLength(1);
    expect(segs[0].text).toBe("real");
  });

  it("defaults missing speaker to Sprecher 1", () => {
    const segs = responseToSegments(
      resp([{ start: 0, end: 1, transcript: "text" }]),
      false
    );
    expect(segs[0].speaker).toBe("Sprecher 1");
  });
});

describe("formatTranscript", () => {
  it("is byte-stable Cowork format", () => {
    const segs = [
      { start: 5, end: 7, speaker: "Ich", text: "Moin." },
      { start: 12, end: 14, speaker: "Sprecher 1", text: "Hallo." },
    ];
    expect(formatTranscript(segs, {})).toBe(
      "[00:00:05] Ich: Moin.\n[00:00:12] Sprecher 1: Hallo."
    );
  });

  it("substitutes speaker names", () => {
    const segs = [{ start: 0, end: 1, speaker: "Sprecher 1", text: "Hallo." }];
    expect(formatTranscript(segs, { "Sprecher 1": "Herr Mueller" })).toBe(
      "[00:00:00] Herr Mueller: Hallo."
    );
  });
});

describe("sampleQuotes", () => {
  it("skips Ich and takes first quote per speaker", () => {
    const q = sampleQuotes([
      { start: 0, end: 1, speaker: "Ich", text: "Moin." },
      { start: 1, end: 2, speaker: "Sprecher 1", text: "first" },
      { start: 2, end: 3, speaker: "Sprecher 1", text: "second" },
    ]);
    expect(q).toEqual({ "Sprecher 1": "first" });
  });

  it("truncates long lines with ellipsis", () => {
    const q = sampleQuotes([
      { start: 0, end: 1, speaker: "Sprecher 1", text: "x".repeat(200) },
    ]);
    expect(q["Sprecher 1"].endsWith("...")).toBe(true);
    expect(q["Sprecher 1"].length).toBe(123);
  });
});

describe("safeProject", () => {
  it("keeps letters/digits/space/hyphen/underscore", () => {
    expect(safeProject("Besprechung 2026-04")).toBe("Besprechung 2026-04");
  });
  it("replaces unsafe chars with underscore", () => {
    expect(safeProject("a/b:c?")).toBe("a_b_c_");
  });
  it("preserves unicode letters", () => {
    expect(safeProject("Müller-Meier")).toBe("Müller-Meier");
  });
});

describe("humanSize", () => {
  it("formats bytes, KB, MB", () => {
    expect(humanSize(512)).toBe("512 B");
    expect(humanSize(2048)).toBe("2.0 KB");
    expect(humanSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
