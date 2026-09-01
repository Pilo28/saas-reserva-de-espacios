import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { NotificationsService, type AppNotification } from '../../../core/notifications.service';

@Component({
  selector: 'app-notifications-list',
  imports: [RouterLink, DatePipe],
  templateUrl: './notifications-list.html',
})
export class NotificationsList implements OnInit {
  protected readonly notifications = inject(NotificationsService);

  protected readonly items = signal<AppNotification[]>([]);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal('');
  protected readonly markingAll = signal(false);

  ngOnInit(): void {
    this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.items.set(await this.notifications.listMine());
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'No se pudo cargar la lista.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async markRead(id: string): Promise<void> {
    try {
      await this.notifications.markRead(id);
      this.items.set(this.items().map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
    } catch {
      // no interrumpimos la lista si falla marcar una sola notificacion
    }
  }

  protected async markAllRead(): Promise<void> {
    this.markingAll.set(true);
    try {
      await this.notifications.markAllRead();
      const now = new Date().toISOString();
      this.items.set(this.items().map((n) => ({ ...n, readAt: n.readAt ?? now })));
    } catch {
      // idem
    } finally {
      this.markingAll.set(false);
    }
  }
}
