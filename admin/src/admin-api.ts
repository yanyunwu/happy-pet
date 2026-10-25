import { request, type AdminAccount } from './api';

export interface AccountQuery {
  q: string;
  status: string;
  page: number;
  pageSize: number;
}
export interface AccountPage {
  items: AdminAccount[];
  total: number;
  page: number;
  pageSize: number;
}
export interface CreateAccount {
  username: string;
  password: string;
  nickname: string;
  remark: string;
}
export interface UpdateAccount {
  nickname: string;
  status: 'active' | 'disabled';
  remark: string;
}
export interface AccessTokenStatus {
  configured: boolean;
  hint: string;
  updatedAt: string | null;
}
export interface CreatedAccessToken {
  accessToken: string;
  hint: string;
  updatedAt: string;
}

export const adminApi = {
  accounts: (query: AccountQuery, signal?: AbortSignal) =>
    request<AccountPage>(
      `/admin/accounts?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))}`,
      { signal },
    ),
  create: (input: CreateAccount) =>
    request<AdminAccount>('/admin/accounts', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: UpdateAccount) =>
    request<AdminAccount>(`/admin/accounts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    request<void>(`/admin/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  restore: (id: string) =>
    request<AdminAccount>(`/admin/accounts/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
  resetPassword: (id: string, password: string) =>
    request<void>(`/admin/accounts/${encodeURIComponent(id)}/password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  changePassword: (input: { currentPassword: string; password: string }) =>
    request<void>('/admin/auth/password', { method: 'POST', body: JSON.stringify(input) }),
  accessToken: (signal?: AbortSignal) =>
    request<AccessTokenStatus>('/admin/auth/access-token', { signal }),
  setAccessToken: (accessToken?: string) =>
    request<CreatedAccessToken>('/admin/auth/access-token', {
      method: 'PUT',
      body: JSON.stringify(accessToken ? { accessToken } : {}),
    }),
  revokeAccessToken: () => request<void>('/admin/auth/access-token', { method: 'DELETE' }),
};
