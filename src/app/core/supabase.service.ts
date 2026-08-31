import { Service } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

@Service()
export class SupabaseService {
  readonly isConfigured = Boolean(environment.supabaseUrl && environment.supabaseAnonKey);

  readonly client: SupabaseClient = createClient(
    environment.supabaseUrl || 'https://placeholder.supabase.co',
    environment.supabaseAnonKey || 'placeholder-anon-key',
  );
}
