/**
 * Encode a PCM AudioBuffer as a 16-bit PCM WAV Blob.
 * Handles mono and stereo input.
 */
export function encodeWav(audioBuffer: AudioBuffer): Blob {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;

  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = length * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");

  // fmt chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);

  // data chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // PCM samples, interleaved
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(audioBuffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numChannels; c++) {
      let sample = Math.max(-1, Math.min(1, channels[c][i]));
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, sample | 0, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Encode chunked mono/stereo Float32 PCM as 16-bit WAV without first
 * flattening the full recording into duplicate channel buffers.
 */
export function encodeWavFromChunks(
  channels: Float32Array[][],
  sampleRate: number
): Blob {
  const numChannels = channels.length;
  if (numChannels < 1 || numChannels > 2) {
    throw new Error("WAV encoding supports one or two channels.");
  }

  const length = Math.max(...channels.map(totalSamples));
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = length * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeWavHeader(view, {
    sampleRate,
    numChannels,
    bytesPerSample,
    blockAlign,
    byteRate,
    dataSize,
  });

  const cursors = channels.map(() => ({ chunkIndex: 0, sampleIndex: 0 }));
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numChannels; c++) {
      let sample = nextSample(channels[c], cursors[c]);
      sample = Math.max(-1, Math.min(1, sample));
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, sample | 0, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

export function totalSamples(chunks: Float32Array[]): number {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  return total;
}

function nextSample(
  chunks: Float32Array[],
  cursor: { chunkIndex: number; sampleIndex: number }
): number {
  while (cursor.chunkIndex < chunks.length) {
    const chunk = chunks[cursor.chunkIndex];
    if (cursor.sampleIndex < chunk.length) {
      const value = chunk[cursor.sampleIndex];
      cursor.sampleIndex += 1;
      return value;
    }
    cursor.chunkIndex += 1;
    cursor.sampleIndex = 0;
  }
  return 0;
}

function writeWavHeader(
  view: DataView,
  opts: {
    sampleRate: number;
    numChannels: number;
    bytesPerSample: number;
    blockAlign: number;
    byteRate: number;
    dataSize: number;
  }
): void {
  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + opts.dataSize, true);
  writeString(view, 8, "WAVE");

  // fmt chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, opts.numChannels, true);
  view.setUint32(24, opts.sampleRate, true);
  view.setUint32(28, opts.byteRate, true);
  view.setUint16(32, opts.blockAlign, true);
  view.setUint16(34, opts.bytesPerSample * 8, true);

  // data chunk
  writeString(view, 36, "data");
  view.setUint32(40, opts.dataSize, true);
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/** Combine two mono Float32Array PCM streams into a stereo AudioBuffer. */
export function makeStereoBuffer(
  ctx: BaseAudioContext,
  left: Float32Array,
  right: Float32Array,
  sampleRate: number
): AudioBuffer {
  const n = Math.max(left.length, right.length);
  const buf = ctx.createBuffer(2, n, sampleRate);
  const lc = buf.getChannelData(0);
  const rc = buf.getChannelData(1);
  lc.set(left);
  rc.set(right);
  return buf;
}
