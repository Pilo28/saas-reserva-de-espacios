import { Service, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';

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
  role: BuildingRole;
}

@Service()
export class BuildingsService {
  private readonly supabase = inject(SupabaseService).client;
  private readonly auth = inject(AuthService);

  async listMine(): Promise<BuildingMembership[]> {
    const { data, error } = await this.supabase
      .from('building_members')
      .select('role, buildings(id, name, address, timezone, created_at)')
      .order('created_at', { ascending: false });

    if (error) throw error;

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

    if (error) throw error;
    return data as Building;
  }

  async get(id: string): Promise<Building | null> {
    const { data, error } = await this.supabase
      .from('buildings')
      .select('id, name, address, timezone, created_at')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
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

    if (error) throw error;
    return (data?.role as BuildingRole | undefined) ?? null;
  }

  async listMembers(buildingId: string): Promise<BuildingMember[]> {
    const { data, error } = await this.supabase
      .from('building_members')
      .select('id, user_id, role')
      .eq('building_id', buildingId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    const rows = data ?? [];
    const userIds = Array.from(new Set(rows.map((r) => r.user_id)));

    const namesByUserId = new Map<string, string>();
    if (userIds.length > 0) {
      const profilesRes = await this.supabase.from('profiles').select('id, full_name').in('id', userIds);
      if (profilesRes.error) throw profilesRes.error;
      for (const p of profilesRes.data ?? []) {
        namesByUserId.set(p.id, p.full_name ?? 'Vecino');
      }
    }

    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      fullName: namesByUserId.get(r.user_id) ?? 'Vecino',
      role: r.role as BuildingRole,
    }));
  }

  async update(id: string, patch: BuildingInput): Promise<Building> {
    const { data, error } = await this.supabase
      .from('buildings')
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data as Building;
  }
}
