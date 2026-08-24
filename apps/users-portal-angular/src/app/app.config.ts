import { ApplicationConfig, provideBrowserGlobalErrorListeners, isDevMode } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideStoreDevtools } from '@ngrx/store-devtools';
import { provideUsersState, ORDERS_SOCKET_URL, ORDERS_API_URL } from '@portal/users-angular/data-access';
import { BUSINESS_AGENT_ENDPOINT } from '@portal/business-agent-angular';
import { appRoutes } from './app.routes';
import { provideStore } from '@ngrx/store';
import { provideEffects } from '@ngrx/effects';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(),
    provideRouter(appRoutes),
    provideStore(),
    provideEffects(),
    provideUsersState(),
    { provide: ORDERS_SOCKET_URL, useValue: environment.ordersWsUrl },
    { provide: ORDERS_API_URL, useValue: environment.ordersApiUrl },
    { provide: BUSINESS_AGENT_ENDPOINT, useValue: environment.businessAgentEndpoint },
    provideStoreDevtools({
      maxAge: 25,
      logOnly: !isDevMode()
    })
  ]
};
