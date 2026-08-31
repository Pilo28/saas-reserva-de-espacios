import { Component, inject, signal } from '@angular/core';
import { ReactiveFormsModule, Validators, NonNullableFormBuilder } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { BuildingsService } from '../../../core/buildings.service';

@Component({
  selector: 'app-building-create',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './building-create.html',
})
export class BuildingCreate {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly buildings = inject(BuildingsService);
  private readonly router = inject(Router);

  protected readonly form = this.fb.group({
    name: ['', [Validators.required]],
    address: [''],
    timezone: ['America/Argentina/Buenos_Aires', [Validators.required]],
  });

  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal('');

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set('');

    try {
      const building = await this.buildings.create(this.form.getRawValue());
      this.router.navigate(['/buildings', building.id]);
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'No se pudo crear el edificio.');
      this.submitting.set(false);
    }
  }
}
