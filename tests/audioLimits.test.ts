import { describe, expect, it } from "vitest";
import {
  MAX_SINGLE_REQUEST_BYTES,
  WARN_SINGLE_REQUEST_BYTES,
  assessAudioImport,
  supportedAudioExtension,
} from "../shared/audioLimits";

describe("supportedAudioExtension", () => {
  it("accepts supported audio and video extensions case-insensitively", () => {
    expect(supportedAudioExtension("meeting.WAV")).toBe(true);
    expect(supportedAudioExtension("recording.mp4")).toBe(true);
    expect(supportedAudioExtension("notes.txt")).toBe(false);
    expect(supportedAudioExtension("wav")).toBe(false);
  });
});

describe("assessAudioImport", () => {
  it("rejects empty files before transcription", () => {
    expect(assessAudioImport("meeting.wav", 0)).toEqual({
      ok: false,
      code: "empty",
      size: 0,
    });
  });

  it("rejects files above Deepgram's single request limit", () => {
    expect(assessAudioImport("meeting.wav", MAX_SINGLE_REQUEST_BYTES + 1)).toEqual({
      ok: false,
      code: "too_large",
      size: MAX_SINGLE_REQUEST_BYTES + 1,
    });
  });

  it("warns but allows large files below the hard limit", () => {
    expect(assessAudioImport("meeting.wav", WARN_SINGLE_REQUEST_BYTES + 1)).toEqual({
      ok: true,
      warning: "large",
      size: WARN_SINGLE_REQUEST_BYTES + 1,
    });
  });
});
