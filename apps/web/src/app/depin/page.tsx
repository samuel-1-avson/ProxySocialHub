import { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Protocol overview | ProxyHubb',
  description:
    'Explore ProxyHubb buyer and seller workspaces, public network records, and the current settlement acceptance status.',
};

export default function DePINPage() {
  const explorer = process.env.NEXT_PUBLIC_EXPLORER_URL?.replace(/\/+$/, '');
  redirect(explorer ? `${explorer}/about/protocol` : '/explorer/about/protocol');
}
