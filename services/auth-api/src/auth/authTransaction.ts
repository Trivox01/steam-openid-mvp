export type AuthTransactionStatus =
  | "pending"
  | "verified"
  | "cancelled"
  | "expired"
  | "consumed"
  | "failed";

export interface AuthTransaction {
  authRequestId: string;
  pollSecretHash: string;
  deviceIdHash: string;
  createdAt: string;
  expiresAt: string;
  status: AuthTransactionStatus;
  returnTo: string;
  responseNonceHash?: string;
  steamId?: string;
  consumedAt?: string;
  verifiedAt?: string;
  cancelledAt?: string;
  errorCode?: string;
  version: number;
}

export interface AuthTransactionStatusView {
  status: AuthTransactionStatus;
  errorCode?: string;
  steamId?: string;
  authenticatedAt?: string;
}
