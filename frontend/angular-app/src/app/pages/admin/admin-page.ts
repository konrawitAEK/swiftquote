import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { firstValueFrom } from 'rxjs';
import { Alert } from '../../components/alert';
import { ApiService, errorText, type Schemas } from '../../core/api.service';
import { ROLE_LABELS } from '../../core/roles';
import { CategoryDialog } from './category-dialog';
import { TeamDialog, type TeamDialogData } from './team-dialog';
import { UserDialog, type UserDialogData } from './user-dialog';

type User = Schemas['AdminUser'];
type Team = Schemas['Team'];
type Client = Schemas['Client'];
type Category = Schemas['ProductCategory'];

const ADD_LABELS = ['Add user', 'Add team', 'Add category'];

/** Admin: people, team structure and product categories. */
@Component({
  selector: 'app-admin-page',
  imports: [MatButtonModule, MatCardModule, MatIconModule, MatProgressBarModule, MatTabsModule, Alert],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-page.html',
  styleUrl: './admin-page.scss',
})
export class AdminPage {
  private readonly api = inject(ApiService);
  private readonly dialog = inject(MatDialog);

  protected readonly tab = signal(0);
  protected readonly users = signal<User[] | null>(null);
  protected readonly teams = signal<Team[]>([]);
  protected readonly clients = signal<Client[]>([]);
  protected readonly categories = signal<Category[]>([]);
  protected readonly error = signal<string | null>(null);
  /** Bumped after every save to refetch. */
  private readonly version = signal(0);

  protected readonly addLabel = computed(() => ADD_LABELS[this.tab()]);
  protected readonly usersLabel = computed(() => {
    const users = this.users();
    return `Users${users ? ` (${users.length})` : ''}`;
  });
  private readonly activeWOs = computed(() => (this.users() ?? []).filter((u) => u.role === 'wo' && u.active));
  protected readonly roleLabels = ROLE_LABELS;

  constructor() {
    effect((onCleanup) => {
      this.version();
      let cancelled = false;
      onCleanup(() => (cancelled = true));
      Promise.all([this.api.listUsers(), this.api.listTeams(), this.api.listClients(), this.api.listCategories()])
        .then(([users, teams, clients, categories]) => {
          if (cancelled) return;
          this.users.set(users);
          this.teams.set(teams);
          this.clients.set(clients);
          this.categories.set(categories);
        })
        .catch((err: unknown) => !cancelled && this.error.set(errorText(err, 'Could not load')));
    });
  }

  private reloadAfter(closed: Promise<boolean | undefined>): void {
    void closed.then((saved) => saved && this.version.update((v) => v + 1));
  }

  protected add(): void {
    [() => this.editUser(null), () => this.editTeam(null), () => this.editCategory(null)][this.tab()]();
  }

  protected editUser(user: User | null): void {
    const data: UserDialogData = { user, teams: this.teams(), clients: this.clients() };
    const ref = this.dialog.open(UserDialog, { data, width: '600px', maxWidth: '95vw' });
    this.reloadAfter(firstValueFrom(ref.afterClosed()));
  }

  protected editTeam(team: Team | null): void {
    const data: TeamDialogData = { team, wos: this.activeWOs() };
    const ref = this.dialog.open(TeamDialog, { data, width: '444px', maxWidth: '95vw' });
    this.reloadAfter(firstValueFrom(ref.afterClosed()));
  }

  protected editCategory(category: Category | null): void {
    const ref = this.dialog.open(CategoryDialog, { data: category, width: '444px', maxWidth: '95vw' });
    this.reloadAfter(firstValueFrom(ref.afterClosed()));
  }
}
