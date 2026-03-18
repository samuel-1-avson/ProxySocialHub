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
    const [cost, setCost] = useState(0);
    const [confirmStop, setConfirmStop] = useState(false);

    // Turbo Mode States
    const [isTurbo, setIsTurbo] = useState(false);
    const [loadingTurbo, setLoadingTurbo] = useState(false);
    const [channelId, setChannelId] = useState<string | null>(null);
    const nonceRef = useRef(0);

    const toast = useToast();

    // Check if user has a connected Solana wallet — required for Turbo (state channel signing)
    const { connected: walletConnected, publicKey, signMessage } = useWallet();

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
            const pricePerHour = session.listing?.price_per_hour || 0.1;
            const depositHours = 2;
            const minDeposit = 0.05; // safety floor (SOL)
            const calculatedDeposit = Math.max(pricePerHour * depositHours, minDeposit);
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

                const atomicAmount = Math.floor(cost * 1e9);
                const atomicBytes = session.bytes_used || 0;

                const sig = await signStateUpdateWithWallet(channelId, currentNonce, atomicAmount, atomicBytes);
                await updateChannelState(channelId, currentNonce, atomicAmount, atomicBytes, sig);

                console.log(`L2 Update Sent: Nonce ${currentNonce}`);
            } catch (e) {
                console.error('L2 Update Failed', e);
            }
        }, 2000);

        return () => clearInterval(updateInterval);
    }, [isTurbo, channelId, cost, session.bytes_used, signStateUpdateWithWallet]);

    // Real-time cost + elapsed counter
    useEffect(() => {
        if (session.status !== 'active') return;

        const startTime = new Date(session.created_at).getTime();
        const pricePerHour = session.listing?.price_per_hour || 0.1;
        const pricePerMs = pricePerHour / 3600000;

        const interval = setInterval(() => {
            const now = Date.now();
            const diff = now - startTime;
            setElapsed(Math.floor(diff / 1000));
            setCost(diff * pricePerMs);
        }, 1000);

        return () => clearInterval(interval);
    }, [session]);

    const formatTime = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const turboDisabled = !walletConnected || loadingTurbo;
    const turboTooltip = !walletConnected
        ? 'Connect your Solana wallet to enable Turbo L2'
        : loadingTurbo
        ? 'Opening channel...'
        : 'Upgrade to L2 state channel';

    return (
        <div className="card-retro p-0 bg-card overflow-hidden group border-green-500/30 shadow-[0_0_15px_rgba(34,197,94,0.1)]">
            {/* Header / Status Bar */}
            <div className="px-5 py-3 bg-secondary/10 border-b border-border flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <Activity size={16} className="text-green-500" />
                        <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-500 rounded-full animate-ping"></span>
                    </div>
                    <h3 className="text-xs font-bold font-mono uppercase text-green-500 tracking-wider">Stream Active</h3>
                </div>
                <div className="text-[10px] font-mono text-muted-foreground uppercase flex gap-2">
                    <span>ID: {session.id.slice(0, 8)}</span>
                </div>
            </div>

            {/* Main Viz */}
            <div className="p-6 grid grid-cols-2 gap-6 relative">
                {/* Background Grid Animation */}
                <div className="absolute inset-0 bg-[linear-gradient(rgba(34,197,94,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(34,197,94,0.03)_1px,transparent_1px)] bg-[size:20px_20px] pointer-events-none"></div>

                {/* Left: Vested Amount */}
                <div className="z-10">
                    <p className="text-[10px] font-mono font-bold uppercase text-muted-foreground mb-1">Vested Amount</p>
                    <div className="text-3xl font-black font-mono tracking-tighter text-white flex items-baseline gap-1">
                        {cost.toFixed(6)} <span className="text-sm text-green-500">SOL</span>
                    </div>
                    <div className="flex items-center gap-1 mt-2 text-[10px] font-mono text-green-400/80">
                        <Zap size={10} />
                        Rate: {(session.listing?.price_per_hour || 0.1).toFixed(3)} SOL/hr
                    </div>
                </div>

                {/* Right: Time & Bytes */}
                <div className="z-10 flex flex-col justify-between items-end text-right">
                    <div>
                        <p className="text-[10px] font-mono font-bold uppercase text-muted-foreground mb-1">Duration</p>
                        <div className="text-xl font-bold font-mono text-white flex items-center justify-end gap-2">
                            {formatTime(elapsed)}
                            <Clock size={14} className="animate-pulse text-green-500" />
                        </div>
                    </div>

                    <div className="mt-4">
                        <p className="text-[10px] font-mono font-bold uppercase text-muted-foreground mb-1">Data Usage</p>
                        <div className="text-md font-bold font-mono text-white flex items-center justify-end gap-2">
                            {((session.bytes_used || 0) / (1024 * 1024)).toFixed(2)} MB
                            <HardDrive size={12} className="text-blue-400" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Footer / Controls */}
            <div className="p-4 bg-secondary/5 border-t border-border flex justify-between items-center">
                <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
                    <ShieldCheck size={12} className="text-blue-500" />
                    <span>On-Chain Escrow: {session.tx_hash?.slice(0, 6) || 'Pending'}...</span>
                </div>

                {confirmStop ? (
                    <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1 text-[10px] font-bold text-red-500 font-mono uppercase">
                            <AlertTriangle size={10} /> Stop?
                        </span>
                        <button
                            onClick={() => { onTerminate(session.id); setConfirmStop(false); }}
                            aria-label="Confirm stop stream"
                            className="px-3 py-1.5 bg-red-500/20 text-red-500 border border-red-500/40 rounded-sm text-[10px] font-bold font-mono uppercase hover:bg-red-500/30 transition-all"
                        >
                            Confirm
                        </button>
                        <button
                            onClick={() => setConfirmStop(false)}
                            aria-label="Cancel stop stream"
                            className="px-3 py-1.5 bg-secondary/30 text-muted-foreground border border-border rounded-sm text-[10px] font-bold font-mono uppercase hover:text-foreground transition-all"
                        >
                            Cancel
                        </button>
                    </div>
                ) : (
                    <button
                        onClick={() => setConfirmStop(true)}
                        aria-label="Stop stream"
                        className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 hover:border-red-500/50 rounded-sm text-xs font-bold font-mono uppercase transition-all"
                    >
                        <Square size={12} fill="currentColor" /> Stop Stream
                    </button>
                )}
            </div>

            {/* Turbo Mode Toggle */}
            <div className="px-4 py-2 bg-black/40 border-t border-dashed border-border flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <Zap size={12} className={isTurbo ? 'text-yellow-400 animate-pulse' : 'text-muted-foreground'} />
                    <span className={`text-[10px] font-bold font-mono uppercase ${isTurbo ? 'text-yellow-400' : 'text-muted-foreground'}`}>
                        {isTurbo ? 'TURBO L2 CHANNEL ACTIVE' : 'STANDARD SETTLEMENT'}
                    </span>
                </div>

                {!isTurbo && (
                    <div className="flex items-center gap-2">
                        {!walletConnected && (
                            <div className="flex items-center gap-1 text-[9px] font-mono text-yellow-500/70">
                                <AlertCircle size={10} />
                                <span>Wallet required</span>
                            </div>
                        )}
                        <button
                            onClick={activateTurbo}
                            disabled={turboDisabled}
                            title={turboTooltip}
                            className="text-[10px] font-bold font-mono uppercase text-green-500 hover:underline disabled:opacity-40 disabled:cursor-not-allowed disabled:no-underline"
                        >
                            {loadingTurbo ? 'OPENING...' : 'UPGRADE TO L2'}
                        </button>
                    </div>
                )}
            </div>

            {/* Progress Bar */}
            <div className="h-0.5 w-full bg-secondary/30">
                <div className="h-full bg-green-500 animate-pulse w-full origin-left"></div>
            </div>
        </div>
    );
}
