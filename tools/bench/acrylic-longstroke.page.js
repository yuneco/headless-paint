export const LONG_STROKE_BODY = `
const options = {
  batchCount: __BATCHES__,
  samplesPerBatch: __SAMPLES__,
};

return (async () => {
  if (!element) {
    throw new Error("canvas[data-headless-paint-main] was not found");
  }

  const originalSetPointerCapture = element.setPointerCapture.bind(element);
  const originalReleasePointerCapture =
    element.releasePointerCapture.bind(element);
  element.setPointerCapture = () => {};
  element.releasePointerCapture = () => {};

  try {
    const rect = element.getBoundingClientRect();
    const left = rect.left + rect.width * 0.2;
    const right = rect.left + rect.width * 0.8;
    const centerY = rect.top + rect.height * 0.5;
    const amplitude = rect.height * 0.22;
    const pointerId = 17;
    let sampleIndex = 0;
    const dispatchMs = [];
    const frameMs = [];
    const scheduleLagMs = [];

    const baseTimeStamp = performance.now();
    const stamp = (event, index) => {
      Object.defineProperty(event, "timeStamp", {
        value: baseTimeStamp + index * 2,
      });
      return event;
    };
    const makePoint = (index) => {
      const progress = (index % 180) / 179;
      const sweep = Math.floor(index / 180);
      const x =
        sweep % 2 === 0
          ? left + (right - left) * progress
          : right - (right - left) * progress;
      return {
        clientX: x,
        clientY: centerY + Math.sin(index / 19) * amplitude,
        pressure: 0.58 + Math.sin(index / 47) * 0.18,
      };
    };

    const first = makePoint(0);
    element.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: "pen",
        isPrimary: true,
        buttons: 1,
        ...first,
      }),
    );

    for (let batch = 0; batch < options.batchCount; batch++) {
      const coalesced = [];
      for (let index = 0; index < options.samplesPerBatch; index++) {
        sampleIndex++;
        coalesced.push(
          stamp(
            new PointerEvent("pointermove", {
              pointerId,
              pointerType: "pen",
              isPrimary: true,
              buttons: 1,
              ...makePoint(sampleIndex),
            }),
            sampleIndex,
          ),
        );
      }
      const last = makePoint(sampleIndex);
      const event = stamp(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType: "pen",
          isPrimary: true,
          buttons: 1,
          ...last,
        }),
        sampleIndex,
      );
      Object.defineProperty(event, "getCoalescedEvents", {
        value: () => coalesced,
      });
      const started = performance.now();
      element.dispatchEvent(event);
      dispatchMs.push(performance.now() - started);
      const scheduled = performance.now();
      const frame = await new Promise((resolve) => requestAnimationFrame(resolve));
      frameMs.push(frame - scheduled);
      scheduleLagMs.push(performance.now() - frame);
    }

    const last = makePoint(sampleIndex + 1);
    element.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: "pen",
        isPrimary: true,
        buttons: 0,
        pressure: 0,
        clientX: last.clientX,
        clientY: last.clientY,
      }),
    );
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const drainStartedAt = performance.now();
    element.getContext("2d")?.getImageData(0, 0, 1, 1);
    const drainMs = performance.now() - drainStartedAt;

    return {
      dispatchMs,
      frameMs,
      scheduleLagMs,
      sampleIndex,
      drainMs,
      canvasPerf: window.__acrylicCanvasPerf?.snapshot() ?? null,
      stageSnapshot: globalThis.__hpBrushPerf?.snapshot() ?? null,
    };
  } finally {
    element.setPointerCapture = originalSetPointerCapture;
    element.releasePointerCapture = originalReleasePointerCapture;
  }
})();
`;
