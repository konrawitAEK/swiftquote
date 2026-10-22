import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { SignaturePad } from '../../components/signature-pad';
import type { AcceptQuoteRequest } from '../../models';

/** Customer's signature form on a sent quote. */
@Component({
  selector: 'app-accept-card',
  imports: [FormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatInputModule, SignaturePad],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-card>
      <mat-card-content class="stack pad">
        <h2 class="section-title">Accept this quotation</h2>
        <mat-form-field>
          <mat-label>Your full name</mat-label>
          <input matInput required [(ngModel)]="signerName" [ngModelOptions]="{ standalone: true }" />
        </mat-form-field>
        <app-signature-pad [disabled]="busy()" (signatureChange)="signature.set($event)" />
        <button mat-flat-button type="button" class="big" [disabled]="!canSubmit()" (click)="submit()">
          {{ busy() ? 'Submitting…' : 'Sign and accept' }}
        </button>
      </mat-card-content>
    </mat-card>
  `,
  styles: `
    .pad {
      padding-top: 16px !important;
    }
    .big {
      height: 44px;
    }
  `,
})
export class AcceptCard {
  readonly busy = input(false);
  readonly accept = output<AcceptQuoteRequest>();

  protected readonly signerName = signal('');
  protected readonly signature = signal<string | null>(null);
  protected readonly canSubmit = computed(
    () => !this.busy() && this.signature() !== null && this.signerName().trim() !== '',
  );

  protected submit(): void {
    const signature = this.signature();
    if (signature) this.accept.emit({ signerName: this.signerName(), signatureDataUrl: signature });
  }
}
