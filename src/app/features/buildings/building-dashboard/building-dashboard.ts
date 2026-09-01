import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BuildingsService } from '../../../core/buildings.service';
import { DashboardService, type DashboardSummary } from '../../../core/dashboard.service';

@Component({
  selector: 'app-building-dashboard',
  imports: [RouterLink, DatePipe],
  templateUrl: './building-dashboard.html',
})
export class BuildingDashboard implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly buildingsService = inject(BuildingsService);
  private readonly dashboardService = inject(DashboardService);

  protected readonly buildingId = this.route.snapshot.paramMap.get('id')!;

  protected readonly loading = signal(true);
  protected readonly forbidden = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly summary = signal<DashboardSummary | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      const role = await this.buildingsService.getMyRole(this.buildingId);
      if (role !== 'admin') {
        this.forbidden.set(true);
        return;
      }

      this.summary.set(await this.dashboardService.getSummary(this.buildingId));
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'No se pudo cargar el panel.');
    } finally {
      this.loading.set(false);
    }
  }
}
