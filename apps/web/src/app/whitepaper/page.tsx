import { Metadata } from 'next';
import { WhitepaperViewer } from '@/components/whitepaper/WhitepaperViewer';

export const metadata: Metadata = {
  title: 'Official Protocol Whitepaper v2.0 | ProxyHubb DePIN',
  description:
    'Technical whitepaper for ProxyHubb: High-Throughput Decentralized Physical Infrastructure Protocol for Zero-Knowledge Bandwidth Routing and State-Channel Settlement on Solana.',
};

export default function WhitepaperPage() {
  return <WhitepaperViewer />;
}
