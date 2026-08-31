import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { SupabaseService } from './supabase.service';

export const authGuard: CanActivateFn = async () => {
  const supabase = inject(SupabaseService).client;
  const router = inject(Router);

  const { data } = await supabase.auth.getSession();

  return data.session ? true : router.parseUrl('/login');
};
