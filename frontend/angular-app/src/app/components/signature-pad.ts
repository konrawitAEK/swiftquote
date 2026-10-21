import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  input,
  output,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';

/** Pointer-based signature canvas (mouse, touch and pen). */
@Component({
  selector: 'app-signature-pad',
  imports: [MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pad">
      <canvas
        #canvas
        aria-label="Signature pad"
        [style.cursor]="disabled() ? 'default' : 'crosshair'"
        (pointerdown)="start($event)"
        (pointermove)="move($event)"
        (pointerup)="end()"
        (pointerleave)="end()"
      ></canvas>
      @if (empty()) {
        <span class="hint">Sign here</span>
      }
    </div>
    <div>
      <button mat-button type="button" (click)="clear()" [disabled]="disabled() || empty()">Clear</button>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .pad {
      position: relative;
      height: 160px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 4px;
      background: #fff;
    }
    canvas {
      width: 100%;
      height: 100%;
      touch-action: none;
      display: block;
    }
    .hint {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      color: #9e9e9e;
      pointer-events: none;
      font: var(--mat-sys-body-medium);
    }
  `,
})
export class SignaturePad {
  readonly disabled = input(false);
  /** Emits a PNG data URL after each stroke, or null when cleared. */
  readonly signatureChange = output<string | null>();

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  protected readonly empty = signal(true);
  private drawing = false;

  constructor() {
    // Match the backing store to the displayed size so strokes are crisp and under the pointer.
    afterNextRender(() => {
      const canvas = this.canvas().nativeElement;
      const ratio = window.devicePixelRatio || 1;
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#111';
    });
  }

  private point(e: PointerEvent) {
    const rect = this.canvas().nativeElement.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  protected start(e: PointerEvent): void {
    if (this.disabled()) return;
    const canvas = this.canvas().nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.setPointerCapture(e.pointerId);
    this.drawing = true;
    const { x, y } = this.point(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  protected move(e: PointerEvent): void {
    if (!this.drawing) return;
    const ctx = this.canvas().nativeElement.getContext('2d');
    if (!ctx) return;
    const { x, y } = this.point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  protected end(): void {
    if (!this.drawing) return;
    this.drawing = false;
    this.empty.set(false);
    this.signatureChange.emit(this.canvas().nativeElement.toDataURL('image/png'));
  }

  protected clear(): void {
    const canvas = this.canvas().nativeElement;
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    this.empty.set(true);
    this.signatureChange.emit(null);
  }
}
