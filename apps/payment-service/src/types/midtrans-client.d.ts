declare module 'midtrans-client' {
  interface SnapConfig {
    isProduction: boolean;
    serverKey: string;
    clientKey?: string;
  }

  interface TransactionDetails {
    order_id: string;
    gross_amount: number;
  }

  interface CreateTransactionParams {
    transaction_details: TransactionDetails;
    customer_details?: { email?: string; first_name?: string };
    credit_card?: { secure: boolean };
  }

  interface CreateTransactionResult {
    token: string;
    redirect_url: string;
  }

  export class Snap {
    constructor(config: SnapConfig);
    createTransaction(params: CreateTransactionParams): Promise<CreateTransactionResult>;
  }

  // Dipakai untuk verifikasi signature notifikasi webhook.
  export class CoreApi {
    constructor(config: SnapConfig);
    transaction: {
      notification(payload: unknown): Promise<Record<string, any>>;
    };
  }
}
