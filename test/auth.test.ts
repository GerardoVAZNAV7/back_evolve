import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAccessToken,
  createRefreshToken,
  hashPassword,
  hashToken,
  verifyAccessToken,
  verifyPassword,
} from '../src/auth.js';
import { HttpError } from '../src/errors.js';

test('hashPassword y verifyPassword hacen roundtrip', async () => {
  const hash = await hashPassword('contraseña-segura-123');
  assert.notEqual(hash, 'contraseña-segura-123');
  assert.equal(await verifyPassword('contraseña-segura-123', hash), true);
  assert.equal(await verifyPassword('otra-contraseña', hash), false);
});

test('verifyPassword rechaza hashes malformados', async () => {
  assert.equal(await verifyPassword('x', 'no-es-un-hash'), false);
  assert.equal(await verifyPassword('x', 'scrypt$1$2$3$$'), false);
});

test('el access token se firma y verifica', async () => {
  const userId = '11111111-1111-1111-1111-111111111111';
  const token = await createAccessToken(userId);
  assert.equal(await verifyAccessToken(token), userId);
});

test('un access token inválido se rechaza con 401', async () => {
  await assert.rejects(
    () => verifyAccessToken('token-invalido'),
    (error: unknown) => error instanceof HttpError && error.status === 401
  );
});

test('los refresh tokens son únicos y se hashean de forma estable', () => {
  const first = createRefreshToken();
  const second = createRefreshToken();
  assert.notEqual(first.token, second.token);
  assert.equal(first.hash, hashToken(first.token));
  assert.ok(first.expiresAt.getTime() > Date.now());
});
