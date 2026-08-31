import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ReactiveFormsModule, Validators, NonNullableFormBuilder } from '@angular/forms';
import { BuildingsService } from '../../../core/buildings.service';

@Component({
  selector: 'app-building-detail',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './building-detail.html',
})
export class BuildingDetail implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly buildingsService = inject(BuildingsService);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly buildingId = this.route.snapshot.paramMap.get('id')!;

  protected readonly loading = signal(true);
  protected readonly isAdmin = signal(false);
  protected readonly notFound = signal(false);
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly errorMessage = signal('');

  protected readonly form = this.fb.group({
    name: ['', [Validators.required]],
    address: [''],
    timezone: ['', [Validators.required]],
  });

  async ngOnInit(): Promise<void> {
    try {
      const [building, role] = await Promise.all([
        this.buildingsService.get(this.buildingId),
        this.buildingsService.getMyRole(this.buildingId),
      ]);

      if (!building) {
        this.notFound.set(true);
        return;
      }

      this.isAdmin.set(role === 'admin');
      this.form.patchValue({
        name: building.name,
        address: building.address ?? '',
        timezone: building.timezone,
      });

      if (!this.isAdmin()) {
        this.form.disable();
      }
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'No se pudo cargar el edificio.');
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
      await this.buildingsService.update(this.buildingId, this.form.getRawValue());
      this.saved.set(true);
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'No se pudo guardar.');
    } finally {
      this.saving.set(false);
    }
  }
}
