import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, Validators, NonNullableFormBuilder } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ReservationsService, type Reservation, type ReservationSlot } from '../../../core/reservations.service';
import { SpacesService, type SpaceRules, type SpaceSchedule } from '../../../core/spaces.service';

function todayDateString(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
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
    guestsCount: this.fb.control<number | null>(null),
    notes: [''],
  });

  protected readonly slots = signal<ReservationSlot[]>([]);
  protected readonly loadingSlots = signal(false);
  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly rules = signal<SpaceRules | null>(null);
  protected readonly myActiveReservations = signal<Reservation[]>([]);
  protected readonly schedules = signal<SpaceSchedule[] | null>(null);

  // Solo importa cuando el dia elegido tiene mas de un horario configurado -- ahi hay que
  // elegir cual. Si el dia tiene uno solo (el caso comun), se usa directo sin preguntar.
  protected readonly selectedScheduleId = signal<string | null>(null);

  // La regla "maximo de reservas activas" no es por dia: cuenta cualquier reserva
  // confirmada y no terminada del usuario en este espacio, sin importar la fecha. Si ya
  // llego al limite, conviene avisarle y bloquear el boton antes de que elija una fecha
  // sin conflicto y se encuentre con el rechazo recien al confirmar.
  protected readonly blockingReservations = computed(() => {
    const max = this.rules()?.max_active_reservations_per_user;
    if (max === null || max === undefined) return [];
    const active = this.myActiveReservations();
    return active.length >= max ? active : [];
  });

  private readonly formValue = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  // El vecino ya no elige un horario libre: reserva es SIEMPRE la ventana que configuro el
  // admin para ese dia (Fase 5). Si el dia tiene varias ventanas cargadas, se elige una; si
  // tiene una sola, se usa esa directo.
  protected readonly daySchedules = computed(() => {
    const schedules = this.schedules();
    const date = this.formValue().date;
    if (!schedules || !date) return [];
    const weekday = new Date(`${date}T00:00:00`).getDay();
    return schedules.filter((s) => s.weekday === weekday);
  });

  protected readonly selectedSchedule = computed(() => {
    const options = this.daySchedules();
    if (options.length === 0) return null;
    const manual = options.find((s) => s.id === this.selectedScheduleId());
    return manual ?? options[0];
  });

  // Chequeo proactivo (mismo criterio que ahora aplica la base con
  // enforce_reservation_schedule): sin esto, el vecino elegia una fecha sin horario
  // configurado y recien se enteraba al confirmar.
  protected readonly scheduleWarning = computed(() => {
    const schedules = this.schedules();
    if (schedules === null) return null;

    if (schedules.length === 0) {
      return 'Este espacio todavía no tiene horarios de disponibilidad configurados. Pedile al administrador que cargue al menos uno antes de reservar.';
    }

    if (this.daySchedules().length === 0) {
      return 'Este espacio no está disponible para reservar ese día.';
    }

    return null;
  });

  constructor() {
    this.loadSlots();
    this.loadRules();
    this.loadMyActiveReservations();
    this.loadSchedules();
    this.form.controls.date.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.loadSlots());
  }

  private async loadRules(): Promise<void> {
    try {
      this.rules.set(await this.spacesService.getRules(this.spaceId));
    } catch {
      // el cartel de reglas es informativo; si falla, igual se puede intentar reservar
    }
  }

  private async loadMyActiveReservations(): Promise<void> {
    try {
      this.myActiveReservations.set(await this.reservations.listMyActiveForSpace(this.spaceId));
    } catch {
      // si falla, el chequeo proactivo no se muestra pero el trigger de la base igual protege
    }
  }

  private async loadSchedules(): Promise<void> {
    try {
      this.schedules.set(await this.spacesService.listSchedules(this.spaceId));
    } catch {
      // si falla, el chequeo proactivo no se muestra pero el trigger de la base igual protege
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

  protected reservationDateRange(r: Reservation): string {
    const date = new Date(r.starts_at).toLocaleDateString('es-AR');
    return `${date} · ${this.slotTime(r.starts_at)} a ${this.slotTime(r.ends_at)}`;
  }

  // "20:00:00" -> "20:00". La ventana cruza medianoche cuando cierra a una hora del reloj
  // menor o igual a la que abre (ej. abre 20:00, cierra 03:00 del dia siguiente).
  protected formatWindow(s: SpaceSchedule): string {
    const overnight = toMinutes(s.closes_at) <= toMinutes(s.opens_at);
    return `${s.opens_at.slice(0, 5)} a ${s.closes_at.slice(0, 5)}${overnight ? ' (del día siguiente)' : ''}`;
  }

  private reservationTimesFor(date: string, schedule: SpaceSchedule): { startsAt: Date; endsAt: Date } {
    const startsAt = new Date(`${date}T${schedule.opens_at}`);
    let endsAt = new Date(`${date}T${schedule.closes_at}`);
    if (endsAt <= startsAt) {
      endsAt = new Date(endsAt.getTime() + 24 * 60 * 60 * 1000);
    }
    return { startsAt, endsAt };
  }

  protected async submit(): Promise<void> {
    const schedule = this.selectedSchedule();
    if (this.blockingReservations().length > 0 || this.scheduleWarning() || !schedule) {
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { date, guestsCount, notes } = this.form.getRawValue();
    const { startsAt, endsAt } = this.reservationTimesFor(date, schedule);

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
