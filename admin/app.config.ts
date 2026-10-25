export const environments = {
  development: {
    basePath: '/',
    apiBaseUrl: '/api/v1',
    apiOrigin: process.env.API_PROXY_TARGET || 'http://127.0.0.1:8080',
  },
  production: { basePath: '/admin/', apiBaseUrl: '/api/v1', apiOrigin: 'http://127.0.0.1:8080' },
};
export const appConfig =
  environments[process.env.NODE_ENV === 'production' ? 'production' : 'development'];
