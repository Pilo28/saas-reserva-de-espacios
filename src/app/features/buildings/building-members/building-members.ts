import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ReactiveFormsModule, Validators, NonNullableFormBuilder } from '@angular/forms';
import { BuildingsService, type BuildingMember } from '../../../core/buildings.service';
import { InvitationsService, type BuildingInvitation } from '../../../core/invitations.service';

@Component({
  selector: 'app-building-members',
  imports: [RouterLink, ReactiveFormsModule],
  templateUrl: './building-members.html',
})
export class BuildingMembers implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly buildingsService = inject(BuildingsService);
  private readonly invitationsService = inject(InvitationsService);

  protected readonly buildingId = this.route.snapshot.paramMap.get('id')!;

  protected readonly loading = signal(true);
  protected readonly forbidden = signal(false);
  protected readonly errorMessage = signal('');

  protected readonly members = signal<BuildingMember[]>([]);
  protected readonly invitations = signal<BuildingInvitation[]>([]);

  protected readonly inviteForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    role: this.fb.control<'admin' | 'resident'>('resident'),
  });

  protected readonly inviting = signal(false);
  protected readonly inviteError = signal('');

  async ngOnInit(): Promise<void> {
    try {
      const role = await this.buildingsService.getMyRole(this.buildingId);
      if (role !== 'admin') {
        this.forbidden.set(true);
        return;
      }

      await this.loadAll();
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'No se pudo cargar la lista.');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadAll(): Promise<void> {
    const [members, invitations] = await Promise.all([
      this.buildingsService.listMembers(this.buildingId),
      this.invitationsService.listForBuilding(this.buildingId),
    ]);
    this.members.set(members);
    this.invitations.set(invitations.filter((i) => i.status === 'pending'));
  }

  protected async invite(): Promise<void> {
    if (this.inviteForm.invalid) {
      this.inviteForm.markAllAsTouched();
      return;
    }

    this.inviting.set(true);
    this.inviteError.set('');

    try {
      await this.invitationsService.invite(this.buildingId, this.inviteForm.getRawValue());
      this.inviteForm.reset({ email: '', role: 'resident' });
      await this.loadAll();
    } catch (error) {
      this.inviteError.set(error instanceof Error ? error.message : 'No se pudo enviar la invitación.');
    } finally {
      this.inviting.set(false);
    }
  }

  protected async cancelInvitation(id: string): Promise<void> {
    try {
      await this.invitationsService.cancel(id);
      this.invitations.set(this.invitations().filter((i) => i.id !== id));
    } catch (error) {
      this.inviteError.set(error instanceof Error ? error.message : 'No se pudo cancelar la invitación.');
    }
  }
}
