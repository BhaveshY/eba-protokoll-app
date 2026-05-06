import { describe, expect, it } from "vitest";
import {
  resolveRecordingAudioPlan,
  shouldListInputDevices,
} from "../src/lib/recordingMode";

const devices = [
  { deviceId: "1", label: "MacBook Air Microphone", groupId: "g1" },
  { deviceId: "2", label: "BlackHole 2ch", groupId: "g2" },
];

describe("shouldListInputDevices", () => {
  it("does not enumerate devices for minutes-only recording", () => {
    expect(shouldListInputDevices("minutes", "blackhole")).toBe(false);
  });

  it("enumerates devices for normal recording only when a fallback is configured", () => {
    expect(shouldListInputDevices("meeting", "blackhole")).toBe(true);
    expect(shouldListInputDevices("meeting", "")).toBe(false);
  });
});

describe("resolveRecordingAudioPlan", () => {
  it("never returns a system-audio source for minutes-only recording", () => {
    const plan = resolveRecordingAudioPlan(
      "minutes",
      "win32",
      devices,
      "blackhole"
    );

    expect(plan).toEqual({ intent: "minutes", status: "minutes_only" });
    expect("source" in plan).toBe(false);
  });

  it("keeps normal Windows recording on loopback audio", () => {
    expect(resolveRecordingAudioPlan("meeting", "win32", [], "")).toEqual({
      intent: "meeting",
      status: "windows_loopback",
      source: { kind: "windows-loopback" },
    });
  });
});
