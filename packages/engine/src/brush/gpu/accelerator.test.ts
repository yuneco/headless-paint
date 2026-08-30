import { describe, expect, it } from "vitest";
import {
  createBrushAccelerator,
  isWebKitUserAgent,
  resolveBrushAcceleratorBackend,
} from "./accelerator";

const SAFARI_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15";
const CHROME_USER_AGENT =
  "Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36";

describe("createBrushAccelerator", () => {
  it('backend: "cpu" は常に null を返す', () => {
    expect(createBrushAccelerator({ backend: "cpu" })).toBeNull();
  });

  it("Safari UA を WebKit 系として判定する", () => {
    expect(isWebKitUserAgent(SAFARI_USER_AGENT)).toBe(true);
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

describe("resolveBrushAcceleratorBackend", () => {
  it("Safari UA の auto は WebGL2 を選ぶ", () => {
    expect(
      resolveBrushAcceleratorBackend(
        { backend: "auto" },
        { userAgent: SAFARI_USER_AGENT, webgl2Available: () => true },
      ),
    ).toEqual({ backend: "webgl2", reason: "auto: webkit" });
  });

  it("Chrome UA の auto は WebGL2 の可否にかかわらず CPU を選ぶ", () => {
    expect(
      resolveBrushAcceleratorBackend(
        { backend: "auto" },
        { userAgent: CHROME_USER_AGENT, webgl2Available: () => true },
      ),
    ).toEqual({ backend: "cpu", reason: "auto: not webkit" });
  });

  it("WebGL2 が利用できなければ CPU を選ぶ", () => {
    expect(
      resolveBrushAcceleratorBackend(
        { backend: "webgl2" },
        { userAgent: CHROME_USER_AGENT, webgl2Available: () => false },
      ),
    ).toEqual({ backend: "cpu", reason: "webgl2: unavailable" });
  });

  it("明示的な WebGL2 指定を reason に反映する", () => {
    expect(
      resolveBrushAcceleratorBackend(
        { backend: "webgl2" },
        { userAgent: CHROME_USER_AGENT, webgl2Available: () => true },
      ),
    ).toEqual({ backend: "webgl2", reason: "webgl2: setting" });
  });

  it("CPU 指定は WebGL2 の可否にかかわらず CPU を選ぶ", () => {
    expect(
      resolveBrushAcceleratorBackend(
        { backend: "cpu" },
        { userAgent: SAFARI_USER_AGENT, webgl2Available: () => true },
      ),
    ).toEqual({ backend: "cpu", reason: "cpu: setting" });
  });
});
