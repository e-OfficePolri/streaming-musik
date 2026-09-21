import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { LessThan, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID, createHash } from 'crypto';
import { User } from './entities/user.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { Device } from './entities/device.entity';
import { LoginRateLimitService } from '../common/login-rate-limit.service';
import { EmailService } from '../common/email.service';
import { TokenBlocklistService } from '../common/token-blocklist.service';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 jam, sesuai acceptance criteria
// HARUS sama dengan signOptions.expiresIn di auth.module.ts (7 hari) — kalau
// diubah di sana, ubah juga di sini, supaya tokenExpiresAt yang dicatat per
// device akurat.
const JWT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Hash bcrypt valid (format $2b$10$<53 karakter salt+hash>) dari contoh resmi
// dokumentasi bcrypt.js — dipakai sebagai target bcrypt.compare saat user
// tidak ditemukan, semata untuk menyamakan waktu eksekusi. HARUS berformat
// bcrypt yang benar (bukan sembarang string), karena bcrypt.compare akan
// melempar error untuk hash bermalformat, bukan mengembalikan false — itu
// akan merusak tujuan timing-safety ini sendiri.
const DUMMY_HASH_FOR_TIMING_SAFETY = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(PasswordResetToken) private resetTokensRepo: Repository<PasswordResetToken>,
    @InjectRepository(Device) private devicesRepo: Repository<Device>,
    private jwtService: JwtService,
    private rateLimitService: LoginRateLimitService,
    private emailService: EmailService,
    private blocklistService: TokenBlocklistService,
  ) {}

  async register(email: string, password: string, displayName?: string) {
    // Sebelumnya bergantung pada unique constraint di database untuk
    // menolak email duplikat — itu benar secara data, tapi hasilnya raw
    // database error (bukan pesan jelas seperti yang disyaratkan acceptance
    // criteria). Cek eksplisit di sini supaya pesannya rapi DAN konstrain
    // di database tetap jadi jaring pengaman terakhir kalau ada race
    // condition (dua request register bersamaan lolos cek ini bersamaan).
    const existing = await this.usersRepo.findOneBy({ email });
    if (existing) {
      throw new ConflictException('Email sudah digunakan');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = this.usersRepo.create({ email, passwordHash, displayName });
    await this.usersRepo.save(user);
    return { id: user.id, email: user.email };
  }

  async login(email: string, password: string, ip: string, deviceName?: string) {
    await this.rateLimitService.assertNotRateLimited(email, ip);

    const user = await this.usersRepo.findOneBy({ email });
    // Selalu jalankan bcrypt.compare, bahkan saat user tidak ditemukan
    // (dengan hash dummy) — supaya waktu respons konsisten. Tanpa ini,
    // penyerang bisa menebak email mana yang terdaftar hanya dari
    // perbedaan waktu respons (bcrypt sengaja lambat, ~100ms+).
    const passwordHash = user?.passwordHash ?? DUMMY_HASH_FOR_TIMING_SAFETY;
    const isPasswordValid = await bcrypt.compare(password, passwordHash);

    if (!user || !isPasswordValid) {
      // Catat percobaan gagal untuk KEDUA kasus (email tidak ditemukan atau
      // password salah) — supaya penyerang tidak bisa membedakan mana yang
      // salah dari perbedaan perilaku rate limiting.
      await this.rateLimitService.recordFailedAttempt(email, ip);
      throw new UnauthorizedException('Email atau password salah');
    }

    await this.rateLimitService.resetAttempts(email, ip);

    // jti (JWT ID) unik per login — inilah yang dipakai untuk mencabut
    // sesi device ini secara spesifik lewat blocklist, tanpa memengaruhi
    // token device lain milik user yang sama.
    const jti = randomUUID();
    const token = this.jwtService.sign({ sub: user.id, email: user.email, jti });
    const tokenExpiresAt = new Date(Date.now() + JWT_TTL_MS);

    const device = this.devicesRepo.create({
      user,
      tokenJti: jti,
      tokenExpiresAt,
      deviceName: deviceName ?? 'Perangkat tidak dikenal',
      lastActiveAt: new Date(),
    });
    await this.devicesRepo.save(device);

    return { accessToken: token };
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.usersRepo.findOneBy({ email });

    // Selalu "berhasil" secara diam-diam kalau email tidak ditemukan —
    // sesuai acceptance criteria, ini mencegah user enumeration lewat
    // endpoint forgot-password. Caller (controller) tetap merespons
    // sukses generik terlepas dari cabang mana yang jalan di sini.
    if (!user) return;

    // Token mentah (yang dikirim lewat email) tidak pernah disimpan —
    // hanya hash SHA-256-nya. Beda dengan password, di sini tidak perlu
    // bcrypt (lambat & bersalt) karena token sudah random dengan entropi
    // tinggi (32 byte) — bukan sesuatu yang manusia pilih dan bisa ditebak.
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const resetToken = this.resetTokensRepo.create({
      user,
      tokenHash,
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    });
    await this.resetTokensRepo.save(resetToken);

    const resetLink = `${process.env.APP_WEB_URL ?? 'http://localhost:3000'}/reset-password?token=${rawToken}`;
    await this.emailService.sendPasswordResetEmail(user.email, resetLink);
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const resetToken = await this.resetTokensRepo.findOne({
      where: { tokenHash },
      relations: ['user'],
    });

    const isValid = resetToken && !resetToken.usedAt && resetToken.expiresAt > new Date();
    if (!isValid) {
      throw new UnauthorizedException('Link reset password tidak valid atau sudah kedaluwarsa');
    }

    resetToken.user.passwordHash = await bcrypt.hash(newPassword, 10);
    await this.usersRepo.save(resetToken.user);

    // Tandai token sudah dipakai — mencegah link yang sama dipakai dua kali,
    // termasuk kalau link ini bocor/ke-forward setelah dipakai sekali.
    resetToken.usedAt = new Date();
    await this.resetTokensRepo.save(resetToken);

    // Cabut SEMUA sesi aktif user ini — kalau alasan reset password adalah
    // akun dicuri, akses attacker (yang mungkin masih login di device lain)
    // ikut terputus begitu password diganti.
    await this.revokeAllDevices(resetToken.user.id);
  }

  async listDevices(userId: string) {
    const devices = await this.devicesRepo.find({
      where: { user: { id: userId } },
      order: { lastActiveAt: 'DESC' },
    });
    return devices.map((d) => ({
      id: d.id,
      deviceName: d.deviceName,
      lastActiveAt: d.lastActiveAt,
      createdAt: d.createdAt,
    }));
  }

  async logoutDevice(userId: string, deviceId: string): Promise<void> {
    const device = await this.devicesRepo.findOne({ where: { id: deviceId, user: { id: userId } } });
    if (!device) return; // idempotent — device sudah tidak ada dianggap sukses

    await this.revokeDeviceToken(device);
    await this.devicesRepo.delete(device.id);
  }

  async logoutOtherDevices(userId: string, currentJti: string): Promise<void> {
    const devices = await this.devicesRepo.find({ where: { user: { id: userId } } });
    const others = devices.filter((d) => d.tokenJti !== currentJti);

    for (const device of others) {
      await this.revokeDeviceToken(device);
    }
    await this.devicesRepo.remove(others);
  }

  private async revokeAllDevices(userId: string): Promise<void> {
    const devices = await this.devicesRepo.find({ where: { user: { id: userId } } });
    for (const device of devices) {
      await this.revokeDeviceToken(device);
    }
    await this.devicesRepo.remove(devices);
  }

  private async revokeDeviceToken(device: Device): Promise<void> {
    const ttlSeconds = Math.ceil((device.tokenExpiresAt.getTime() - Date.now()) / 1000);
    await this.blocklistService.revoke(device.tokenJti, ttlSeconds);
  }

  /**
   * Hapus token reset yang sudah kedaluwarsa. Jalankan lewat scheduled job
   * (misal cron ECS task terpisah atau @nestjs/schedule) — bukan bagian
   * dari alur request biasa, supaya tabel tidak menumpuk selamanya.
   */
  async purgeExpiredResetTokens(): Promise<void> {
    await this.resetTokensRepo.delete({ expiresAt: LessThan(new Date()) });
  }
}
