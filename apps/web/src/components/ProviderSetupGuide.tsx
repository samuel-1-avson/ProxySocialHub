'use client';

import { useState, useEffect } from 'react';
import { 
    Terminal, 
    Download, 
    Copy, 
    CheckCircle, 
    Server, 
    Wifi, 
    Coins,
    AlertCircle,
    ChevronRight,
    ChevronDown,
    ExternalLink,
    Zap,
    Loader2,
    Shield,
    RefreshCw,
    Eye,
    EyeOff,
    Trash2,
    type LucideIcon,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { GlassCard } from '@/components/ui/glass-card';
import { 
    getCLIDownloads, 
    getCLIDownloadUrl, 
    detectPlatform, 
    createProviderToken, 
    getProviderTokens,
    revokeProviderToken,
    type CLIDownload,
    type ProviderToken,
    type CreateTokenResponse
} from '@/lib/api/provider';
import { getErrorMessage } from '@/lib/utils';

interface SetupStep {
    id: number;
    title: string;
    description: string;
    icon: LucideIcon;
    content: React.ReactNode;
}

export function ProviderSetupGuide() {
    const [expandedStep, setExpandedStep] = useState<number>(1);
    const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
    
    // CLI Download state
    const [cliDownloads, setCliDownloads] = useState<Record<string, CLIDownload> | null>(null);
    const [cliLoading, setCliLoading] = useState(true);
    const [cliError, setCliError] = useState<string | null>(null);
    
    // Token state
    const [tokens, setTokens] = useState<ProviderToken[]>([]);
    const [newToken, setNewToken] = useState<CreateTokenResponse | null>(null);
    const [tokenName, setTokenName] = useState('');
    const [showToken, setShowToken] = useState(false);
    const [tokenLoading, setTokenLoading] = useState(false);
    const [tokenError, setTokenError] = useState<string | null>(null);

    // Load CLI downloads and tokens on mount
    useEffect(() => {
        loadCLIDownloads();
        loadTokens();
    }, []);

    const loadCLIDownloads = async () => {
        try {
            setCliLoading(true);
            const data = await getCLIDownloads();
            setCliDownloads(data.downloads);
        } catch (err) {
            setCliError('Failed to load CLI downloads');
            console.error(err);
        } finally {
            setCliLoading(false);
        }
    };

    const loadTokens = async () => {
        try {
            const data = await getProviderTokens();
            setTokens(data.tokens);
        } catch (err) {
            console.error('Failed to load tokens:', err);
        }
    };

    const copyToClipboard = (text: string, commandId: string) => {
        navigator.clipboard.writeText(text);
        setCopiedCommand(commandId);
        setTimeout(() => setCopiedCommand(null), 3000);
    };

    const handleGenerateToken = async () => {
        if (!tokenName.trim()) {
            setTokenError('Please enter a token name');
            return;
        }
        
        setTokenLoading(true);
        setTokenError(null);
        
        try {
            const token = await createProviderToken({
                name: tokenName,
                expires_in: 365 // 1 year default
            });
            setNewToken(token);
            setTokenName('');
            loadTokens(); // Refresh list
        } catch (err: unknown) {
            setTokenError(getErrorMessage(err) || 'Failed to generate token');
        } finally {
            setTokenLoading(false);
        }
    };

    const handleRevokeToken = async (tokenId: string) => {
        if (!confirm('Are you sure you want to revoke this token?')) return;
        
        try {
            await revokeProviderToken(tokenId);
            loadTokens();
        } catch (err) {
            console.error('Failed to revoke token:', err);
        }
    };

    const handleDownload = (platform: string, arch: string, version: string) => {
        const url = getCLIDownloadUrl(platform, arch, version);
        window.open(url, '_blank');
    };

    const getDownloadForPlatform = () => {
        const { platform, arch } = detectPlatform();
        const key = `${platform}_${arch}`;
        return cliDownloads?.[key];
    };

    const steps: SetupStep[] = [
        {
            id: 1,
            title: 'Download the Provider CLI',
            description: 'Get the CLI tool for your operating system',
            icon: Download,
            content: (
                <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        The Provider CLI is a lightweight application that connects your machine to the ProxyHubb network. 
                        Choose your platform below:
                    </p>
                    
                    {cliLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="w-6 h-6 animate-spin text-primary" />
                        </div>
                    ) : cliError ? (
                        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                            <p className="text-sm text-red-400">{cliError}</p>
                            <button 
                                onClick={loadCLIDownloads}
                                className="mt-2 text-xs text-primary hover:underline"
                            >
                                Retry
                            </button>
                        </div>
                    ) : (
                        <>
                            {/* Auto-detected platform */}
                            {(() => {
                                const download = getDownloadForPlatform();
                                if (download) {
                                    return (
                                        <GlassCard className="p-4 border-primary/20 bg-primary/5">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center border border-primary/30">
                                                        <Download size={20} className="text-primary" />
                                                    </div>
                                                    <div>
                                                        <div className="text-sm font-bold">Recommended for your system</div>
                                                        <div className="text-xs text-muted-foreground">
                                                            {download.platform} ({download.arch}) • v{download.version}
                                                        </div>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => handleDownload(
                                                        detectPlatform().platform,
                                                        detectPlatform().arch,
                                                        download.version
                                                    )}
                                                    className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-primary/90 transition-all flex items-center gap-2"
                                                >
                                                    <Download size={14} /> Download
                                                </button>
                                            </div>
                                        </GlassCard>
                                    );
                                }
                                return null;
                            })()}
                            
                            {/* All platforms */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {cliDownloads && Object.entries(cliDownloads).map(([key, download]) => (
                                    <GlassCard key={key} className="p-4 border-white/5 bg-white/[0.02] hover:bg-white/[0.05] transition-all">
                                        <div className="flex items-center gap-3 mb-3">
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${
                                                download.platform === 'windows' ? 'bg-blue-500/10 border-blue-500/20' :
                                                download.platform === 'macos' ? 'bg-purple-500/10 border-purple-500/20' :
                                                'bg-yellow-500/10 border-yellow-500/20'
                                            }`}>
                                                <span className={`font-bold text-sm ${
                                                    download.platform === 'windows' ? 'text-blue-400' :
                                                    download.platform === 'macos' ? 'text-purple-400' :
                                                    'text-yellow-400'
                                                }`}>
                                                    {download.platform === 'windows' ? 'Win' : 
                                                     download.platform === 'macos' ? 'Mac' : 'Lin'}
                                                </span>
                                            </div>
                                            <div>
                                                <div className="text-sm font-bold">{download.platform}</div>
                                                <div className="text-[10px] text-muted-foreground">{download.arch}</div>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleDownload(download.platform, download.arch, download.version)}
                                            className="w-full py-2 px-3 bg-primary/10 hover:bg-primary/20 border border-primary/20 rounded-lg text-[10px] font-bold uppercase tracking-wider text-primary transition-all flex items-center justify-center gap-2"
                                        >
                                            <Download size={12} /> Download
                                        </button>
                                    </GlassCard>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            )
        },
        {
            id: 2,
            title: 'Get Your Access Token',
            description: 'Generate an API token to authenticate your node',
            icon: Zap,
            content: (
                <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        Your access token authenticates your CLI with the network. Keep this secure — treat it like a password.
                    </p>
                    
                    <GlassCard className="p-4 border-yellow-500/20 bg-yellow-500/5">
                        <div className="flex items-start gap-3">
                            <AlertCircle size={18} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                            <div>
                                <div className="text-sm font-bold text-yellow-400 mb-1">Token Security</div>
                                <p className="text-xs text-muted-foreground">
                                    Your token will be shown only once when created. Store it in a secure location. 
                                    If compromised, revoke it immediately and generate a new one.
                                </p>
                            </div>
                        </div>
                    </GlassCard>

                    {/* New Token Display */}
                    {newToken && (
                        <GlassCard className="p-4 border-emerald-500/20 bg-emerald-500/5">
                            <div className="flex items-center gap-2 mb-3">
                                <CheckCircle size={16} className="text-emerald-400" />
                                <span className="text-sm font-bold text-emerald-400">Token Created Successfully!</span>
                            </div>
                            <div className="space-y-2">
                                <div className="text-xs text-muted-foreground">
                                    Copy this token now. You won&#39;t be able to see it again:
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="flex-1 bg-black/60 border border-white/10 rounded-lg px-3 py-2 font-mono text-xs text-white/70 truncate">
                                        {showToken ? newToken.token : newToken.token.substring(0, 8) + '••••••••••••••••••••••••'}
                                    </div>
                                    <button
                                        onClick={() => setShowToken(!showToken)}
                                        className="p-2 glass-card border-white/10 hover:border-primary/50 rounded-lg text-muted-foreground hover:text-primary transition-all"
                                    >
                                        {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                                    </button>
                                    <button
                                        onClick={() => copyToClipboard(newToken.token, 'new-token')}
                                        className="p-2 glass-card border-white/10 hover:border-primary/50 rounded-lg text-muted-foreground hover:text-primary transition-all"
                                    >
                                        {copiedCommand === 'new-token' ? <CheckCircle size={14} className="text-emerald-400" /> : <Copy size={14} />}
                                    </button>
                                </div>
                            </div>
                        </GlassCard>
                    )}
                    
                    {/* Generate Token Form */}
                    <div className="flex items-center gap-3">
                        <input
                            type="text"
                            value={tokenName}
                            onChange={(e) => setTokenName(e.target.value)}
                            placeholder="e.g., My Home Server"
                            className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm focus:border-primary/50 focus:outline-none"
                        />
                        <button
                            onClick={handleGenerateToken}
                            disabled={tokenLoading}
                            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-bold hover:bg-primary/90 transition-all disabled:opacity-50 flex items-center gap-2"
                        >
                            {tokenLoading ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                            Generate Token
                        </button>
                    </div>
                    
                    {tokenError && (
                        <p className="text-xs text-red-400">{tokenError}</p>
                    )}

                    {/* Existing Tokens */}
                    {tokens.length > 0 && (
                        <div className="mt-6 space-y-3">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Your Tokens</h4>
                            {tokens.map((token) => (
                                <div key={token.id} className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-lg">
                                    <div>
                                        <div className="text-sm font-medium">{token.name}</div>
                                        <div className="text-xs text-muted-foreground font-mono">{token.masked}</div>
                                        <div className="text-[10px] text-muted-foreground mt-1">
                                            Created {new Date(token.created_at).toLocaleDateString()}
                                            {token.last_used && ` • Last used ${new Date(token.last_used).toLocaleDateString()}`}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleRevokeToken(token.id)}
                                        className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                                        title="Revoke token"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )
        },
        {
            id: 3,
            title: 'Connect Your Node',
            description: 'Run the CLI to start earning',
            icon: Wifi,
            content: (
                <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        Open your terminal and run these commands to start your node. The CLI will automatically 
                        register your node and establish a secure tunnel to the network.
                    </p>
                    
                    <div className="space-y-3">
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">1. Initialize Configuration</span>
                                <button 
                                    onClick={() => copyToClipboard('provider-node register', 'init')}
                                    className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-1"
                                >
                                    {copiedCommand === 'init' ? <CheckCircle size={10} /> : <Copy size={10} />}
                                    {copiedCommand === 'init' ? 'Copied!' : 'Copy'}
                                </button>
                            </div>
                            <div className="bg-black/60 border border-white/5 rounded-xl p-4 font-mono text-xs text-white/70">
                                <span className="text-emerald-500">$</span> provider-node register
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">2. Start Your Node</span>
                                <button 
                                    onClick={() => copyToClipboard('provider-node start --config provider.toml', 'start')}
                                    className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-1"
                                >
                                    {copiedCommand === 'start' ? <CheckCircle size={10} /> : <Copy size={10} />}
                                    {copiedCommand === 'start' ? 'Copied!' : 'Copy'}
                                </button>
                            </div>
                            <div className="bg-black/60 border border-white/5 rounded-xl p-4 font-mono text-xs text-white/70">
                                <span className="text-emerald-500">$</span> provider-node start --config <span className="text-primary">provider.toml</span>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">3. Run as Service (Optional)</span>
                                <button 
                                    onClick={() => copyToClipboard('proxyhubb-cli start --config provider.toml', 'service')}
                                    className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-1"
                                >
                                    {copiedCommand === 'service' ? <CheckCircle size={10} /> : <Copy size={10} />}
                                    {copiedCommand === 'service' ? 'Copied!' : 'Copy'}
                                </button>
                            </div>
                            <div className="bg-black/60 border border-white/5 rounded-xl p-4 font-mono text-xs text-white/70">
                                <span className="text-emerald-500">$</span> proxyhubb-cli start --config provider.toml
                            </div>
                        </div>
                    </div>
                </div>
            )
        }
    ];

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="text-center space-y-2 pb-6 border-b border-white/5">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
                    <Coins size={12} /> Usage-Based Earnings
                </div>
                <h2 className="text-2xl font-black font-mono uppercase tracking-tight">Start Earning</h2>
                <p className="text-sm text-muted-foreground max-w-lg mx-auto">
                    Share your bandwidth and earn SOL. The more quality connections you provide, 
                    the more you earn. No manual pricing needed — earnings are calculated automatically 
                    based on usage and quality score.
                </p>
            </div>

            {/* How Earnings Work */}
            <GlassCard className="p-6 border-emerald-500/10 bg-emerald-500/5">
                <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 flex-shrink-0">
                        <Zap size={24} className="text-emerald-400" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold mb-2">How You Earn</h3>
                        <ul className="space-y-2 text-sm text-muted-foreground">
                            <li className="flex items-center gap-2">
                                <CheckCircle size={14} className="text-emerald-400 flex-shrink-0" />
                                <span><strong>Pay-as-you-go:</strong> Consumers pay for actual bandwidth used through your node</span>
                            </li>
                            <li className="flex items-center gap-2">
                                <CheckCircle size={14} className="text-emerald-400 flex-shrink-0" />
                                <span><strong>Quality multiplier:</strong> Higher trust scores earn more per GB (up to 2x bonus)</span>
                            </li>
                            <li className="flex items-center gap-2">
                                <CheckCircle size={14} className="text-emerald-400 flex-shrink-0" />
                                <span><strong>Automatic pricing:</strong> Market rates adjust based on demand and your node tier</span>
                            </li>
                            <li className="flex items-center gap-2">
                                <CheckCircle size={14} className="text-emerald-400 flex-shrink-0" />
                                <span><strong>SOL payouts:</strong> Earnings sent directly to your connected Solana wallet</span>
                            </li>
                        </ul>
                    </div>
                </div>
            </GlassCard>

            {/* Setup Steps */}
            <div className="space-y-3">
                <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground px-1">Setup Steps</h3>
                {steps.map((step) => (
                    <GlassCard 
                        key={step.id} 
                        className={`border-white/5 overflow-hidden transition-all ${expandedStep === step.id ? 'bg-white/[0.03]' : 'bg-white/[0.01] hover:bg-white/[0.02]'}`}
                    >
                        <button
                            onClick={() => setExpandedStep(expandedStep === step.id ? 0 : step.id)}
                            className="w-full p-4 flex items-center justify-between text-left"
                        >
                            <div className="flex items-center gap-4">
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all ${
                                    expandedStep === step.id 
                                        ? 'bg-primary/20 border-primary/30 text-primary' 
                                        : 'bg-white/5 border-white/10 text-muted-foreground'
                                }`}>
                                    <step.icon size={18} />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-bold text-primary uppercase tracking-wider">Step {step.id}</span>
                                    </div>
                                    <div className="font-bold">{step.title}</div>
                                    <div className="text-xs text-muted-foreground">{step.description}</div>
                                </div>
                            </div>
                            <ChevronDown 
                                size={18} 
                                className={`text-muted-foreground transition-transform ${expandedStep === step.id ? 'rotate-180' : ''}`} 
                            />
                        </button>
                        
                        <AnimatePresence>
                            {expandedStep === step.id && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.2 }}
                                >
                                    <div className="px-4 pb-4 pt-2 border-t border-white/5">
                                        {step.content}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </GlassCard>
                ))}
            </div>

            {/* Status Check */}
            <GlassCard className="p-6 border-white/5 bg-white/[0.02]">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center border border-blue-500/20">
                            <Server size={24} className="text-blue-400" />
                        </div>
                        <div>
                            <h3 className="font-bold">Node Status Check</h3>
                            <p className="text-xs text-muted-foreground">Run diagnostics to verify your setup</p>
                        </div>
                    </div>
                    <button className="px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 rounded-lg text-[10px] font-bold uppercase tracking-wider text-blue-400 transition-all flex items-center gap-2">
                        <Terminal size={14} /> Run Diagnostics
                    </button>
                </div>
            </GlassCard>

            {/* Documentation Link */}
            <div className="flex items-center justify-center gap-2 text-[10px] text-muted-foreground">
                <span>Need more help?</span>
                <a href="#" className="text-primary hover:underline flex items-center gap-1">
                    View Full Documentation <ExternalLink size={10} />
                </a>
            </div>
        </div>
    );
}
