import { redirect } from 'next/navigation';
import { NetworkShell } from '@/components/network/NetworkShell';
import { isUnifiedNetworkEnabled } from '@/lib/feature-flags';

export default function NetworkPage() {
    if (!isUnifiedNetworkEnabled()) {
        redirect('/marketplace/map');
    }

    return <NetworkShell />;
}
