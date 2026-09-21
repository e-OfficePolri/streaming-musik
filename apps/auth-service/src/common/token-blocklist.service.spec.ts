jest.mock('ioredis', () => require('ioredis-mock'));

import { TokenBlocklistService } from './token-blocklist.service';

describe('TokenBlocklistService', () => {
  let service: TokenBlocklistService;

  beforeEach(() => {
    service = new TokenBlocklistService();
  });

  afterEach(async () => {
    await (service as any).redis.flushall();
  });

  it('jti yang belum pernah dicabut dianggap tidak revoked', async () => {
    await expect(service.isRevoked('jti-yang-belum-dicabut')).resolves.toBe(false);
  });

  it('jti yang sudah di-revoke terdeteksi sebagai revoked', async () => {
    await service.revoke('jti-abc', 3600);
    await expect(service.isRevoked('jti-abc')).resolves.toBe(true);
  });

  it('tidak melakukan apa pun kalau ttlSeconds <= 0 (token sudah kedaluwarsa sendiri)', async () => {
    await service.revoke('jti-sudah-expired', 0);
    // Tidak ada entry yang tersimpan — hemat memory Redis, karena token ini
    // toh sudah tidak valid lagi secara alami.
    await expect(service.isRevoked('jti-sudah-expired')).resolves.toBe(false);
  });

  it('jti berbeda tidak saling memengaruhi', async () => {
    await service.revoke('jti-1', 3600);
    await expect(service.isRevoked('jti-2')).resolves.toBe(false);
  });
});
