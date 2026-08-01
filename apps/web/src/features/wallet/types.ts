export type TabType =
  | 'OVERVIEW'
  | 'DEPOSIT'
  | 'WITHDRAW'
  | 'ACTIVITY'
  | 'LINKED_WALLETS';

export type WalletResult = {
  success: boolean;
  message: string;
  solscanUrl?: string;
  type?: 'info' | 'success' | 'error';
};
