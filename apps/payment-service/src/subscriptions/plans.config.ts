// Konfigurasi plan di-hardcode di sini untuk MVP — belum ada tabel PLANS
// terpisah di ERD, karena baru ada 1-2 plan. Kalau nanti jumlah plan
// bertambah atau harga perlu diubah tanpa deploy ulang, pindahkan ini ke
// tabel database atau feature flag service.
export interface PlanConfig {
  name: string;
  priceIdr: number;
  durationDays: number;
}

export const PLANS: Record<string, PlanConfig> = {
  premium_monthly: {
    name: 'Premium Bulanan',
    priceIdr: 49000,
    durationDays: 30,
  },
};

export function getPlan(planType: string): PlanConfig {
  const plan = PLANS[planType];
  if (!plan) {
    throw new Error(`Plan tidak dikenal: ${planType}`);
  }
  return plan;
}
