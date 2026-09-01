import { Component, OnInit, inject, signal } from '@angular/core';
import { ReactiveFormsModule, Validators, NonNullableFormBuilder } from '@angular/forms';
import { Router } from '@angular/router';
import { SupabaseService } from '../../../core/supabase.service';

@Component({
  selector: 'app-set-password',
  imports: [ReactiveFormsModule],
  templateUrl: './set-password.html',
})
export class SetPassword implements OnInit {
  private readonly supabase = inject(SupabaseService).client;
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly router = inject(Router);

  protected readonly form = this.fb.group({
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  protected readonly checkingSession = signal(true);
  protected readonly noSession = signal(false);
  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal('');

  async ngOnInit(): Promise<void> {
    // El link del mail de invitacion deja la sesion armada en la URL; el cliente de
    // supabase-js la detecta solo (detectSessionInUrl, default). Solo hay que esperar a
    // que esté lista antes de dejar tocar el formulario.
    const { data } = await this.supabase.auth.getSession();
    this.noSession.set(!data.session);
    this.checkingSession.set(false);
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set('');

    const { password } = this.form.getRawValue();
    const { error } = await this.supabase.auth.updateUser({ password });

    this.submitting.set(false);

    if (error) {
      this.errorMessage.set(error.message);
      return;
    }

    this.router.navigateByUrl('/home');
  }
}
