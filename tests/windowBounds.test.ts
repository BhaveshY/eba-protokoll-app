import { describe, expect, it } from "vitest";
import { fitWindowToWorkArea } from "../shared/windowBounds";

describe("fitWindowToWorkArea", () => {
  it("keeps the initial app window inside the desktop work area", () => {
    expect(
      fitWindowToWorkArea({
        preferredWidth: 900,
        preferredHeight: 820,
        minWidth: 720,
        minHeight: 640,
        workArea: { x: 0, y: 0, width: 1366, height: 760 },
      })
    ).toEqual({
      width: 900,
      height: 728,
      x: 233,
      y: 16,
    });
  });
});
