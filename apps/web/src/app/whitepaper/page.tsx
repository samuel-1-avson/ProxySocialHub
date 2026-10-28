import { Metadata } from 'next';
import { WhitepaperViewer } from '@/components/whitepaper/WhitepaperViewer';

export const metadata: Metadata = {
  title: 'Architecture draft | ProxyHubb',
  description:
    'Proposed architecture notes. These concepts do not describe currently available or independently verified ProxyHubb features.',
};

export default function WhitepaperPage() {
  return <WhitepaperViewer />;
}
