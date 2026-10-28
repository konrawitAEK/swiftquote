import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, type MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { forkJoin } from 'rxjs';
import { Alert } from '../../components/alert';
import { errorText } from '../../core/api';
import { AuthService } from '../../services/auth.service';
import { formatMoney } from '../../core/pricing';
import { ROLE_LABELS } from '../../core/roles';
import { SettingsService } from '../../services/settings.service';
import { CategoryDialog } from './category-dialog';
import { DeleteDialog, type DeleteTarget } from './delete-dialog';
import { ProductDialog, type ProductDialogData } from './product-dialog';
import { TeamDialog, type TeamDialogData } from './team-dialog';
import { UserDialog, type UserDialogData } from './user-dialog';
import type { AdminUser, Client, Product, ProductCategory, Team } from '../../models';

type User = AdminUser;
type Category = ProductCategory;

interface Lists {
  users: User[];
  teams: Team[];
  clients: Client[];
  categories: Category[];
  products: Product[];
}

const ADD_LABELS = ['Add user', 'Add team', 'Add category', 'Add product'];

/** Back Office settings: people, team structure, product categories and products. */
@Component({
  selector: 'app-settings-page',
  imports: [MatButtonModule, MatCardModule, MatIconModule, MatProgressBarModule, MatTabsModule, Alert],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage {
  private readonly settingsApi = inject(SettingsService);
  private readonly dialog = inject(MatDialog);
  private readonly auth = inject(AuthService);

  protected readonly tab = signal(0);
  /** Everything the tabs show, loaded together; reloaded after every save or delete. */
  private readonly lists = rxResource({
    stream: () =>
      forkJoin({
        users: this.settingsApi.users(),
        teams: this.settingsApi.teams(),
        clients: this.settingsApi.clients(),
        categories: this.settingsApi.categories(),
        products: this.settingsApi.products(),
      }),
  });
  /** The last loaded lists, kept on screen when a reload fails. */
  private readonly loaded = linkedSignal({
    source: this.lists.snapshot,
    computation: (snap, previous?: { value: Lists | null }): Lists | null =>
      snap.status === 'error' ? (previous?.value ?? null) : (snap.value ?? previous?.value ?? null),
  });
  protected readonly users = computed(() => this.loaded()?.users ?? null);
  protected readonly teams = computed(() => this.loaded()?.teams ?? []);
  protected readonly clients = computed(() => this.loaded()?.clients ?? []);
  protected readonly categories = computed(() => this.loaded()?.categories ?? []);
  protected readonly products = computed(() => this.loaded()?.products ?? []);
  protected readonly error = computed(() => {
    const err = this.lists.error();
    return err ? errorText(err, 'Could not load') : null;
  });

  protected readonly addLabel = computed(() => ADD_LABELS[this.tab()]);
  protected readonly usersLabel = computed(() => {
    const users = this.users();
    return `Users${users ? ` (${users.length})` : ''}`;
  });
  private readonly activeWOs = computed(() => (this.users() ?? []).filter((u) => u.role === 'wo' && u.active));
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly money = formatMoney;
  /** The signed-in Back Office user, whose own row has no Delete. */
  protected readonly meId = computed(() => this.auth.user()?.id);

  /** Refetches once the dialog closes with true (saved or deleted). */
  private reloadAfter(ref: MatDialogRef<unknown, boolean>): void {
    ref.afterClosed().subscribe((saved) => {
      if (saved) this.lists.reload();
    });
  }

  protected add(): void {
    [
      () => this.editUser(null),
      () => this.editTeam(null),
      () => this.editCategory(null),
      () => this.editProduct(null),
    ][this.tab()]();
  }

  protected editUser(user: User | null): void {
    const data: UserDialogData = { user, teams: this.teams(), clients: this.clients() };
    const ref = this.dialog.open(UserDialog, { data, width: '600px', maxWidth: '95vw' });
    this.reloadAfter(ref);
  }

  protected editTeam(team: Team | null): void {
    const data: TeamDialogData = { team, wos: this.activeWOs() };
    const ref = this.dialog.open(TeamDialog, { data, width: '444px', maxWidth: '95vw' });
    this.reloadAfter(ref);
  }

  protected editCategory(category: Category | null): void {
    const ref = this.dialog.open(CategoryDialog, { data: category, width: '444px', maxWidth: '95vw' });
    this.reloadAfter(ref);
  }

  protected editProduct(product: Product | null): void {
    const data: ProductDialogData = { product, categories: this.categories() };
    const ref = this.dialog.open(ProductDialog, { data, width: '520px', maxWidth: '95vw' });
    this.reloadAfter(ref);
  }

  protected confirmDelete(kind: DeleteTarget['kind'], item: { id: string; name: string }): void {
    const data: DeleteTarget = { kind, id: item.id, name: item.name };
    const ref = this.dialog.open(DeleteDialog, { data, width: '444px', maxWidth: '95vw' });
    this.reloadAfter(ref);
  }
}
