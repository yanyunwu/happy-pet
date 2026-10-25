export interface User {
  id: string;
  username: string;
  nickname: string;
  avatarUrl: string;
  role: 'admin' | 'user';
  status: 'active' | 'disabled';
  source: 'wechat' | 'manual';
  remark?: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  deletedAt: string | null;
}
export interface UserPage {
  items: User[];
  total: number;
  page: number;
  pageSize: number;
}
export interface UserStats {
  total: number;
  wechat: number;
  disabled: number;
  today: number;
}
export interface UserQuery {
  q: string;
  status: string;
  source: string;
  page: number;
  pageSize: number;
}
export interface CreateUser {
  username: string;
  nickname: string;
  password: string;
  remark: string;
}
export interface UpdateUser {
  nickname: string;
  status: 'active' | 'disabled';
  remark: string;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const errorMessage = (error: unknown) =>
  error instanceof TypeError
    ? '暂时连接不上服务，请稍后重试'
    : error instanceof Error
      ? error.message
      : '操作未完成，请重试';

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${__ADMIN_CONFIG__.apiBaseUrl}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    if (response.status === 401 && path !== '/admin/auth/login')
      window.dispatchEvent(new Event('happy-pet-auth-expired'));
    throw new ApiError(
      response.status,
      data?.error?.code || 'REQUEST_FAILED',
      data?.error?.message || `服务请求失败（${response.status}）`,
    );
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}
export const api = {
  me: () => request<User>('/admin/auth/me'),
  login: (values: { username: string; password: string }) =>
    request<User>('/admin/auth/login', { method: 'POST', body: JSON.stringify(values) }),
  logout: () => request<void>('/admin/auth/logout', { method: 'POST' }),
  users: (query: UserQuery, signal?: AbortSignal) =>
    request<UserPage>(
      `/admin/users?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))}`,
      { signal },
    ),
  stats: (signal?: AbortSignal) => request<UserStats>('/admin/users/stats', { signal }),
  create: (input: CreateUser) =>
    request<User>('/admin/users', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: UpdateUser) =>
    request<User>(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  remove: (id: string) => request<void>(`/admin/users/${id}`, { method: 'DELETE' }),
  restore: (id: string) => request<User>(`/admin/users/${id}/restore`, { method: 'POST' }),
  resetPassword: (id: string, password: string) =>
    request<void>(`/admin/users/${id}/password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
};
