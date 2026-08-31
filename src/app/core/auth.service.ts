import { Service, computed, inject, signal } from '@angular/core';
import type { AuthError, Session } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';

@Service()
export class AuthService {
  private readonly supabase = inject(SupabaseService).client;

  readonly session = signal<Session | null>(null);
  readonly user = computed(() => this.session()?.user ?? null);

  constructor() {
    this.supabase.auth.getSession().then(({ data }) => this.session.set(data.session));
    this.supabase.auth.onAuthStateChange((_event, session) => this.session.set(session));
  }

  signUp(
    email: string,
    password: string,
    fullName: string,
  ): Promise<{ session: Session | null; error: AuthError | null }> {
    return this.supabase.auth
      .signUp({ email, password, options: { data: { full_name: fullName } } })
      .then(({ data, error }) => ({ session: data.session, error }));
  }

  signIn(email: string, password: string): Promise<{ error: AuthError | null }> {
    return this.supabase.auth
      .signInWithPassword({ email, password })
      .then(({ error }) => ({ error }));
  }

  signOut(): Promise<void> {
    return this.supabase.auth.signOut().then(() => undefined);
  }
}
