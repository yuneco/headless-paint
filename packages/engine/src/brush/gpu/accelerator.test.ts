import { describe, expect, it } from "vitest";
import { createBrushAccelerator, isWebKitUserAgent } from "./accelerator";

describe("createBrushAccelerator", () => {
  it('backend: "cpu" は常に null を返す', () => {
    expect(createBrushAccelerator({ backend: "cpu" })).toBeNull();
  });

  it("Safari UA を WebKit 系として判定する", () => {
    expect(
      isWebKitUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
          "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
      ),
    ).toBe(true);
  });

  it("iOS Safari UA を WebKit 系として判定する", () => {
    expect(
      isWebKitUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) " +
          "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
      ),
    ).toBe(true);
  });

  it("Chrome / Chromium / Edge / Firefox UA を除外する", () => {
    const excluded = [
      "Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
      "Mozilla/5.0 AppleWebKit/537.36 Chromium/140.0.0.0 Safari/537.36",
      "Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
      "Mozilla/5.0 Gecko/20100101 Firefox/142.0",
      "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/140.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 FxiOS/142.0 Mobile/15E148 Safari/605.1.15",
    ];
    for (const userAgent of excluded) {
      expect(isWebKitUserAgent(userAgent)).toBe(false);
    }
  });
});
