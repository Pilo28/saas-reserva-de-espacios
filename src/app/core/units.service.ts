import { Service, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';

export interface UnitInput {
  floor: string;
  label: string;
}

@Service()
export class UnitsService {
  private readonly supabase = inject(SupabaseService).client;

  /** Busca la unidad (piso+depto) para este edificio, o la crea si no existe. Si ambos
   * campos vienen vacíos, no asigna ninguna unidad (devuelve null). */
  async findOrCreate(buildingId: string, input: UnitInput): Promise<string | null> {
    const floor = input.floor.trim() || null;
    const label = input.label.trim() || floor || '';
    if (!label) return null;

    let query = this.supabase.from('units').select('id').eq('building_id', buildingId).eq('label', label);
    query = floor === null ? query.is('floor', null) : query.eq('floor', floor);

    const { data: existing, error: selectError } = await query.maybeSingle();
    if (selectError) throw selectError;
    if (existing) return existing.id;

    const { data: created, error: insertError } = await this.supabase
      .from('units')
      .insert({ building_id: buildingId, floor, label })
      .select('id')
      .single();

    if (insertError) throw insertError;
    return created.id;
  }
}
