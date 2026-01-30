import { useEffect, useRef } from "react";

interface CanvasProps {
  imageData: ImageData;
}

export function Canvas({ imageData }: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.putImageData(imageData, 0, 0);
  }, [imageData]);

  return (
    <canvas
      ref={canvasRef}
      width={imageData.width}
      height={imageData.height}
      style={{ border: "1px solid #ccc" }}
    />
  );
}
