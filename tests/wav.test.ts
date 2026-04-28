import { describe, expect, it } from "vitest";
import { encodeWavFromChunks, totalSamples } from "../src/lib/wav";

describe("encodeWavFromChunks", () => {
  it("writes a stereo PCM WAV without flattening chunks first", async () => {
    const blob = encodeWavFromChunks(
      [
        [new Float32Array([1]), new Float32Array([-1])],
        [new Float32Array([0]), new Float32Array([0.5])],
      ],
      16000
    );

    const view = new DataView(await blob.arrayBuffer());
    expect(blob.type).toBe("audio/wav");
    expect(textAt(view, 0, 4)).toBe("RIFF");
    expect(textAt(view, 8, 4)).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(0);
    expect(view.getInt16(48, true)).toBe(-32768);
    expect(view.getInt16(50, true)).toBe(16383);
  });
});

describe("totalSamples", () => {
  it("adds chunk lengths", () => {
    expect(totalSamples([
      new Float32Array(2),
      new Float32Array(3),
    ])).toBe(5);
  });
});

function textAt(view: DataView, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += String.fromCharCode(view.getUint8(offset + i));
  }
  return out;
}
