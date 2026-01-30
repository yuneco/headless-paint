import { createLayer, drawLine, getImageData } from "@headless-paint/engine";
import { useMemo } from "react";
import { Canvas } from "./components/Canvas";

const LINE_COUNT = 100;

export function App() {
  const { imageData, drawTime } = useMemo(() => {
    const layer = createLayer(1920, 1080);

    const colors = [
      { r: 255, g: 0, b: 0, a: 255 },
      { r: 0, g: 200, b: 0, a: 255 },
      { r: 0, g: 100, b: 255, a: 255 },
      { r: 255, g: 200, b: 0, a: 255 },
      { r: 200, g: 0, b: 200, a: 255 },
    ];

    const start = performance.now();

    for (let i = 0; i < LINE_COUNT; i++) {
      const x1 = Math.random() * 1920;
      const y1 = Math.random() * 1080;
      const x2 = Math.random() * 1920;
      const y2 = Math.random() * 1080;
      const color = colors[i % colors.length];
      drawLine(layer, { x: x1, y: y1 }, { x: x2, y: y2 }, color);
    }

    const drawTime = performance.now() - start;
    console.log(`Drew ${LINE_COUNT} lines in ${drawTime.toFixed(2)}ms`);

    return { imageData: getImageData(layer), drawTime };
  }, []);

  return (
    <div>
      <h1>Headless Paint</h1>
      <p>
        {LINE_COUNT} lines drawn in <strong>{drawTime.toFixed(2)}ms</strong>
      </p>
      <Canvas imageData={imageData} />
    </div>
  );
}
