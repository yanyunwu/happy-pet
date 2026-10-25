import { request } from './api';

export interface Settings {
  announcement: string;
  version: number;
  updatedAt: string;
}

export const settingsApi = {
  get: (signal?: AbortSignal) => request<Settings>('/admin/settings', { signal }),
  save: (input: Pick<Settings, 'announcement' | 'version'>) =>
    request<Settings>('/admin/settings', { method: 'PUT', body: JSON.stringify(input) }),
};
