export const ACRYLIC_PARITY_BODY = `
return (async () => {
  if (!element) {
    throw new Error("canvas[data-headless-paint-main] was not found");
  }
  if (!globalThis.__hpDebugUi) {
    throw new Error("globalThis.__hpDebugUi is not available");
  }
  if (!globalThis.__hpBrushPerf) {
    throw new Error("globalThis.__hpBrushPerf is not available; use ?perfDebug=1");
  }

  const originalSetPointerCapture = element.setPointerCapture.bind(element);
  const originalReleasePointerCapture =
    element.releasePointerCapture.bind(element);
  element.setPointerCapture = () => {};
  element.releasePointerCapture = () => {};

  const nextFrame = () =>
    new Promise((resolve) => requestAnimationFrame(resolve));
  const settle = async () => {
    await nextFrame();
    await nextFrame();
    element.getContext("2d")?.getImageData(0, 0, 1, 1);
  };
  const configure = async (brush, color, lineWidth) => {
    globalThis.__hpDebugUi.selectBrush(brush);
    globalThis.__hpDebugUi.setColor(color);
    globalThis.__hpDebugUi.setLineWidth(lineWidth);
    await settle();
  };

  const samplePolyline = (vertices, spacingPx) => {
    const segments = [];
    let total = 0;
    for (let index = 1; index < vertices.length; index++) {
      const from = vertices[index - 1];
      const to = vertices[index];
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      if (length <= 0) continue;
      segments.push({ from, to, start: total, length });
      total += length;
    }
    if (segments.length === 0) return [vertices[0]];
    const moveCount = Math.max(8, Math.round(total / spacingPx / 8) * 8);
    const points = [vertices[0]];
    let segmentIndex = 0;
    for (let index = 1; index <= moveCount; index++) {
      const distance = (total * index) / moveCount;
      while (
        segmentIndex < segments.length - 1 &&
        distance > segments[segmentIndex].start + segments[segmentIndex].length
      ) {
        segmentIndex++;
      }
      const segment = segments[segmentIndex];
      const ratio = Math.min(
        1,
        Math.max(0, (distance - segment.start) / segment.length),
      );
      points.push({
        x: segment.from.x + (segment.to.x - segment.from.x) * ratio,
        y: segment.from.y + (segment.to.y - segment.from.y) * ratio,
      });
    }
    return points;
  };

  let strokeSequence = 0;
  const drawStroke = async (points, pressureAt) => {
    if (!points[0]) throw new Error("stroke has no points");
    const rect = element.getBoundingClientRect();
    const pointerId = 4100 + strokeSequence;
    const baseTimeStamp = 10000 + strokeSequence * 1000;
    strokeSequence++;
    const pressure = (index) =>
      typeof pressureAt === "function" ? pressureAt(index) : pressureAt;
    const stamp = (event, index) => {
      Object.defineProperty(event, "timeStamp", {
        value: baseTimeStamp + index * 2,
      });
      return event;
    };
    const eventFor = (type, point, index, buttons) =>
      stamp(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType: "pen",
          isPrimary: true,
          buttons,
          pressure: buttons === 0 ? 0 : pressure(index),
          clientX: rect.left + point.x,
          clientY: rect.top + point.y,
        }),
        index,
      );

    const originalRandom = Math.random;
    Math.random = () => 0.3141592653;
    try {
      element.dispatchEvent(eventFor("pointerdown", points[0], 0, 1));
    } finally {
      Math.random = originalRandom;
    }
    for (let start = 1; start < points.length; start += 8) {
      const batch = points.slice(start, start + 8);
      if (batch.length !== 8) {
        throw new Error("fixture move batch was not exactly 8 samples");
      }
      const coalesced = batch.map((point, offset) =>
        eventFor("pointermove", point, start + offset, 1),
      );
      const move = eventFor(
        "pointermove",
        batch[batch.length - 1],
        start + batch.length - 1,
        1,
      );
      Object.defineProperty(move, "getCoalescedEvents", {
        value: () => coalesced,
      });
      element.dispatchEvent(move);
      await nextFrame();
    }
    const last = points[points.length - 1];
    element.dispatchEvent(eventFor("pointerup", last, points.length, 0));
    await settle();
  };

  const undoStroke = async () => {
    const undo = document.querySelector('[aria-label="Undo"]');
    if (!(undo instanceof HTMLButtonElement) || undo.disabled) {
      throw new Error("enabled Undo button was not found");
    }
    globalThis.__hpUndoTiming?.reset();
    undo.click();
    const deadline = performance.now() + 30000;
    while ((globalThis.__hpUndoTiming?.entries.length ?? 0) === 0) {
      if (performance.now() >= deadline) {
        throw new Error("timed out waiting for Undo completion");
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await settle();
  };

  const capture = (roi) => {
    const context = element.getContext("2d");
    if (!context) throw new Error("main canvas 2D context was not found");
    const rect = element.getBoundingClientRect();
    const scaleX = element.width / rect.width;
    const scaleY = element.height / rect.height;
    const x = Math.max(0, Math.floor(rect.width * roi.left * scaleX));
    const y = Math.max(0, Math.floor(rect.height * roi.top * scaleY));
    const right = Math.min(
      element.width,
      Math.ceil(rect.width * roi.right * scaleX),
    );
    const bottom = Math.min(
      element.height,
      Math.ceil(rect.height * roi.bottom * scaleY),
    );
    return context.getImageData(x, y, right - x, bottom - y);
  };

  const encode = (image) => {
    let binary = "";
    for (let offset = 0; offset < image.data.length; offset += 0x8000) {
      binary += String.fromCharCode(
        ...image.data.subarray(offset, offset + 0x8000),
      );
    }
    return {
      width: image.width,
      height: image.height,
      data: btoa(binary),
    };
  };
  const differentChannelCount = (candidate, baseline) => {
    let changed = 0;
    for (let index = 0; index < candidate.data.length; index++) {
      if (candidate.data[index] !== baseline.data[index]) changed++;
    }
    return changed;
  };

  const rect = element.getBoundingClientRect();
  const point = (xRatio, yRatio) => ({
    x: rect.width * xRatio,
    y: rect.height * yRatio,
  });
  const horizontal = (from, to, y) =>
    samplePolyline([point(from, y), point(to, y)], 6);
  const acrylicPressure = (index) => 0.7 + Math.sin(index / 13) * 0.08;
  const f1Vertices = [];
  for (let index = 0; index <= 40; index++) {
    const progress = index / 40;
    f1Vertices.push({
      x: rect.width * (0.3 + progress * 0.4),
      y: rect.height * 0.3 + Math.sin(progress * Math.PI * 2) * 34,
    });
  }
  const f2ForwardVertices = [];
  for (let index = 0; index <= 30; index++) {
    const progress = index / 30;
    f2ForwardVertices.push({
      x: rect.width * (0.3 + progress * 0.4),
      y: rect.height * 0.52 + Math.sin(progress * Math.PI) * 18,
    });
  }
  const f2Vertices = [];
  for (let pass = 0; pass < 6; pass++) {
    const leg = pass % 2 === 0
      ? f2ForwardVertices
      : [...f2ForwardVertices].reverse();
    f2Vertices.push(...(pass === 0 ? leg : leg.slice(1)));
  }

  const fixtures = [
    {
      id: "f1-red-blue-boundary",
      roi: { left: 0.26, top: 0.18, right: 0.74, bottom: 0.42 },
      acrylicColor: "#fff3c4",
      underpaint: async () => {
        await configure("Pen", "#ef3038", 160);
        await drawStroke(horizontal(0.3, 0.5, 0.3), 1);
        await configure("Pen", "#2457d6", 160);
        await drawStroke(horizontal(0.5, 0.7, 0.3), 1);
      },
      points: samplePolyline(f1Vertices, 6),
    },
    {
      id: "f2-round-trip",
      roi: { left: 0.26, top: 0.41, right: 0.74, bottom: 0.64 },
      acrylicColor: "#245bd8",
      underpaint: async () => {
        await configure("Pen", "#f4cf35", 160);
        await drawStroke(horizontal(0.3, 0.7, 0.52), 1);
      },
      points: samplePolyline(f2Vertices, 6),
    },
    {
      id: "f3-spot-pickup",
      roi: { left: 0.26, top: 0.64, right: 0.74, bottom: 0.84 },
      acrylicColor: "#e43d45",
      underpaint: async () => {
        await configure("Pen", "#2358d8", 40);
        await drawStroke(
          samplePolyline([point(0.5, 0.74), point(0.501, 0.74)], 6),
          1,
        );
      },
      points: horizontal(0.3, 0.7, 0.74),
    },
  ];

  const results = [];
  try {
    for (const fixture of fixtures) {
      await fixture.underpaint();
      const baseline = capture(fixture.roi);

      await configure("Acrylic", fixture.acrylicColor, 24);
      await drawStroke(fixture.points, acrylicPressure);
      const rendered = capture(fixture.roi);
      await undoStroke();
      const undo = capture(fixture.roi);
      results.push({
        id: fixture.id,
        sampleCount: fixture.points.length,
        moveSamples: fixture.points.length - 1,
        samplesPerBatch: 8,
        batchCount: (fixture.points.length - 1) / 8,
        undoDifferentChannels: differentChannelCount(undo, baseline),
        baseline: encode(baseline),
        rendered: encode(rendered),
      });
    }

    return {
      version: 2,
      backend: benchmarkOptions.backend,
      brushSeedRandom: 0.3141592653,
      samplesPerBatch: 8,
      captureSource: "display-canvas-roi",
      fixtures: results,
    };
  } finally {
    element.setPointerCapture = originalSetPointerCapture;
    element.releasePointerCapture = originalReleasePointerCapture;
  }
})();
`;
