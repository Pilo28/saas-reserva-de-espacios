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
    floor: [''],
    unitLabel: [''],
  });

  protected readonly inviting = signal(false);
  protected readonly inviteError = signal('');
  protected readonly inviteSuccess = signal('');

  protected readonly unitForm = this.fb.group({
    floor: [''],
    unitLabel: [''],
  });
  protected readonly editingMemberId = signal<string | null>(null);
  protected readonly editingInvitationId = signal<string | null>(null);
  protected readonly savingUnit = signal(false);
  protected readonly unitError = signal('');

  protected readonly confirmDialog = signal<{
    title: string;
    message: string;
    confirmLabel: string;
    action: () => Promise<void>;
  } | null>(null);
  protected readonly confirming = signal(false);
  protected readonly confirmError = signal('');

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

  protected unitLabel(floor: string | null, unitLabel: string | null): string {
    if (!floor && !unitLabel) return 'Sin unidad asignada';
    return [floor ? `Piso ${floor}` : null, unitLabel ? `Depto ${unitLabel}` : null].filter(Boolean).join(', ');
  }

  protected async invite(): Promise<void> {
    if (this.inviteForm.invalid) {
      this.inviteForm.markAllAsTouched();
      return;
    }

    this.inviting.set(true);
    this.inviteError.set('');
    this.inviteSuccess.set('');

    try {
      const { emailSent } = await this.invitationsService.invite(this.buildingId, this.inviteForm.getRawValue());
      this.inviteSuccess.set(
        emailSent
          ? 'Le mandamos un mail con el link para registrarse.'
          : 'Invitación guardada. Como no se pudo mandar el mail (o ya tenía cuenta), avisale vos: en cuanto entre a la app con ese mail, se suma solo.',
      );
      this.inviteForm.reset({ email: '', role: 'resident', floor: '', unitLabel: '' });
      await this.loadAll();
    } catch (error) {
      this.inviteError.set(error instanceof Error ? error.message : 'No se pudo enviar la invitación.');
    } finally {
      this.inviting.set(false);
    }
  }

  protected askCancelInvitation(id: string, email: string): void {
    this.confirmDialog.set({
      title: 'Cancelar invitación',
      message: `¿Seguro que querés cancelar la invitación a ${email}?`,
      confirmLabel: 'Cancelar invitación',
      action: async () => {
        await this.invitationsService.cancel(id);
        this.invitations.set(this.invitations().filter((i) => i.id !== id));
      },
    });
  }

  protected askRemoveMember(member: BuildingMember): void {
    this.confirmDialog.set({
      title: 'Quitar vecino',
      message: `¿Seguro que querés quitar a ${member.fullName} de este edificio? Va a perder el acceso, pero sus reservas pasadas quedan igual.`,
      confirmLabel: 'Quitar',
      action: async () => {
        await this.buildingsService.removeMember(member.id);
        this.members.set(this.members().filter((m) => m.id !== member.id));
      },
    });
  }

  protected async confirmAction(): Promise<void> {
    const dialog = this.confirmDialog();
    if (!dialog) return;

    this.confirming.set(true);
    this.confirmError.set('');

    try {
      await dialog.action();
      this.confirmDialog.set(null);
    } catch (error) {
      this.confirmError.set(error instanceof Error ? error.message : 'No se pudo completar la acción.');
    } finally {
      this.confirming.set(false);
    }
  }

  protected cancelConfirm(): void {
    this.confirmDialog.set(null);
    this.confirmError.set('');
  }

  protected startEditMemberUnit(member: BuildingMember): void {
    this.editingInvitationId.set(null);
    this.editingMemberId.set(member.id);
    this.unitError.set('');
    this.unitForm.reset({ floor: member.floor ?? '', unitLabel: member.unitLabel ?? '' });
  }

  protected startEditInvitationUnit(invitation: BuildingInvitation): void {
    this.editingMemberId.set(null);
    this.editingInvitationId.set(invitation.id);
    this.unitError.set('');
    this.unitForm.reset({ floor: invitation.floor ?? '', unitLabel: invitation.unitLabel ?? '' });
  }

  protected cancelEditUnit(): void {
    this.editingMemberId.set(null);
    this.editingInvitationId.set(null);
    this.unitError.set('');
  }

  protected async saveUnit(): Promise<void> {
    const memberId = this.editingMemberId();
    const invitationId = this.editingInvitationId();
    if (!memberId && !invitationId) return;

    this.savingUnit.set(true);
    this.unitError.set('');

    try {
      const { floor, unitLabel } = this.unitForm.getRawValue();
      const unit = { floor, label: unitLabel };
      if (memberId) {
        await this.buildingsService.updateMemberUnit(memberId, this.buildingId, unit);
      } else if (invitationId) {
        await this.invitationsService.updateUnit(invitationId, this.buildingId, unit);
      }
      this.cancelEditUnit();
      await this.loadAll();
    } catch (error) {
      this.unitError.set(error instanceof Error ? error.message : 'No se pudo guardar la unidad.');
    } finally {
      this.savingUnit.set(false);
    }
  }
}
