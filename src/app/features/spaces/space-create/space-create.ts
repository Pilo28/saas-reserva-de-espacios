import { Component, OnInit, inject, signal } from '@angular/core';
import { ReactiveFormsModule, Validators, NonNullableFormBuilder } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SpacesService } from '../../../core/spaces.service';
import { BuildingsService } from '../../../core/buildings.service';

@Component({
  selector: 'app-space-create',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './space-create.html',
})
export class SpaceCreate implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly spacesService = inject(SpacesService);
  private readonly buildingsService = inject(BuildingsService);
  private readonly router = inject(Router);

  protected readonly buildingId = this.route.snapshot.paramMap.get('id')!;

  protected readonly form = this.fb.group({
    name: ['', [Validators.required]],
    description: [''],
    capacity: this.fb.control<number | null>(null),
  });

  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal('');

  async ngOnInit(): Promise<void> {
    const role = await this.buildingsService.getMyRole(this.buildingId);
    if (role !== 'admin') {
      this.router.navigate(['/buildings', this.buildingId, 'spaces']);
    }
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set('');

    try {
      const { name, description, capacity } = this.form.getRawValue();
      const space = await this.spacesService.create(this.buildingId, { name, description, capacity });
      this.router.navigate(['/buildings', this.buildingId, 'spaces', space.id]);
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'No se pudo crear el espacio.');
      this.submitting.set(false);
    }
  }
}
