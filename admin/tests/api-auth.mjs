// Run with: node --experimental-transform-types admin/tests/api-auth.mjs
import assert from 'node:assert/strict';
import { ApiError, request } from '../src/api.ts';

globalThis.__ADMIN_CONFIG__ = { apiBaseUrl: '/api/v1' };
globalThis.window = new EventTarget();
let expired = 0;
window.addEventListener('happy-pet-auth-expired', () => {
  expired += 1;
});
const rejectRequest = async (path, code) => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { code, message: code } }), { status: 401 });
  await assert.rejects(
    request(path, { method: 'POST' }),
    (error) => error instanceof ApiError && error.code === code,
  );
};

await rejectRequest('/admin/auth/password', 'INVALID_CREDENTIALS');
assert.equal(
  expired,
  0,
  'An incorrect current password must not expire an otherwise valid session',
);
await rejectRequest('/admin/auth/password', 'UNAUTHORIZED');
assert.equal(expired, 1, 'A genuinely expired password-change session must log out');
await rejectRequest('/admin/auth/login', 'INVALID_CREDENTIALS');
assert.equal(expired, 1, 'A rejected login must not dispatch another session expiry');
await rejectRequest('/admin/accounts', 'INVALID_CREDENTIALS');
assert.equal(expired, 2, 'The exception must not weaken other protected requests');
console.log(
  'PASS: password-change credential errors preserve the session; other unauthorized requests expire it',
);
