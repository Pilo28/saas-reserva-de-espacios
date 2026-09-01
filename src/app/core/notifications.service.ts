import { Service, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';

export type NotificationType = 'reservation_created' | 'reservation_cancelled' | 'reservation_reminder';

export interface AppNotification {
  id: string;
  type: NotificationType;
  readAt: string | null;
  createdAt: string;
  spaceName: string;
  buildingName: string;
  startsAt: string;
  endsAt: string;
}

type NotificationRow = {
  id: string;
  type: NotificationType;
  read_at: string | null;
  created_at: string;
  reservations: {
    starts_at: string;
    ends_at: string;
    spaces: { name: string } | null;
    buildings: { name: string } | null;
  } | null;
};

@Service()
export class NotificationsService {
  private readonly supabase = inject(SupabaseService).client;

  async checkReminders(): Promise<void> {
    try {
      await this.supabase.rpc('generate_reservation_reminders');
    } catch {
      // no bloqueamos la carga de la app si falla el chequeo de recordatorios
    }
  }

  async listMine(): Promise<AppNotification[]> {
    const { data, error } = await this.supabase
      .from('notifications')
      .select('id, type, read_at, created_at, reservations(starts_at, ends_at, spaces(name), buildings(name))')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    return (data ?? []).map((row) => {
      const r = row as unknown as NotificationRow;
      return {
        id: r.id,
        type: r.type,
        readAt: r.read_at,
        createdAt: r.created_at,
        spaceName: r.reservations?.spaces?.name ?? '',
        buildingName: r.reservations?.buildings?.name ?? '',
        startsAt: r.reservations?.starts_at ?? '',
        endsAt: r.reservations?.ends_at ?? '',
      };
    });
  }

  async unreadCount(): Promise<number> {
    const { count, error } = await this.supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null);

    if (error) throw error;
    return count ?? 0;
  }

  async markRead(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;
  }

  async markAllRead(): Promise<void> {
    const { error } = await this.supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .is('read_at', null);

    if (error) throw error;
  }

  messageFor(n: AppNotification): string {
    switch (n.type) {
      case 'reservation_created':
        return `Reservaste ${n.spaceName} en ${n.buildingName}.`;
      case 'reservation_cancelled':
        return `Se canceló tu reserva de ${n.spaceName} en ${n.buildingName}.`;
      case 'reservation_reminder':
        return `Tu reserva de ${n.spaceName} en ${n.buildingName} empieza pronto.`;
    }
  }
}
