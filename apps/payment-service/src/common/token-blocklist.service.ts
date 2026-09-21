import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Duplikasi persis dari auth-service/src/common/token-blocklist.service.ts.
 * Perlu di sini juga karena payment-service memvalidasi JWT secara independen
 * (setiap microservice yang menerima token harus bisa verifikasi sendiri,
 * bukan selalu tanya ke auth-service — itu akan bikin auth-service jadi
 * single point of failure untuk semua service lain).
 *
 * TODO: begitu ada 3+ service yang butuh ini, pindahkan ke shared npm
 * package (misal @streaming-musik/auth-common) supaya tidak perlu
 * disalin-tempel dan berisiko drift antar service.
 */
@Injectable()
export class TokenBlocklistService {
  private redis: Redis;

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
    });
  }

  async isRevoked(jti: string): Promise<boolean> {
    const value = await this.redis.get(`revoked-jti:${jti}`);
    return value !== null;
  }
}
