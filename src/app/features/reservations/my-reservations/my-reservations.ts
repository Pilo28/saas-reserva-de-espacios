import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ReservationsService, type MyReservation } from '../../../core/reservations.service';

@Component({
  selector: 'app-my-reservations',
  imports: [RouterLink, DatePipe],
  templateUrl: './my-reservations.html',
})
export class MyReservations implements OnInit {
  private readonly reservations = inject(ReservationsService);

  protected readonly items = signal<MyReservation[]>([]);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal('');
  protected readonly cancellingId = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.items.set(await this.reservations.listMine());
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'No se pudo cargar la lista.');
    } finally {
      this.loading.set(false);
    }
  }

  protected isPast(reservation: MyReservation): boolean {
    return new Date(reservation.ends_at) < new Date();
  }

  protected async cancel(id: string): Promise<void> {
    this.cancellingId.set(id);
    try {
      await this.reservations.cancel(id);
      await this.load();
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'No se pudo cancelar.');
    } finally {
      this.cancellingId.set(null);
    }
  }
}
