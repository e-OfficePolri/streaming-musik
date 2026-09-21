import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * JWT itu stateless by design — begitu diterbitkan, server tidak bisa
 * "menariknya kembali" secara langsung. Solusinya: simpan daftar jti (JWT ID)
 * yang sudah dicabut di Redis, dengan TTL yang disamakan dengan sisa umur
 * token aslinya. Setelah token itu kedaluwarsa secara alami, entry di Redis
 * ikut hilang otomatis — tidak perlu dibersihkan manual.
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

  private buildKey(jti: string): string {
    return `revoked-jti:${jti}`;
  }

  /** Cabut satu token. ttlSeconds harus sisa umur token (exp - sekarang), bukan umur penuhnya. */
  async revoke(jti: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return; // token sudah kedaluwarsa sendiri, tidak perlu dicatat
    await this.redis.set(this.buildKey(jti), '1', 'EX', ttlSeconds);
  }

  async isRevoked(jti: string): Promise<boolean> {
    const value = await this.redis.get(this.buildKey(jti));
    return value !== null;
  }
}
