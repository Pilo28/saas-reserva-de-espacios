import { Service, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { asError } from './supabase-error';

export type ReservationStatus = 'confirmed' | 'cancelled';

export interface ReservationSlot {
  id: string;
  starts_at: string;
  ends_at: string;
  status: ReservationStatus;
  userName: string;
  unitInfo: string | null;
}

export interface Reservation {
  id: string;
  building_id: string;
  space_id: string;
  user_id: string;
  starts_at: string;
  ends_at: string;
  status: ReservationStatus;
  guests_count: number | null;
  notes: string | null;
  created_at: string;
}

export interface MyReservation extends Reservation {
  spaceName: string;
  buildingName: string;
}

export interface ReservationInput {
  buildingId: string;
  spaceId: string;
  startsAt: string;
  endsAt: string;
  guestsCount: number | null;
  notes: string;
}

const OVERLAP_ERROR_CODE = '23P01';

@Service()
export class ReservationsService {
  private readonly supabase = inject(SupabaseService).client;
  private readonly auth = inject(AuthService);

  async listSlotsForSpaceOnDate(spaceId: string, buildingId: string, dateStr: string): Promise<ReservationSlot[]> {
    const dayStart = new Date(`${dateStr}T00:00:00`);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const { data, error } = await this.supabase
      .from('reservation_slots')
      .select('id, starts_at, ends_at, status, user_id')
      .eq('space_id', spaceId)
      .gte('starts_at', dayStart.toISOString())
      .lt('starts_at', dayEnd.toISOString())
      .order('starts_at', { ascending: true });

    if (error) throw asError(error);

    const rows = (data ?? []) as { id: string; starts_at: string; ends_at: string; status: ReservationStatus; user_id: string }[];
    const userIds = Array.from(new Set(rows.map((r) => r.user_id)));

    const namesByUserId = new Map<string, string>();
    const unitInfoByUserId = new Map<string, string>();
    if (userIds.length > 0) {
      const profilesRes = await this.supabase.from('profiles').select('id, full_name').in('id', userIds);
      if (profilesRes.error) throw asError(profilesRes.error);
      for (const p of profilesRes.data ?? []) {
        namesByUserId.set(p.id, p.full_name ?? 'Vecino');
      }

      const membersRes = await this.supabase
        .from('building_members')
        .select('user_id, units(floor, label)')
        .eq('building_id', buildingId)
        .in('user_id', userIds);
      if (membersRes.error) throw asError(membersRes.error);
      for (const m of (membersRes.data ?? []) as unknown as {
        user_id: string;
        units: { floor: string | null; label: string } | null;
      }[]) {
        if (!m.units) continue;
        const label = [m.units.floor ? `Piso ${m.units.floor}` : null, `Depto ${m.units.label}`]
          .filter(Boolean)
          .join(', ');
        unitInfoByUserId.set(m.user_id, label);
      }
    }

    return rows.map((r) => ({
      id: r.id,
      starts_at: r.starts_at,
      ends_at: r.ends_at,
      status: r.status,
      userName: namesByUserId.get(r.user_id) ?? 'Vecino',
      unitInfo: unitInfoByUserId.get(r.user_id) ?? null,
    }));
  }

  async create(input: ReservationInput): Promise<Reservation> {
    const userId = this.auth.user()?.id;
    if (!userId) throw new Error('No hay sesión activa.');

    const { data, error } = await this.supabase
      .from('reservations')
      .insert({
        building_id: input.buildingId,
        space_id: input.spaceId,
        user_id: userId,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        guests_count: input.guestsCount,
        notes: input.notes || null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === OVERLAP_ERROR_CODE) {
        throw new Error('Ese horario ya está reservado. Elegí otro.');
      }
      throw asError(error);
    }

    return data as Reservation;
  }

  async listMine(): Promise<MyReservation[]> {
    const userId = this.auth.user()?.id;
    if (!userId) return [];

    const { data, error } = await this.supabase
      .from('reservations')
      .select(
        'id, building_id, space_id, user_id, starts_at, ends_at, status, guests_count, notes, created_at, spaces(name), buildings(name)',
      )
      .eq('user_id', userId)
      .order('starts_at', { ascending: false });

    if (error) throw asError(error);

    return (data ?? []).map((row) => {
      const { spaces, buildings, ...rest } = row as unknown as Reservation & {
        spaces: { name: string } | null;
        buildings: { name: string } | null;
      };
      return {
        ...rest,
        spaceName: spaces?.name ?? '',
        buildingName: buildings?.name ?? '',
      };
    });
  }

  async cancel(id: string): Promise<void> {
    const userId = this.auth.user()?.id;
    if (!userId) throw new Error('No hay sesión activa.');

    const { error } = await this.supabase
      .from('reservations')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: userId })
      .eq('id', id);

    if (error) throw asError(error);
  }
}
