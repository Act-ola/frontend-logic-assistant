"use client";

import { useEffect, useRef } from "react";

/**
 * 3D 感流体背景：Canvas 绘制多个发光流体团（metaball），
 * 正弦驱动的有机漂移 + 鼠标视差 + lighter 混合，外层再用大半径 blur 融合成流体。
 * 零依赖；DPR 封顶、页面隐藏暂停、prefers-reduced-motion 时只渲染静态一帧。
 */

type FluidBlob = {
  baseX: number;
  baseY: number;
  radius: number;
  driftX: number;
  driftY: number;
  speedX: number;
  speedY: number;
  phaseX: number;
  phaseY: number;
  color: string;
  parallax: number;
};

const BLOB_COLORS = [
  "rgba(34, 211, 238, 0.52)",
  "rgba(139, 92, 246, 0.48)",
  "rgba(232, 121, 249, 0.40)",
  "rgba(37, 99, 235, 0.44)",
  "rgba(34, 211, 238, 0.30)",
  "rgba(139, 92, 246, 0.34)",
  "rgba(232, 121, 249, 0.26)"
];

const BASE_X = [0.14, 0.82, 0.5, 0.24, 0.72, 0.92, 0.08];
const BASE_Y = [0.18, 0.14, 0.78, 0.88, 0.52, 0.82, 0.56];
const RADIUS = [0.34, 0.3, 0.36, 0.26, 0.22, 0.2, 0.24];

export function FluidBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    let width = 0;
    let height = 0;
    let rafId = 0;
    let running = true;

    const mouse = { x: 0.5, y: 0.5 };
    const eased = { x: 0.5, y: 0.5 };

    const blobs: FluidBlob[] = BLOB_COLORS.map((color, i) => ({
      baseX: BASE_X[i],
      baseY: BASE_Y[i],
      radius: RADIUS[i],
      driftX: 0.1 + (i % 3) * 0.05,
      driftY: 0.08 + ((i + 1) % 3) * 0.05,
      speedX: 0.00011 + i * 0.00003,
      speedY: 0.00009 + i * 0.000026,
      phaseX: i * 1.7,
      phaseY: i * 2.3,
      color,
      parallax: (0.015 + (i % 4) * 0.012) * (i % 2 === 0 ? 1 : -1)
    }));

    function resize() {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw(time: number) {
      // 鼠标视差缓动，营造景深
      eased.x += (mouse.x - eased.x) * 0.04;
      eased.y += (mouse.y - eased.y) * 0.04;

      ctx!.clearRect(0, 0, width, height);
      ctx!.globalCompositeOperation = "lighter";

      const diagonal = Math.max(width, height);
      for (const blob of blobs) {
        const x =
          (blob.baseX +
            Math.sin(time * blob.speedX + blob.phaseX) * blob.driftX +
            (eased.x - 0.5) * blob.parallax) *
          width;
        const y =
          (blob.baseY +
            Math.cos(time * blob.speedY + blob.phaseY) * blob.driftY +
            (eased.y - 0.5) * blob.parallax) *
          height;
        const radius = blob.radius * diagonal;

        const gradient = ctx!.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, blob.color);
        gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx!.fillStyle = gradient;
        ctx!.beginPath();
        ctx!.arc(x, y, radius, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    function loop(time: number) {
      if (!running) return;
      draw(time);
      rafId = requestAnimationFrame(loop);
    }

    function handlePointerMove(event: PointerEvent) {
      mouse.x = event.clientX / Math.max(width, 1);
      mouse.y = event.clientY / Math.max(height, 1);
    }

    function handleVisibility() {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(rafId);
      } else if (!reducedMotion) {
        running = true;
        rafId = requestAnimationFrame(loop);
      }
    }

    resize();
    window.addEventListener("resize", resize);

    if (reducedMotion) {
      draw(0);
    } else {
      window.addEventListener("pointermove", handlePointerMove);
      document.addEventListener("visibilitychange", handleVisibility);
      rafId = requestAnimationFrame(loop);
    }

    return () => {
      running = false;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  return (
    <div className="fluid-bg" aria-hidden="true">
      <canvas ref={canvasRef} className="fluid-bg-canvas" />
      <div className="fluid-bg-veil" />
    </div>
  );
}
