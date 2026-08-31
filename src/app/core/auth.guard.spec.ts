import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { authGuard } from './auth.guard';
import { SupabaseService } from './supabase.service';

describe('authGuard', () => {
  let sessionValue: unknown = null;

  const fakeSupabaseService = {
    client: {
      auth: {
        getSession: () => Promise.resolve({ data: { session: sessionValue } }),
      },
    },
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: SupabaseService, useValue: fakeSupabaseService }],
    });
  });

  it('allows navigation when a session exists', async () => {
    sessionValue = { user: { id: '1' } };

    const result = await TestBed.runInInjectionContext(() => authGuard(undefined!, undefined!));

    expect(result).toBe(true);
  });

  it('redirects to /login when there is no session', async () => {
    sessionValue = null;

    const result = await TestBed.runInInjectionContext(() => authGuard(undefined!, undefined!));

    const router = TestBed.inject(Router);
    expect(result).toEqual(router.parseUrl('/login'));
  });
});
