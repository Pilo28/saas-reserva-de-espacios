import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { BuildingsService, type BuildingMembership } from '../../core/buildings.service';
import { NotificationsService } from '../../core/notifications.service';

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  templateUrl: './home.html',
})
export class Home implements OnInit {
  protected readonly auth = inject(AuthService);
  private readonly buildings = inject(BuildingsService);
  private readonly notifications = inject(NotificationsService);
  private readonly router = inject(Router);

  protected readonly items = signal<BuildingMembership[]>([]);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal('');
  protected readonly unreadCount = signal(0);

  ngOnInit(): void {
    this.load();
    this.loadNotifications();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.items.set(await this.buildings.listMine());
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'No se pudo cargar la lista.');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadNotifications(): Promise<void> {
    await this.notifications.checkReminders();
    try {
      this.unreadCount.set(await this.notifications.unreadCount());
    } catch {
      // el contador es informativo; si falla, no bloqueamos el resto de Home
    }
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    this.router.navigateByUrl('/login');
  }
}
