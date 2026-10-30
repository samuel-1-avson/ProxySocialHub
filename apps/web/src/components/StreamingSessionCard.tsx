import { Session } from '@/lib/api';
import { openChannel, updateChannelState } from '@/lib/services/channel';
import { Activity, Clock, ShieldCheck, Square, Zap, HardDrive, AlertCircle, AlertTriangle } from 'lucide-react';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useToast } from '@/stores';

interface StreamingSessionCardProps {
    session: Session;
    onTerminate: (id: string) => void;
}

export function StreamingSessionCard({ session, onTerminate }: StreamingSessionCardProps) {
    const [elapsed, setElapsed] = useState(0);
    const [confirmStop, setConfirmStop] = useState(false);

    // Turbo Mode States
    const [isTurbo, setIsTurbo] = useState(false);
    const [loadingTurbo, setLoadingTurbo] = useState(false);
    const [channelId, setChannelId] = useState<string | null>(null);
    const nonceRef = useRef(0);

    const toast = useToast();
    const { connected: walletConnected, publicKey, signMessage } = useWallet();

    const bytesUsed = session.bytes_used || 0;
    const pricePerGb = session.listing?.price_per_gb ?? 0;
    const gbUsed = bytesUsed / (1024 * 1024 * 1024);
    const meteredCost = gbUsed * pricePerGb;
    const escrowRef = session.session_pda || session.tx_hash || session.escrow_address;

    const signStateUpdateWithWallet = useCallback(async (
        chanId: string,
        nonce: number,
        amount: number,
        bytes: number
    ): Promise<string> => {
        if (!signMessage || !publicKey) {
            throw new Error('Wallet not connected');
        }
        const msg = `${chanId}:${nonce}:${amount}:${bytes}`;
        const encoded = new TextEncoder().encode(msg);
        const sigBytes = await signMessage(encoded);
        // Convert Uint8Array to hex string
        return Array.from(sigBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }, [signMessage, publicKey]);

    const activateTurbo = async () => {
        if (!walletConnected || !signMessage) {
            toast.warning('Wallet required', 'Connect your Solana wallet first to enable Turbo L2 mode.');
            return;
        }

        setLoadingTurbo(true);
        try {
            // Dynamically calculate L2 deposit based on listing price
            // Lock in 2 hours of bandwidth by default for smooth streaming
            const pricePerHour = session.listing?.price_per_hour || 0;
            const depositHours = 2;
            const minDeposit = 0.05;
            const calculatedDeposit = Math.max(pricePerHour * depositHours, pricePerGb * 0.1, minDeposit);
            const depositAmountLamports = Math.floor(calculatedDeposit * 1e9);

            const channel = await openChannel(session.id, depositAmountLamports);
            setChannelId(channel.id);
            setIsTurbo(true);
        } catch (e) {
            console.error('Failed to open channel', e);
            toast.error('L2 upgrade failed', 'Could not open state channel. Please try again.');
        } finally {
            setLoadingTurbo(false);
        }
    };

    // State Channel heartbeat loop — only runs when Turbo is active
    useEffect(() => {
        if (!isTurbo || !channelId) return;

        const updateInterval = setInterval(async () => {
            try {
                const currentNonce = nonceRef.current + 1;
                nonceRef.current = currentNonce;

                const atomicAmount = Math.floor(meteredCost * 1e9);
                const atomicBytes = bytesUsed;

                const sig = await signStateUpdateWithWallet(channelId, currentNonce, atomicAmount, atomicBytes);
                await updateChannelState(channelId, currentNonce, atomicAmount, atomicBytes, sig);

                console.log(`L2 Update Sent: Nonce ${currentNonce}`);
            } catch (e) {
                console.error('L2 Update Failed', e);
            }
        }, 2000);

        return () => clearInterval(updateInterval);
    }, [isTurbo, channelId, meteredCost, bytesUsed, signStateUpdateWithWallet]);

    useEffect(() => {
        if (session.status !== 'active') return;

        const startTime = new Date(session.created_at).getTime();
        const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startTime) / 1000)));
        tick();
        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }, [session.status, session.created_at]);

    const formatTime = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const formatBytes = (bytes: number) => {
        if (!bytes || bytes <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let unitIndex = 0;
        let scaled = bytes;
        while (scaled >= 1024 && unitIndex < units.length - 1) {
            scaled /= 1024;
            unitIndex += 1;
        }
        const precision = scaled >= 100 || unitIndex === 0 ? 0 : 2;
        return `${scaled.toFixed(precision)} ${units[unitIndex]}`;
    };

    const escrowLabel = escrowRef
        ? `On-chain escrow ${escrowRef.slice(0, 8)}…`
        : session.amount_locked_sol
            ? `Locked ${Number(session.amount_locked_sol).toFixed(4)} SOL`
            : 'No escrow on this session';

    const turboDisabled = !walletConnected || loadingTurbo;
    const turboTooltip = !walletConnected
        ? 'Connect your Solana wallet to enable Turbo L2'
        : loadingTurbo
        ? 'Opening channel...'
        : 'Upgrade to L2 state channel';

    return (
        <div className="card-retro p-0 bg-card overflow-hidden group border-success/30">
            {/* Header / Status Bar */}
            <div className="px-5 py-3 bg-secondary/10 border-b border-border flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <Activity size={16} className="text-success" />
                        <span className="absolute -top-1 -right-1 w-2 h-2 bg-success rounded-full animate-ping"></span>
                    </div>
                    <h3 className="text-xs font-bold font-mono text-success">Stream Active</h3>
                </div>
                <div className="text-xs font-mono text-muted-foreground flex gap-2">
                    <span>ID: {session.id.slice(0, 8)}</span>
                </div>
            </div>

            {/* Main Viz */}
            <div className="p-6 grid grid-cols-2 gap-6 relative">
                {/* Background Grid Animation */}
                <div className="absolute inset-0 bg-[linear-gradient(rgba(34,197,94,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(34,197,94,0.03)_1px,transparent_1px)] bg-[size:20px_20px] pointer-events-none"></div>

                {/* Left: Metered amount */}
                <div className="z-10">
                    <p className="text-xs font-mono font-bold text-muted-foreground mb-1">Metered amount</p>
                    <div className="text-3xl font-semibold font-mono tracking-tight text-foreground flex items-baseline gap-1">
                        {meteredCost.toFixed(6)} <span className="text-sm text-success">SOL</span>
                    </div>
                    <div className="flex items-center gap-1 mt-2 text-xs font-mono text-success/80">
                        <Zap size={10} />
                        {pricePerGb > 0
                            ? `Rate: ${Number(pricePerGb).toFixed(3)} SOL/GB (gateway bytes)`
                            : 'Rate: unknown: listing price missing'}
                    </div>
                </div>

                {/* Right: Time & Bytes */}
                <div className="z-10 flex flex-col justify-between items-end text-right">
                    <div>
                        <p className="text-xs font-mono font-bold text-muted-foreground mb-1">Duration</p>
                        <div className="text-xl font-bold font-mono text-foreground flex items-center justify-end gap-2">
                            {formatTime(elapsed)}
                            <Clock size={14} className="animate-pulse text-success" />
                        </div>
                    </div>

                    <div className="mt-4">
                        <p className="text-xs font-mono font-bold text-muted-foreground mb-1">Data usage</p>
                        <div className="text-md font-bold font-mono text-foreground flex items-center justify-end gap-2">
                            {formatBytes(bytesUsed)}
                            <HardDrive size={12} className="text-info" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Footer / Controls */}
            <div className="p-4 bg-secondary/5 border-t border-border flex justify-between items-center">
                <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                    <ShieldCheck size={12} className="text-info" />
                    <span>{escrowLabel}</span>
                </div>

                {confirmStop ? (
                    <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1 text-xs font-bold text-destructive font-mono">
                            <AlertTriangle size={10} /> Stop?
                        </span>
                        <button
                            onClick={() => { onTerminate(session.id); setConfirmStop(false); }}
                            aria-label="Confirm stop stream"
                            className="px-3 py-1.5 bg-destructive/20 text-destructive border border-destructive/40 rounded-sm text-xs font-bold font-mono hover:bg-destructive/30 transition-all"
                        >
                            Confirm
                        </button>
                        <button
                            onClick={() => setConfirmStop(false)}
                            aria-label="Cancel stop stream"
                            className="px-3 py-1.5 bg-secondary/30 text-muted-foreground border border-border rounded-sm text-xs font-bold font-mono hover:text-foreground transition-all"
                        >
                            Cancel
                        </button>
                    </div>
                ) : (
                    <button
                        onClick={() => setConfirmStop(true)}
                        aria-label="Stop stream"
                        className="flex items-center gap-2 px-4 py-2 bg-destructive/10 hover:bg-destructive/20 text-destructive border border-destructive/20 hover:border-destructive/50 rounded-sm text-xs font-bold font-mono transition-all"
                    >
                        <Square size={12} fill="currentColor" /> Stop Stream
                    </button>
                )}
            </div>

            {/* Turbo Mode Toggle */}
            <div className="px-4 py-2 bg-secondary border-t border-dashed border-border flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <Zap size={12} className={isTurbo ? 'text-warning animate-pulse' : 'text-muted-foreground'} />
                    <span className={`text-xs font-bold font-mono ${isTurbo ? 'text-warning' : 'text-muted-foreground'}`}>
                        {isTurbo ? 'Turbo L2 channel active' : 'Standard settlement'}
                    </span>
                </div>

                {!isTurbo && (
                    <div className="flex items-center gap-2">
                        {!walletConnected && (
                            <div className="flex items-center gap-1 text-xs font-mono text-warning/70">
                                <AlertCircle size={10} />
                                <span>Wallet required</span>
                            </div>
                        )}
                        <button
                            onClick={activateTurbo}
                            disabled={turboDisabled}
                            title={turboTooltip}
                            className="text-xs font-bold font-mono text-success hover:underline disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline"
                        >
                            {loadingTurbo ? 'Opening…' : 'Upgrade to L2'}
                        </button>
                    </div>
                )}
            </div>

            {/* Progress Bar */}
            <div className="h-0.5 w-full bg-secondary/30">
                <div className="h-full bg-success animate-pulse w-full origin-left"></div>
            </div>
        </div>
    );
}
