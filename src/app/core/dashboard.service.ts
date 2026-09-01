import { Service, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface DashboardReservation {
  id: string;
  spaceId: string;
  spaceName: string;
  userName: string;
  userEmail: string | null;
  unitInfo: string | null;
  startsAt: string;
  endsAt: string;
  guestsCount: number | null;
}

export interface DashboardCancellation {
  id: string;
  spaceName: string;
  userName: string;
  userEmail: string | null;
  unitInfo: string | null;
  cancelledAt: string;
}

export interface DashboardSummary {
  activeSpacesCount: number;
  occupiedSpacesCount: number;
  todayReservations: DashboardReservation[];
  upcomingReservations: DashboardReservation[];
  cancelledToday: DashboardCancellation[];
  startingSoon: DashboardReservation[];
}

function startOfDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

@Service()
export class DashboardService {
  private readonly supabase = inject(SupabaseService).client;

  async getSummary(buildingId: string): Promise<DashboardSummary> {
    const now = new Date();
    const todayStart = startOfDay(now);
    const tomorrowStart = addDays(todayStart, 1);
    const weekEnd = addDays(todayStart, 7);

    const [spacesRes, upcomingRes, cancelledRes] = await Promise.all([
      this.supabase.from('spaces').select('id').eq('building_id', buildingId).eq('is_active', true),
      this.supabase
        .from('reservations')
        .select('id, space_id, user_id, starts_at, ends_at, guests_count, spaces(name)')
        .eq('building_id', buildingId)
        .eq('status', 'confirmed')
        .gte('starts_at', todayStart.toISOString())
        .lt('starts_at', weekEnd.toISOString())
        .order('starts_at', { ascending: true }),
      this.supabase
        .from('reservations')
        .select('id, user_id, cancelled_at, spaces(name)')
        .eq('building_id', buildingId)
        .eq('status', 'cancelled')
        .gte('cancelled_at', todayStart.toISOString())
        .lt('cancelled_at', tomorrowStart.toISOString())
        .order('cancelled_at', { ascending: false }),
    ]);

    if (spacesRes.error) throw spacesRes.error;
    if (upcomingRes.error) throw upcomingRes.error;
    if (cancelledRes.error) throw cancelledRes.error;

    type ReservationRow = {
      id: string;
      space_id: string;
      user_id: string;
      starts_at: string;
      ends_at: string;
      guests_count: number | null;
      spaces: { name: string } | null;
    };
    type CancellationRow = {
      id: string;
      user_id: string;
      cancelled_at: string;
      spaces: { name: string } | null;
    };

    const reservationRows = (upcomingRes.data ?? []) as unknown as ReservationRow[];
    const cancellationRows = (cancelledRes.data ?? []) as unknown as CancellationRow[];

    const userIds = Array.from(
      new Set([...reservationRows.map((r) => r.user_id), ...cancellationRows.map((r) => r.user_id)]),
    );

    const namesByUserId = new Map<string, string>();
    const unitInfoByUserId = new Map<string, string>();
    const emailsByUserId = new Map<string, string>();
    if (userIds.length > 0) {
      const profilesRes = await this.supabase.from('profiles').select('id, full_name').in('id', userIds);
      if (profilesRes.error) throw profilesRes.error;
      for (const row of profilesRes.data ?? []) {
        namesByUserId.set(row.id, row.full_name ?? 'Vecino');
      }

      const membersRes = await this.supabase
        .from('building_members')
        .select('user_id, units(floor, label)')
        .eq('building_id', buildingId)
        .in('user_id', userIds);
      if (membersRes.error) throw membersRes.error;
      for (const row of (membersRes.data ?? []) as unknown as {
        user_id: string;
        units: { floor: string | null; label: string } | null;
      }[]) {
        if (!row.units) continue;
        const label = [row.units.floor ? `Piso ${row.units.floor}` : null, `Depto ${row.units.label}`]
          .filter(Boolean)
          .join(', ');
        unitInfoByUserId.set(row.user_id, label);
      }

      try {
        const { data: emailRows } = await this.supabase.rpc('get_building_member_emails', {
          target_building_id: buildingId,
        });
        for (const row of (emailRows ?? []) as { user_id: string; email: string }[]) {
          emailsByUserId.set(row.user_id, row.email);
        }
      } catch {
        // si la funcion todavia no esta migrada, el panel igual funciona sin el mail
      }
    }

    const toReservation = (row: ReservationRow): DashboardReservation => ({
      id: row.id,
      spaceId: row.space_id,
      spaceName: row.spaces?.name ?? '',
      userName: namesByUserId.get(row.user_id) ?? 'Vecino',
      userEmail: emailsByUserId.get(row.user_id) ?? null,
      unitInfo: unitInfoByUserId.get(row.user_id) ?? null,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      guestsCount: row.guests_count,
    });

    const allReservations = reservationRows.map(toReservation);
    const todayReservations = allReservations.filter((r) => new Date(r.startsAt) < tomorrowStart);
    const upcomingReservations = allReservations.filter((r) => new Date(r.startsAt) >= tomorrowStart);

    const oneHourFromNow = new Date(now.getTime() + 60 * 60_000);
    const startingSoon = todayReservations.filter((r) => {
      const startsAt = new Date(r.startsAt);
      return startsAt > now && startsAt <= oneHourFromNow;
    });

    const occupiedSpaceIds = new Set(
      reservationRows
        .filter((row) => new Date(row.starts_at) <= now && new Date(row.ends_at) > now)
        .map((row) => row.space_id),
    );

    const cancelledToday = cancellationRows.map((row) => ({
      id: row.id,
      spaceName: row.spaces?.name ?? '',
      userName: namesByUserId.get(row.user_id) ?? 'Vecino',
      userEmail: emailsByUserId.get(row.user_id) ?? null,
      unitInfo: unitInfoByUserId.get(row.user_id) ?? null,
      cancelledAt: row.cancelled_at,
    }));

    return {
      activeSpacesCount: spacesRes.data?.length ?? 0,
      occupiedSpacesCount: occupiedSpaceIds.size,
      todayReservations,
      upcomingReservations,
      cancelledToday,
      startingSoon,
    };
  }
}
