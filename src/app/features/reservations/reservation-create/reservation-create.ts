import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, Validators, NonNullableFormBuilder } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ReservationsService, type ReservationSlot } from '../../../core/reservations.service';
import { SpacesService, type SpaceRules } from '../../../core/spaces.service';

function todayDateString(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

@Component({
  selector: 'app-reservation-create',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './reservation-create.html',
})
export class ReservationCreate {
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly reservations = inject(ReservationsService);
  private readonly spacesService = inject(SpacesService);
  private readonly router = inject(Router);

  protected readonly buildingId = this.route.snapshot.paramMap.get('id')!;
  protected readonly spaceId = this.route.snapshot.paramMap.get('spaceId')!;

  protected readonly form = this.fb.group({
    date: [todayDateString(), [Validators.required]],
    startTime: ['18:00', [Validators.required]],
    endTime: ['22:00', [Validators.required]],
    guestsCount: this.fb.control<number | null>(null),
    notes: [''],
  });

  protected readonly slots = signal<ReservationSlot[]>([]);
  protected readonly loadingSlots = signal(false);
  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly rules = signal<SpaceRules | null>(null);

  constructor() {
    this.loadSlots();
    this.loadRules();
    this.form.controls.date.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.loadSlots());
  }

  private async loadRules(): Promise<void> {
    try {
      this.rules.set(await this.spacesService.getRules(this.spaceId));
    } catch {
      // el cartel de reglas es informativo; si falla, igual se puede intentar reservar
    }
  }

  protected hasVisibleRules(): boolean {
    const r = this.rules();
    if (!r) return false;
    return (
      r.max_active_reservations_per_user !== null ||
      r.min_advance_hours !== null ||
      r.max_advance_days !== null ||
      r.max_duration_hours !== null ||
      r.min_cancellation_hours !== null
    );
  }

  private async loadSlots(): Promise<void> {
    const date = this.form.controls.date.value;
    if (!date) return;

    this.loadingSlots.set(true);
    try {
      this.slots.set(await this.reservations.listSlotsForSpaceOnDate(this.spaceId, this.buildingId, date));
    } catch {
      // no bloqueamos el formulario si falla la vista previa de ocupacion
    } finally {
      this.loadingSlots.set(false);
    }
  }

  protected slotTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { date, startTime, endTime, guestsCount, notes } = this.form.getRawValue();
    const startsAt = new Date(`${date}T${startTime}:00`);
    const endsAt = new Date(`${date}T${endTime}:00`);

    if (endsAt <= startsAt) {
      this.errorMessage.set('El horario de fin debe ser posterior al de inicio.');
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set('');

    try {
      await this.reservations.create({
        buildingId: this.buildingId,
        spaceId: this.spaceId,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        guestsCount,
        notes,
      });
      this.router.navigate(['/reservations']);
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'No se pudo crear la reserva.');
    } finally {
      this.submitting.set(false);
    }
  }
}
