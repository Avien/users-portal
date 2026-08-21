import { init } from '@module-federation/runtime';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { environment } from './environments/environment';

init({
  name: 'angular-host',
  remotes: [{ name: 'react-users', entry: environment.reactRemoteUrl, type: 'module' }],
});

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
