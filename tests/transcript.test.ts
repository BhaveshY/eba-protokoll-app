import { describe, expect, it } from "vitest";
import {
  cleanSpeakerNames,
  collectSpeakerReviewItems,
  formatSrt,
  formatTimestamp,
  formatTranscript,
  humanSize,
  responseToSegments,
  safeProject,
  sampleQuotes,
} from "../src/lib/transcript";
import type { Segment } from "../src/lib/types";

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

describe("formatSrt", () => {
  const seg = (
    start: number,
    end: number,
    speaker: string,
    text: string
  ): Segment => ({ start, end, speaker, text });

  it("returns empty string for empty input", () => {
    expect(formatSrt([], {})).toBe("");
  });

  it("skips segments with blank text", () => {
    const out = formatSrt([seg(0, 1, "Ich", "   ")], {});
    expect(out).toBe("");
  });

  it("emits a single cue with comma-separated millis and speaker label", () => {
    const out = formatSrt([seg(0, 3.5, "Sprecher 1", "Guten Morgen.")], {});
    expect(out).toBe(
      "1\n00:00:00,000 --> 00:00:03,500\nSprecher 1: Guten Morgen.\n"
    );
  });

  it("numbers cues starting at 1 with blank line separators", () => {
    const out = formatSrt(
      [
        seg(0, 1, "Ich", "Hallo."),
        seg(1.2, 2.4, "Sprecher 1", "Hi."),
        seg(2.5, 3.0, "Sprecher 2", "Servus."),
      ],
      {}
    );
    const lines = out.split("\n");
    expect(lines[0]).toBe("1");
    expect(lines[4]).toBe("2");
    expect(lines[8]).toBe("3");
    expect(out.split("\n\n").length).toBe(3);
  });

  it("pads hours, minutes, seconds, milliseconds correctly", () => {
    const out = formatSrt([seg(3661.234, 3662.05, "Sprecher 1", "Text.")], {});
    expect(out).toContain("01:01:01,234 --> 01:01:02,050");
  });

  it("substitutes renamed speakers from the names map", () => {
    const out = formatSrt(
      [seg(0, 1, "Sprecher 1", "Hallo.")],
      { "Sprecher 1": "Anna" }
    );
    expect(out).toContain("Anna: Hallo.");
    expect(out).not.toContain("Sprecher 1:");
  });

  it("splits utterances that exceed 2x42 chars into multiple cues", () => {
    const long =
      "Dies ist ein sehr langer Redebeitrag der unbedingt auf mehrere Zeilen umgebrochen werden muss damit er in einem Untertitel gut lesbar bleibt.";
    const out = formatSrt([seg(0, 6, "Sprecher 1", long)], {});
    const blocks = out.trim().split("\n\n");
    // Should have produced 2+ cues for an utterance this long.
    expect(blocks.length).toBeGreaterThan(1);
    // Every cue body obeys the 2-line / 42-char budget.
    for (const block of blocks) {
      const bodyLines = block.split("\n").slice(2);
      expect(bodyLines.length).toBeLessThanOrEqual(2);
      for (const line of bodyLines) {
        // Allow slack for single words longer than 42 chars (none in this fixture).
        expect(line.length).toBeLessThanOrEqual(42);
        expect(line.endsWith(" ")).toBe(false);
      }
    }
    // Cue numbering is 1-based and sequential.
    const indices = blocks.map((b) => Number(b.split("\n")[0]));
    expect(indices).toEqual(indices.map((_, i) => i + 1));
  });

  it("distributes split-cue timestamps across the segment range", () => {
    const long =
      "Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu.";
    const out = formatSrt([seg(10, 20, "Sprecher 1", long)], {});
    const blocks = out.trim().split("\n\n");
    expect(blocks.length).toBeGreaterThan(1);
    const parseCue = (block: string) => {
      const [_, timecode] = block.split("\n");
      const [start, end] = timecode.split(" --> ");
      return { start, end };
    };
    const first = parseCue(blocks[0]);
    const last = parseCue(blocks[blocks.length - 1]);
    // First cue starts at segment start, last cue ends at segment end.
    expect(first.start).toBe("00:00:10,000");
    expect(last.end).toBe("00:00:20,000");
    // Cues are contiguous: each cue's end equals the next cue's start.
    for (let i = 0; i < blocks.length - 1; i++) {
      expect(parseCue(blocks[i]).end).toBe(parseCue(blocks[i + 1]).start);
    }
  });

  it("never negative: clamps negative starts to 00:00:00,000", () => {
    const out = formatSrt([seg(-0.1, 0.5, "Sprecher 1", "Text.")], {});
    expect(out).toContain("00:00:00,000 --> 00:00:00,500");
  });
});
