import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SpacesService, type Space } from '../../../core/spaces.service';
import { BuildingsService } from '../../../core/buildings.service';

@Component({
  selector: 'app-space-list',
  imports: [RouterLink],
  templateUrl: './space-list.html',
})
export class SpaceList implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly spacesService = inject(SpacesService);
  private readonly buildingsService = inject(BuildingsService);

  protected readonly buildingId = this.route.snapshot.paramMap.get('id')!;
  protected readonly items = signal<Space[]>([]);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal('');
  protected readonly isAdmin = signal(false);

  ngOnInit(): void {
    this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [items, role] = await Promise.all([
        this.spacesService.listForBuilding(this.buildingId),
        this.buildingsService.getMyRole(this.buildingId),
      ]);
      this.items.set(items);
      this.isAdmin.set(role === 'admin');
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'No se pudo cargar la lista.');
    } finally {
      this.loading.set(false);
    }
  }
}
