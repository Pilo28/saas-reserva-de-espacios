import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ReactiveFormsModule, Validators, NonNullableFormBuilder } from '@angular/forms';
import { SpacesService, type SpaceRules, type SpaceSchedule } from '../../../core/spaces.service';
import { BuildingsService } from '../../../core/buildings.service';

@Component({
  selector: 'app-space-detail',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './space-detail.html',
})
export class SpaceDetail implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly buildingsService = inject(BuildingsService);
  protected readonly spacesService = inject(SpacesService);

  protected readonly buildingId = this.route.snapshot.paramMap.get('id')!;
  protected readonly spaceId = this.route.snapshot.paramMap.get('spaceId')!;

  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);
  protected readonly isAdmin = signal(false);
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly errorMessage = signal('');

  protected readonly form = this.fb.group({
    name: ['', [Validators.required]],
    description: [''],
    capacity: this.fb.control<number | null>(null),
    isActive: [true],
  });

  protected readonly schedules = signal<SpaceSchedule[]>([]);
  protected readonly weekdays = [0, 1, 2, 3, 4, 5, 6];

  protected readonly scheduleForm = this.fb.group({
    weekday: [1, [Validators.required]],
    opensAt: ['09:00', [Validators.required]],
    closesAt: ['22:00', [Validators.required]],
  });

  protected readonly addingSchedule = signal(false);
  protected readonly scheduleError = signal('');

  protected readonly rulesForm = this.fb.group({
    maxActiveReservationsPerUser: this.fb.control<number | null>(null),
    minAdvanceHours: this.fb.control<number | null>(null),
    maxAdvanceDays: this.fb.control<number | null>(null),
    maxDurationHours: this.fb.control<number | null>(null),
    minCancellationHours: this.fb.control<number | null>(null),
  });

  protected readonly rulesSaving = signal(false);
  protected readonly rulesSaved = signal(false);
  protected readonly rulesError = signal('');

  async ngOnInit(): Promise<void> {
    try {
      const [space, role] = await Promise.all([
        this.spacesService.get(this.spaceId),
        this.buildingsService.getMyRole(this.buildingId),
      ]);
      if (!space) {
        this.notFound.set(true);
        return;
      }

      this.isAdmin.set(role === 'admin');

      this.form.patchValue({
        name: space.name,
        description: space.description ?? '',
        capacity: space.capacity,
        isActive: space.is_active,
      });

      if (!this.isAdmin()) {
        this.form.disable();
      }

      this.schedules.set(await this.spacesService.listSchedules(this.spaceId));

      if (this.isAdmin()) {
        const rules = await this.spacesService.getRules(this.spaceId);
        if (rules) {
          this.rulesForm.patchValue({
            maxActiveReservationsPerUser: rules.max_active_reservations_per_user,
            minAdvanceHours: rules.min_advance_hours,
            maxAdvanceDays: rules.max_advance_days,
            maxDurationHours: rules.max_duration_hours,
            minCancellationHours: rules.min_cancellation_hours,
          });
        }
      }
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'No se pudo cargar el espacio.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.saved.set(false);
    this.errorMessage.set('');

    try {
      await this.spacesService.update(this.spaceId, this.form.getRawValue());
      this.saved.set(true);
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'No se pudo guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  protected async addSchedule(): Promise<void> {
    if (this.scheduleForm.invalid) {
      this.scheduleForm.markAllAsTouched();
      return;
    }

    const { weekday, opensAt, closesAt } = this.scheduleForm.getRawValue();
    if (opensAt >= closesAt) {
      this.scheduleError.set('El horario de cierre debe ser posterior al de apertura.');
      return;
    }

    this.addingSchedule.set(true);
    this.scheduleError.set('');

    try {
      await this.spacesService.addSchedule(this.buildingId, this.spaceId, { weekday, opensAt, closesAt });
      this.schedules.set(await this.spacesService.listSchedules(this.spaceId));
    } catch (error) {
      this.scheduleError.set(error instanceof Error ? error.message : 'No se pudo agregar el horario.');
    } finally {
      this.addingSchedule.set(false);
    }
  }

  protected async removeSchedule(id: string): Promise<void> {
    try {
      await this.spacesService.removeSchedule(id);
      this.schedules.set(this.schedules().filter((s) => s.id !== id));
    } catch (error) {
      this.scheduleError.set(error instanceof Error ? error.message : 'No se pudo quitar el horario.');
    }
  }

  protected async saveRules(): Promise<void> {
    this.rulesSaving.set(true);
    this.rulesSaved.set(false);
    this.rulesError.set('');

    try {
      await this.spacesService.saveRules(this.buildingId, this.spaceId, this.rulesForm.getRawValue());
      this.rulesSaved.set(true);
    } catch (error) {
      this.rulesError.set(error instanceof Error ? error.message : 'No se pudieron guardar las reglas.');
    } finally {
      this.rulesSaving.set(false);
    }
  }
}
