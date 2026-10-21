import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { shareUrl } from './share-url';

/** Read-only client portal link with a copy button. */
@Component({
  selector: 'app-share-link',
  imports: [MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-form-field class="dense full-width">
      <mat-label>Client link</mat-label>
      <input matInput readonly [value]="url()" (focus)="select($event)" />
      <button mat-icon-button matSuffix type="button" aria-label="Copy link" [matTooltip]="copied() ? 'Copied' : 'Copy link'" (click)="copy()">
        <mat-icon>content_copy</mat-icon>
      </button>
    </mat-form-field>
  `,
  styles: `
    :host {
      display: block;
      flex: 1;
      min-width: 0;
    }
  `,
})
export class ShareLink {
  readonly accessToken = input.required<string>();
  protected readonly url = computed(() => shareUrl(this.accessToken()));
  protected readonly copied = signal(false);

  protected select(e: FocusEvent): void {
    (e.target as HTMLInputElement).select();
  }

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.url());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      // clipboard blocked (e.g. insecure context): the field stays selectable
    }
  }
}
