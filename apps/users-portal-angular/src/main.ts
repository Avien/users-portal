import { init } from '@module-federation/runtime';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

const reactRemoteUrl =
  window.location.hostname === 'localhost'
    ? 'http://localhost:4201/remoteEntry.js'
    : 'https://users-portal-react.vercel.app/remoteEntry.js';

init({
  name: 'angular-host',
  remotes: [{ name: 'react-users', entry: reactRemoteUrl }],
});

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
