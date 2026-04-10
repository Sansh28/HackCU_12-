"use client";

import { useEffect, useRef } from "react";

const LABELS = ["api/", "auth/", "db/", "utils/", "core/", "models/", "routes/", "index.ts", "config/", "tests/", "lib/", "store/"];
const COLORS = ["#f2c14e", "#d4a33a", "#b4882f", "#8f6b22", "#f7deaa"];

type NodePoint = {
  ox: number;
  oy: number;
  r: number;
  color: string;
  label: string | null;
  phase: number;
  spd: number;
  amp: number;
  pos: (t: number) => { x: number; y: number };
};

type Edge = {
  parent: NodePoint;
  child: NodePoint;
};

const rgbCache: Record<string, [number, number, number]> = {};

function hexToRgb(hex: string): [number, number, number] {
  if (rgbCache[hex]) return rgbCache[hex];
  const rgb: [number, number, number] = [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
  rgbCache[hex] = rgb;
  return rgb;
}

function createNode(x: number, y: number, depth: number): NodePoint {
  const phase = Math.random() * Math.PI * 2;
  const spd = 0.25 + Math.random() * 0.3;
  const amp = 14 + depth * 4;

  return {
    ox: x,
    oy: y,
    r: Math.max(1.5, depth === 0 ? 4 : 2.5 - depth * 0.3),
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    label: depth <= 1 ? LABELS[Math.floor(Math.random() * LABELS.length)] : null,
    phase,
    spd,
    amp,
    pos(t: number) {
      return {
        x: this.ox + Math.sin(t * 0.00035 * this.spd + this.phase) * this.amp,
        y: this.oy + Math.cos(t * 0.00028 * this.spd + this.phase * 1.2) * this.amp * 0.65,
      };
    },
  };
}

export function FloatingNodesBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let rafId = 0;
    let nodes: NodePoint[] = [];
    let edges: Edge[] = [];

    const buildTree = (rx: number, ry: number, depth: number, maxDepth: number, spread: number): NodePoint => {
      const node = createNode(rx, ry, depth);
      nodes.push(node);

      if (depth < maxDepth) {
        const count = depth === 0 ? 3 + Math.floor(Math.random() * 2) : 1 + Math.floor(Math.random() * 2);
        const base = Math.random() * Math.PI * 2;
        for (let i = 0; i < count; i++) {
          const angle = base + ((Math.PI * 1.3) / (count - 1 || 1)) * i;
          const dist = spread * (0.6 + Math.random() * 0.5);
          const child = buildTree(
            rx + Math.cos(angle) * dist,
            ry + Math.sin(angle) * dist,
            depth + 1,
            maxDepth,
            spread * 0.6
          );
          edges.push({ parent: node, child });
        }
      }
      return node;
    };

    const buildScene = () => {
      nodes = [];
      edges = [];
      const spread = Math.min(width, height) * 0.055;
      [
        [width * 0.07, height * 0.18],
        [width * 0.88, height * 0.15],
        [width * 0.92, height * 0.78],
        [width * 0.06, height * 0.82],
        [width * 0.5, height * 0.05],
        [width * 0.5, height * 0.96],
        [width * 0.04, height * 0.5],
        [width * 0.96, height * 0.5],
      ].forEach(([x, y]) => {
        buildTree(x, y, 0, 3, spread);
      });
    };

    const resize = () => {
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildScene();
    };

    const draw = (time: number) => {
      ctx.clearRect(0, 0, width, height);

      edges.forEach(({ parent, child }) => {
        const a = parent.pos(time);
        const b = child.pos(time);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = "rgba(212,163,58,0.14)";
        ctx.lineWidth = 0.7;
        ctx.stroke();
      });

      nodes.forEach((node) => {
        const p = node.pos(time);
        const [r, g, b] = hexToRgb(node.color);
        ctx.beginPath();
        ctx.arc(p.x, p.y, node.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},0.52)`;
        ctx.fill();
        if (node.label) {
          ctx.font = "9px monospace";
          ctx.fillStyle = `rgba(${r},${g},${b},0.3)`;
          ctx.fillText(node.label, p.x + node.r + 4, p.y + 3);
        }
      });

      rafId = window.requestAnimationFrame(draw);
    };

    resize();
    rafId = window.requestAnimationFrame(draw);
    window.addEventListener("resize", resize);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-0 opacity-70" aria-hidden="true" />;
}
