import { describe, expect, it } from "vitest";
import {
  filterLoopbackDevices,
  findDeviceByHint,
  isLikelyLoopbackDevice,
  resolveSystemAudioPlan,
  resolveSystemAudioDevice,
} from "../src/lib/devices";

describe("findDeviceByHint", () => {
  const devices = [
    { deviceId: "1", label: "MacBook Air Microphone", groupId: "g1" },
    { deviceId: "2", label: "BlackHole 2ch", groupId: "g2" },
    { deviceId: "3", label: "External USB Mic", groupId: "g3" },
  ];

  it("returns undefined for empty hint", () => {
    expect(findDeviceByHint(devices, "")).toBeUndefined();
  });

  it("matches case-insensitively by substring", () => {
    expect(findDeviceByHint(devices, "blackhole")?.deviceId).toBe("2");
    expect(findDeviceByHint(devices, "USB")?.deviceId).toBe("3");
  });

  it("returns undefined when no match", () => {
    expect(findDeviceByHint(devices, "virtual cable")).toBeUndefined();
  });

  it("detects likely loopback devices by label", () => {
    expect(isLikelyLoopbackDevice(devices[1])).toBe(true);
    expect(isLikelyLoopbackDevice(devices[0])).toBe(false);
  });

  it("filters loopback devices without mutating the source list", () => {
    expect(filterLoopbackDevices(devices).map((device) => device.deviceId)).toEqual(["2"]);
    expect(devices).toHaveLength(3);
  });

  it("describes missing configured system audio explicitly", () => {
    expect(resolveSystemAudioDevice(devices, "Virtual Cable")).toEqual({
      status: "configured_missing",
      hint: "Virtual Cable",
    });
  });

  it("describes matched configured system audio explicitly", () => {
    expect(resolveSystemAudioDevice(devices, "blackhole")).toEqual({
      status: "found",
      hint: "blackhole",
      deviceId: "2",
      label: "BlackHole 2ch",
    });
  });

  it("uses built-in Electron loopback on Windows without requiring a configured input", () => {
    expect(resolveSystemAudioPlan("win32", devices, "")).toEqual({
      status: "windows_loopback",
      source: { kind: "windows-loopback" },
    });
  });

  it("keeps a configured Windows input device as a fallback", () => {
    expect(resolveSystemAudioPlan("win32", devices, "blackhole")).toEqual({
      status: "windows_loopback",
      fallback: {
        deviceId: "2",
        label: "BlackHole 2ch",
      },
      source: {
        kind: "windows-loopback",
        fallbackDeviceId: "2",
      },
    });
  });

  it("uses configured virtual input devices outside Windows", () => {
    expect(resolveSystemAudioPlan("darwin", devices, "blackhole")).toEqual({
      status: "found",
      hint: "blackhole",
      deviceId: "2",
      label: "BlackHole 2ch",
      source: { kind: "input-device", deviceId: "2" },
    });
  });
});
