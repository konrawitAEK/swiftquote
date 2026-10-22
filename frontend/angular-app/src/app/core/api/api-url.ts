import { environment } from '../../../environments/environment';

/** Base URL of the SwiftQuote REST API; the auth interceptor only adds the token to calls under it. */
export const API_URL: string = environment.apiUrl;
