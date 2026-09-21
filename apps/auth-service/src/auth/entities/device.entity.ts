import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from './user.entity';

@Entity('devices')
export class Device {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'device_type', nullable: true })
  deviceType: string;

  @Column({ name: 'device_name', nullable: true })
  deviceName: string;

  // ID unik JWT yang diterbitkan untuk device ini (klaim "jti"). Inilah yang
  // dipakai untuk mencabut akses device ini secara spesifik — bukan
  // menghapus baris ini saja, karena token yang sudah terlanjur beredar
  // tetap valid sampai kita masukkan jti-nya ke blocklist di Redis.
  @Column({ name: 'token_jti', unique: true })
  tokenJti: string;

  // Disalin dari klaim "exp" JWT saat login — dipakai untuk menghitung TTL
  // yang tepat saat revoke (sisa umur token, bukan umur penuhnya), tanpa
  // perlu decode ulang token mentah yang memang tidak kita simpan.
  @Column({ name: 'token_expires_at' })
  tokenExpiresAt: Date;

  @Column({ name: 'last_active_at' })
  lastActiveAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
