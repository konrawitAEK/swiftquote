// Build-time settings. The Docker build overwrites this file with ARG API_URL
// (see Dockerfile); the browser calls the API directly, so this is a host URL.
export const environment = {
  apiUrl: 'http://localhost:8080/api/v1',
};
