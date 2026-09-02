import { Service, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { UnitsService, type UnitInput } from './units.service';
import { asError } from './supabase-error';

export interface Building {
  id: string;
  name: string;
  address: string | null;
  timezone: string;
  created_at: string;
}

export type BuildingRole = 'admin' | 'resident';

export interface BuildingMembership extends Building {
  role: BuildingRole;
}

export interface BuildingInput {
  name: string;
  address: string;
  timezone: string;
}

export interface BuildingMember {
  id: string;
  userId: string;
  fullName: string;
  email: string | null;
  role: BuildingRole;
  floor: string | null;
  unitLabel: string | null;
}

@Service()
export class BuildingsService {
  private readonly supabase = inject(SupabaseService).client;
  private readonly auth = inject(AuthService);
  private readonly units = inject(UnitsService);

  async listMine(): Promise<BuildingMembership[]> {
    const userId = this.auth.user()?.id;
    if (!userId) return [];

    const { data, error } = await this.supabase
      .from('building_members')
      .select('role, buildings(id, name, address, timezone, created_at)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw asError(error);

    return (data ?? [])
      .filter((row) => row.buildings)
      .map((row) => ({
        ...(row.buildings as unknown as Building),
        role: row.role as BuildingRole,
      }));
  }

  async create(input: BuildingInput): Promise<Building> {
    const userId = this.auth.user()?.id;
    if (!userId) throw new Error('No hay sesión activa.');

    const { data, error } = await this.supabase
      .from('buildings')
      .insert({ ...input, created_by: userId })
      .select()
      .single();

    if (error) throw asError(error);
    return data as Building;
  }

  async get(id: string): Promise<Building | null> {
    const { data, error } = await this.supabase
      .from('buildings')
      .select('id, name, address, timezone, created_at')
      .eq('id', id)
      .maybeSingle();

    if (error) throw asError(error);
    return data as Building | null;
  }

  async getMyRole(buildingId: string): Promise<BuildingRole | null> {
    const userId = this.auth.user()?.id;
    if (!userId) return null;

    const { data, error } = await this.supabase
      .from('building_members')
      .select('role')
      .eq('building_id', buildingId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw asError(error);
    return (data?.role as BuildingRole | undefined) ?? null;
  }

  async listMembers(buildingId: string): Promise<BuildingMember[]> {
    const { data, error } = await this.supabase
      .from('building_members')
      .select('id, user_id, role, units(floor, label)')
      .eq('building_id', buildingId)
      .order('created_at', { ascending: true });

    if (error) throw asError(error);

    const rows = (data ?? []) as unknown as {
      id: string;
      user_id: string;
      role: BuildingRole;
      units: { floor: string | null; label: string } | null;
    }[];
    const userIds = Array.from(new Set(rows.map((r) => r.user_id)));

    const namesByUserId = new Map<string, string>();
    if (userIds.length > 0) {
      const profilesRes = await this.supabase.from('profiles').select('id, full_name').in('id', userIds);
      if (profilesRes.error) throw asError(profilesRes.error);
      for (const p of profilesRes.data ?? []) {
        namesByUserId.set(p.id, p.full_name ?? 'Vecino');
      }
    }

    const emailsByUserId = new Map<string, string>();
    try {
      const { data: emailRows } = await this.supabase.rpc('get_building_member_emails', {
        target_building_id: buildingId,
      });
      for (const row of (emailRows ?? []) as { user_id: string; email: string }[]) {
        emailsByUserId.set(row.user_id, row.email);
      }
    } catch {
      // solo el admin puede leer mails; si falla (no admin), se muestra sin mail
    }

    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      fullName: namesByUserId.get(r.user_id) ?? 'Vecino',
      email: emailsByUserId.get(r.user_id) ?? null,
      role: r.role,
      floor: r.units?.floor ?? null,
      unitLabel: r.units?.label ?? null,
    }));
  }

  async removeMember(memberId: string): Promise<void> {
    const { error } = await this.supabase.from('building_members').delete().eq('id', memberId);
    if (error) throw asError(error);
  }

  async updateMemberUnit(memberId: string, buildingId: string, unit: UnitInput): Promise<void> {
    const unitId = await this.units.findOrCreate(buildingId, unit);
    const { error } = await this.supabase.from('building_members').update({ unit_id: unitId }).eq('id', memberId);
    if (error) throw asError(error);
  }

  async updateMemberEmail(buildingId: string, memberId: string, newEmail: string): Promise<void> {
    const { data, error } = await this.supabase.functions.invoke('update-member-email', {
      body: { buildingId, memberId, newEmail },
    });

    if (error) throw asError(error);
    if (data?.error) throw new Error(data.error);
  }

  async update(id: string, patch: BuildingInput): Promise<Building> {
    const { data, error } = await this.supabase
      .from('buildings')
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error) throw asError(error);
    return data as Building;
  }
}
