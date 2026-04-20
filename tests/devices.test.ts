import { describe, expect, it } from "vitest";
import { findDeviceByHint } from "../src/lib/devices";

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
});
