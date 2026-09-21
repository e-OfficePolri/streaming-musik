import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import Redis from 'ioredis';

const MAX_ATTEMPTS = 5;
const WINDOW_SECONDS = 15 * 60; // 15 menit, sesuai acceptance criteria

/**
 * Membatasi percobaan login per kombinasi email+IP — bukan email saja
 * (supaya satu user tidak bisa dikunci orang lain dengan sengaja salah
 * password berulang kali dari IP berbeda) dan bukan IP saja (supaya
 * satu jaringan kantor/kampus tidak saling mengunci).
 *
 * Pakai Redis (bukan memory in-process) supaya konsisten walau auth-service
 * di-scale ke beberapa instance ECS task — semua instance melihat counter
 * yang sama.
 */
@Injectable()
export class LoginRateLimitService {
  private redis: Redis;

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
    });
  }

  private buildKey(email: string, ip: string): string {
    return `login-attempts:${email.toLowerCase()}:${ip}`;
  }

  /**
   * Panggil di awal request login, SEBELUM cek password.
   * Melempar TooManyRequestsException kalau sudah melewati batas.
   */
  async assertNotRateLimited(email: string, ip: string): Promise<void> {
    const key = this.buildKey(email, ip);
    const attempts = await this.redis.get(key);

    if (attempts && Number(attempts) >= MAX_ATTEMPTS) {
      const ttl = await this.redis.ttl(key);
      throw new HttpException(
        `Terlalu banyak percobaan login gagal. Coba lagi dalam ${Math.ceil(ttl / 60)} menit.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Panggil setelah password terbukti salah. */
  async recordFailedAttempt(email: string, ip: string): Promise<void> {
    const key = this.buildKey(email, ip);
    const attempts = await this.redis.incr(key);
    if (attempts === 1) {
      // Set TTL hanya di percobaan pertama, supaya window bergerak (rolling)
      // dari percobaan gagal pertama — bukan direset tiap percobaan.
      await this.redis.expire(key, WINDOW_SECONDS);
    }
  }

  /** Panggil setelah login berhasil, supaya counter tidak "menempel" ke akun. */
  async resetAttempts(email: string, ip: string): Promise<void> {
    await this.redis.del(this.buildKey(email, ip));
  }
}
