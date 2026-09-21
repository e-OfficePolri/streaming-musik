import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Subscription } from './subscription.entity';

@Entity('payment_transactions')
export class PaymentTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Subscription)
  @JoinColumn({ name: 'subscription_id' })
  subscription: Subscription;

  // order_id yang dikirim ke Midtrans — inilah kunci yang dipakai webhook
  // untuk mencocokkan notifikasi ke transaksi mana. Unique di level DB
  // supaya idempotency (lihat handleWebhook) juga terjaga di level constraint,
  // bukan cuma di application logic.
  @Column({ name: 'midtrans_order_id', unique: true })
  midtransOrderId: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  @Column({ default: 'IDR' })
  currency: string;

  @Column({ default: 'pending' })
  status: string; // pending | success | failed | expired | refunded

  @Column({ name: 'paid_at', nullable: true })
  paidAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
