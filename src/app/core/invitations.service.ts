import { Service, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import type { BuildingRole } from './buildings.service';

export type InvitationStatus = 'pending' | 'accepted' | 'cancelled';

export interface BuildingInvitation {
  id: string;
  email: string;
  role: BuildingRole;
  status: InvitationStatus;
  createdAt: string;
}

export interface InvitationInput {
  email: string;
  role: BuildingRole;
}

@Service()
export class InvitationsService {
  private readonly supabase = inject(SupabaseService).client;
  private readonly auth = inject(AuthService);

  async listForBuilding(buildingId: string): Promise<BuildingInvitation[]> {
    const { data, error } = await this.supabase
      .from('building_invitations')
      .select('id, email, role, status, created_at')
      .eq('building_id', buildingId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data ?? []).map((row) => this.toInvitation(row));
  }

  async invite(buildingId: string, input: InvitationInput): Promise<{ invitation: BuildingInvitation; emailSent: boolean }> {
    const userId = this.auth.user()?.id;
    if (!userId) throw new Error('No hay sesión activa.');

    const email = input.email.trim().toLowerCase();

    const { data, error } = await this.supabase
      .from('building_invitations')
      .insert({
        building_id: buildingId,
        email,
        role: input.role,
        invited_by: userId,
      })
      .select('id, email, role, status, created_at')
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new Error('Ya hay una invitación pendiente para ese mail en este edificio.');
      }
      throw error;
    }

    const invitation = this.toInvitation(data);
    const emailSent = await this.sendInvitationEmail(buildingId, email);

    return { invitation, emailSent };
  }

  private async sendInvitationEmail(buildingId: string, email: string): Promise<boolean> {
    try {
      const { data, error } = await this.supabase.functions.invoke('invite-user', {
        body: { email, buildingId },
      });
      if (error) return false;
      return Boolean(data?.emailSent);
    } catch {
      // si la Edge Function no esta desplegada o falla, la invitacion pendiente ya quedo
      // creada igual: se resuelve sola cuando esa persona entre a la app con ese mail.
      return false;
    }
  }

  private toInvitation(row: {
    id: string;
    email: string;
    role: BuildingRole;
    status: InvitationStatus;
    created_at: string;
  }): BuildingInvitation {
    return {
      id: row.id,
      email: row.email,
      role: row.role,
      status: row.status,
      createdAt: row.created_at,
    };
  }

  async cancel(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('building_invitations')
      .update({ status: 'cancelled' })
      .eq('id', id);

    if (error) throw error;
  }

  async acceptPending(): Promise<void> {
    try {
      await this.supabase.rpc('accept_pending_invitations');
    } catch {
      // no bloqueamos Home si falla aceptar invitaciones
    }
  }
}
