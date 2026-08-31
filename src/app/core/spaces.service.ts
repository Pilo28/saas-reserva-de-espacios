import { Service, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface Space {
  id: string;
  building_id: string;
  name: string;
  description: string | null;
  capacity: number | null;
  is_active: boolean;
  created_at: string;
}

export interface SpaceInput {
  name: string;
  description: string;
  capacity: number | null;
}

export interface SpaceSchedule {
  id: string;
  space_id: string;
  weekday: number;
  opens_at: string;
  closes_at: string;
}

export interface SpaceScheduleInput {
  weekday: number;
  opensAt: string;
  closesAt: string;
}

const WEEKDAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

@Service()
export class SpacesService {
  private readonly supabase = inject(SupabaseService).client;

  weekdayLabel(weekday: number): string {
    return WEEKDAY_LABELS[weekday] ?? '';
  }

  async listForBuilding(buildingId: string): Promise<Space[]> {
    const { data, error } = await this.supabase
      .from('spaces')
      .select('id, building_id, name, description, capacity, is_active, created_at')
      .eq('building_id', buildingId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data ?? []) as Space[];
  }

  async create(buildingId: string, input: SpaceInput): Promise<Space> {
    const { data, error } = await this.supabase
      .from('spaces')
      .insert({
        building_id: buildingId,
        name: input.name,
        description: input.description || null,
        capacity: input.capacity,
      })
      .select()
      .single();

    if (error) throw error;
    return data as Space;
  }

  async get(id: string): Promise<Space | null> {
    const { data, error } = await this.supabase
      .from('spaces')
      .select('id, building_id, name, description, capacity, is_active, created_at')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    return data as Space | null;
  }

  async update(id: string, patch: SpaceInput & { isActive: boolean }): Promise<Space> {
    const { data, error } = await this.supabase
      .from('spaces')
      .update({
        name: patch.name,
        description: patch.description || null,
        capacity: patch.capacity,
        is_active: patch.isActive,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data as Space;
  }

  async listSchedules(spaceId: string): Promise<SpaceSchedule[]> {
    const { data, error } = await this.supabase
      .from('space_schedules')
      .select('id, space_id, weekday, opens_at, closes_at')
      .eq('space_id', spaceId)
      .order('weekday', { ascending: true })
      .order('opens_at', { ascending: true });

    if (error) throw error;
    return (data ?? []) as SpaceSchedule[];
  }

  async addSchedule(
    buildingId: string,
    spaceId: string,
    input: SpaceScheduleInput,
  ): Promise<SpaceSchedule> {
    const { data, error } = await this.supabase
      .from('space_schedules')
      .insert({
        building_id: buildingId,
        space_id: spaceId,
        weekday: input.weekday,
        opens_at: input.opensAt,
        closes_at: input.closesAt,
      })
      .select()
      .single();

    if (error) throw error;
    return data as SpaceSchedule;
  }

  async removeSchedule(id: string): Promise<void> {
    const { error } = await this.supabase.from('space_schedules').delete().eq('id', id);
    if (error) throw error;
  }
}
