import type { ApiClient } from './ApiClient';
import type { LoginResponse } from './types';

export class AuthApi {
  constructor(private readonly client: ApiClient) {}

  register(username: string, password: string) {
    return this.client.post<{ id: number; username: string }>('/api/auth/register', { username, password }, { auth: false });
  }

  login(username: string, password: string) {
    return this.client.post<LoginResponse>('/api/auth/login', { username, password }, { auth: false });
  }

  /** Log in and store the token on the client for subsequent calls. Throws if login fails. */
  async loginAs(username: string, password: string): Promise<LoginResponse> {
    const res = await this.login(username, password);
    if (res.status !== 200) throw new Error(`Login as ${username} failed with ${res.status}: ${JSON.stringify(res.body)}`);
    this.client.setToken(res.body.token);
    return res.body;
  }
}
