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
  {
    path: 'buildings/:id/dashboard',
    loadComponent: () =>
      import('./features/buildings/building-dashboard/building-dashboard').then((m) => m.BuildingDashboard),
    canActivate: [authGuard],
  },
  {
    path: 'buildings/:id/spaces',
    loadComponent: () => import('./features/spaces/space-list/space-list').then((m) => m.SpaceList),
    canActivate: [authGuard],
  },
  {
    path: 'buildings/:id/spaces/new',
    loadComponent: () => import('./features/spaces/space-create/space-create').then((m) => m.SpaceCreate),
    canActivate: [authGuard],
  },
  {
    path: 'buildings/:id/spaces/:spaceId',
    loadComponent: () => import('./features/spaces/space-detail/space-detail').then((m) => m.SpaceDetail),
    canActivate: [authGuard],
  },
  {
    path: 'buildings/:id/spaces/:spaceId/reserve',
    loadComponent: () =>
      import('./features/reservations/reservation-create/reservation-create').then(
        (m) => m.ReservationCreate,
      ),
    canActivate: [authGuard],
  },
  {
    path: 'reservations',
    loadComponent: () =>
      import('./features/reservations/my-reservations/my-reservations').then((m) => m.MyReservations),
    canActivate: [authGuard],
  },
  { path: '**', redirectTo: 'home' },
];
