import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type SubscriptionStatus = 'pending' | 'active' | 'past_due' | 'cancelled' | 'expired';

@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'plan_type' })
  planType: string;

  @Column({ default: 'pending' })
  status: SubscriptionStatus;

  // Kapan periode yang SUDAH DIBAYAR ini berakhir. Ini yang menentukan
  // sampai kapan user masih boleh streaming, TERLEPAS dari apakah dia
  // sudah membatalkan atau belum — pembatalan tidak langsung mencabut akses.
  @Column({ name: 'current_period_end', nullable: true })
  currentPeriodEnd: Date | null;

  // true kalau user sudah minta batalkan, tapi periode yang dibayar belum
  // habis. Dipakai supaya job renewal tahu untuk TIDAK coba charge lagi.
  @Column({ name: 'cancel_at_period_end', default: false })
  cancelAtPeriodEnd: boolean;

  // ID token kartu tersimpan dari Midtrans (fitur "one-click"/"two-click"),
  // dipakai RenewalService untuk coba charge otomatis tanpa user input ulang
  // nomor kartu. Null kalau user checkout tanpa opsi simpan kartu, atau
  // metode pembayarannya memang bukan kartu (misal transfer bank/e-wallet
  // yang tidak mendukung recurring charge otomatis di Midtrans).
  @Column({ name: 'saved_token_id', nullable: true })
  savedTokenId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
