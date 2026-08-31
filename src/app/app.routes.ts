import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login/login').then((m) => m.Login),
  },
  {
    path: 'signup',
    loadComponent: () => import('./features/auth/signup/signup').then((m) => m.Signup),
  },
  {
    path: 'home',
    loadComponent: () => import('./features/home/home').then((m) => m.Home),
    canActivate: [authGuard],
  },
  {
    path: 'buildings/new',
    loadComponent: () =>
      import('./features/buildings/building-create/building-create').then((m) => m.BuildingCreate),
    canActivate: [authGuard],
  },
  {
    path: 'buildings/:id',
    loadComponent: () =>
      import('./features/buildings/building-detail/building-detail').then((m) => m.BuildingDetail),
    canActivate: [authGuard],
  },
  { path: '**', redirectTo: 'home' },
];
