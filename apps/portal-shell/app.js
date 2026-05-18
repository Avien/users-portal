const local = window.location.hostname === 'localhost';

const urls = {
  angular: local
    ? 'http://localhost:4200/users'
    : 'https://users-portal-angular.vercel.app/users',
  react: local
    ? 'http://localhost:4201/users'
    : 'https://users-portal-react.vercel.app/users',
  hybrid: local
    ? 'http://localhost:4200/hybrid'
    : 'https://users-portal-angular.vercel.app/hybrid',
};

document.querySelectorAll('[data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    window.location.href = urls[btn.dataset.mode];
  });
});