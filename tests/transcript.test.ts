import { describe, expect, it } from "vitest";
import {
  cleanSpeakerNames,
  collectSpeakerReviewItems,
  formatSubRip,
  formatSubRipTimestamp,
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

describe("formatSubRipTimestamp", () => {
  it("formats milliseconds for SRT", () => {
    expect(formatSubRipTimestamp(0)).toBe("00:00:00,000");
    expect(formatSubRipTimestamp(65.432)).toBe("00:01:05,432");
    expect(formatSubRipTimestamp(3661.9996)).toBe("01:01:02,000");
  });

  it("clamps negative times to zero", () => {
    expect(formatSubRipTimestamp(-1)).toBe("00:00:00,000");
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

describe("formatSubRip", () => {
  it("emits numbered SRT cues with millisecond timing", () => {
    const segs = [
      { start: 0, end: 1.235, speaker: "Ich", text: "Moin." },
      { start: 65.5, end: 67.01, speaker: "Sprecher 1", text: "Hallo." },
    ];
    expect(formatSubRip(segs, {})).toBe(
      "1\r\n" +
        "00:00:00,000 --> 00:00:01,235\r\n" +
        "Ich: Moin.\r\n\r\n" +
        "2\r\n" +
        "00:01:05,500 --> 00:01:07,010\r\n" +
        "Sprecher 1: Hallo.\r\n"
    );
  });

  it("substitutes speaker names", () => {
    const segs = [{ start: 0, end: 1, speaker: "Sprecher 1", text: "Hallo." }];
    expect(formatSubRip(segs, { "Sprecher 1": "Anna" })).toContain(
      "Anna: Hallo."
    );
  });

  it("clamps overlapping cue ends to the next cue start", () => {
    const out = formatSubRip([
      { start: 0, end: 5, speaker: "Ich", text: "First." },
      { start: 2, end: 3, speaker: "Sprecher 1", text: "Second." },
    ], {});
    expect(out).toContain("00:00:00,000 --> 00:00:02,000");
  });

  it("uses a fallback duration for missing end times", () => {
    const out = formatSubRip([
      { start: 4, end: 0, speaker: "Ich", text: "Fallback duration." },
    ], {});
    expect(out).toContain("00:00:04,000 --> 00:00:05,500");
  });

  it("drops empty subtitle text", () => {
    expect(formatSubRip([
      { start: 0, end: 1, speaker: "Ich", text: "  " },
    ], {})).toBe("");
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

describe("cleanSpeakerNames", () => {
  it("trims names and drops blanks", () => {
    expect(
      cleanSpeakerNames({
        " Sprecher 1 ": "  Anna  ",
        "": "Test",
        "Sprecher 2": "   ",
      })
    ).toEqual({ "Sprecher 1": "Anna" });
  });
});

describe("collectSpeakerReviewItems", () => {
  it("collects speaker stats and keeps Ich fixed", () => {
    const items = collectSpeakerReviewItems([
      { start: 0, end: 2, speaker: "Ich", text: "Kurzes Intro." },
      { start: 3, end: 8, speaker: "Sprecher 1", text: "Erster laengerer Beitrag." },
      { start: 9, end: 10, speaker: "Sprecher 1", text: "Nachtrag." },
      { start: 11, end: 14, speaker: "Sprecher 2", text: "Antwort aus dem Team." },
    ], { "Sprecher 2": "Frau Sommer" });

    expect(items.map((item) => item.id)).toEqual([
      "Ich",
      "Sprecher 1",
      "Sprecher 2",
    ]);
    expect(items[0].isFixed).toBe(true);
    expect(items[1].segmentCount).toBe(2);
    expect(items[1].samples).toEqual([
      "Erster laengerer Beitrag.",
      "Nachtrag.",
    ]);
    expect(items[2].assignedName).toBe("Frau Sommer");
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
