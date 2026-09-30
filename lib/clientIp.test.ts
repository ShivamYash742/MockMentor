import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clientIp } from './clientIp.ts';

const req = (headers: Record<string, string>) => new Request('http://localhost/', { headers });

test('uses x-real-ip when the proxy sets it', () => {
  assert.equal(clientIp(req({ 'x-real-ip': '203.0.113.5', 'x-forwarded-for': '198.51.100.1' })), '203.0.113.5');
});

test('uses the last x-forwarded-for entry, which the nearest proxy added', () => {
  // The first entry can be written by the caller when a proxy appends to the header.
  assert.equal(clientIp(req({ 'x-forwarded-for': '198.51.100.99, 203.0.113.7' })), '203.0.113.7');
});

test('no header or a loopback address counts as unknown', () => {
  assert.equal(clientIp(req({})), null);
  assert.equal(clientIp(req({ 'x-forwarded-for': '127.0.0.1' })), null);
  assert.equal(clientIp(req({ 'x-forwarded-for': '::1' })), null);
  assert.equal(clientIp(req({ 'x-forwarded-for': '::ffff:127.0.0.1' })), null);
  assert.equal(clientIp(req({ 'x-forwarded-for': '1127.0.0.1' })), '1127.0.0.1');
});
