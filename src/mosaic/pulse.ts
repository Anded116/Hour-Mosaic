// Soft sine pulse for the current-hour tile. Capped at 30fps and pauses with the window.

export type PulseTick = (alpha: number) => void;

export interface PulseOptions {
  periodMs?: number;
  min?: number;
  max?: number;
  fpsLimit?: number;
}

export class PulseLoop {
  private running = false;
  private startTs = 0;
  private rafId: number | null = null;
  private lastFrame = 0;
  private readonly periodMs: number;
  private readonly min: number;
  private readonly max: number;
  private readonly frameInterval: number;

  constructor(private readonly cb: PulseTick, opts: PulseOptions = {}) {
    this.periodMs = opts.periodMs ?? 3500;
    this.min = opts.min ?? 0.85;
    this.max = opts.max ?? 1;
    const fps = opts.fpsLimit ?? 30;
    this.frameInterval = 1000 / fps;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.startTs = performance.now();
    this.lastFrame = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  private tick = (): void => {
    if (!this.running) return;
    const now = performance.now();
    if (now - this.lastFrame >= this.frameInterval) {
      const phase = ((now - this.startTs) % this.periodMs) / this.periodMs;
      const eased = (1 - Math.cos(phase * Math.PI * 2)) / 2;
      const alpha = this.min + (this.max - this.min) * eased;
      this.cb(alpha);
      this.lastFrame = now;
    }
    this.rafId = requestAnimationFrame(this.tick);
  };
}
