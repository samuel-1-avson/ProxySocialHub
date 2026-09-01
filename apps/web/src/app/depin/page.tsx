import { Metadata } from 'next';
import { DePINPortal } from '@/components/network/DePINPortal';

export const metadata: Metadata = {
  title: 'DePIN Protocol & Mining Portal | ProxyHubb',
  description:
    'Staked Gateway Operators, Proof-of-Bandwidth Mining, and State-Channel Mutual Receipts on Solana.',
};

export default function DePINPage() {
  return <DePINPortal />;
}
