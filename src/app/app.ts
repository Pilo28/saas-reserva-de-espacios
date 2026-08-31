import { Component, inject, signal } from '@angular/core';
import { SupabaseService } from './core/supabase.service';

type ConnectionStatus = 'checking' | 'ok' | 'error' | 'not-configured';

@Component({
  selector: 'app-root',
  imports: [],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly supabase = inject(SupabaseService);

  protected readonly status = signal<ConnectionStatus>('checking');
  protected readonly errorMessage = signal('');

  constructor() {
    this.checkConnection();
  }

  private async checkConnection(): Promise<void> {
    if (!this.supabase.isConfigured) {
      this.status.set('not-configured');
      return;
    }

    const { error } = await this.supabase.client.auth.getSession();

    if (error) {
      this.errorMessage.set(error.message);
      this.status.set('error');
      return;
    }

    this.status.set('ok');
  }
}
