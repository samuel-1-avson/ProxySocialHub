"use client";

import { useState, useEffect } from "react";
import {
    getProviderShowcases,
    getProviderSpeedTests,
    getProviderTestimonials,
    getProviderStats,
    type ProviderShowcase,
    type SpeedTest,
    type Testimonial,
    type ProviderStats,
} from "@/lib/showcase-api";
import { GlassCard } from "@/components/ui/glass-card";
import {
    BarChart3,
    Zap,
    Clock,
    TrendingUp,
    Users,
    Star,
    Quote,
    Award,
    Globe,
    Activity,
    Loader2,
    ChevronLeft,
    ChevronRight,
    CheckCircle2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    LineChart,
    Line,
} from "recharts";

interface ProviderShowcaseProps {
    providerId: string;
}

export function ProviderShowcase({ providerId }: ProviderShowcaseProps) {
    const [showcases, setShowcases] = useState<ProviderShowcase[]>([]);
    const [speedTests, setSpeedTests] = useState<SpeedTest[]>([]);
    const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
    const [stats, setStats] = useState<ProviderStats | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadShowcaseData();
    }, [providerId]);

    const loadShowcaseData = async () => {
        try {
            setLoading(true);
            const [showcasesData, speedTestsData, testimonialsData, statsData] = await Promise.all([
                getProviderShowcases(providerId),
                getProviderSpeedTests(providerId),
                getProviderTestimonials(providerId),
                getProviderStats(providerId),
            ]);
            setShowcases(showcasesData.showcases || []);
            setSpeedTests(speedTestsData.speed_tests || []);
            setTestimonials(testimonialsData.testimonials || []);
            setStats(statsData.stats);
        } catch (err) {
            console.error("Failed to load showcase data:", err);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <GlassCard className="!p-8">
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
            </GlassCard>
        );
    }

    const hasAnyContent = showcases.length > 0 || speedTests.length > 0 || testimonials.length > 0 || stats;

    if (!hasAnyContent) {
        return null;
    }

    return (
        <div className="space-y-6">
            {/* Stats Overview */}
            {stats && <StatsOverview stats={stats} />}

            {/* Speed Tests */}
            {speedTests.length > 0 && <SpeedTestSection speedTests={speedTests} />}

            {/* Testimonials */}
            {testimonials.length > 0 && <TestimonialsSection testimonials={testimonials} />}

            {/* Custom Showcases */}
            {showcases.map((showcase) => (
                <ShowcaseItem key={showcase.id} showcase={showcase} />
            ))}
        </div>
    );
}

// Stats Overview Component
function StatsOverview({ stats }: { stats: ProviderStats }) {
    const statCards = [
        {
            label: "Avg Download",
            value: `${Number(stats.avg_download_speed || 0).toFixed(1)} Mbps`,
            icon: Zap,
            color: "text-emerald-500",
            bgColor: "bg-emerald-500/10",
        },
        {
            label: "Avg Upload",
            value: `${Number(stats.avg_upload_speed || 0).toFixed(1)} Mbps`,
            icon: TrendingUp,
            color: "text-blue-500",
            bgColor: "bg-blue-500/10",
        },
        {
            label: "Avg Latency",
            value: `${stats.avg_latency_ms || 0} ms`,
            icon: Clock,
            color: "text-amber-500",
            bgColor: "bg-amber-500/10",
        },
        {
            label: "Uptime",
            value: `${Number(stats.uptime_percent || 99.9).toFixed(2)}%`,
            icon: Activity,
            color: "text-purple-500",
            bgColor: "bg-purple-500/10",
        },
        {
            label: "Sessions",
            value: stats.total_sessions?.toLocaleString() || 0,
            icon: Globe,
            color: "text-cyan-500",
            bgColor: "bg-cyan-500/10",
        },
        {
            label: "Customers",
            value: stats.active_customers?.toString() || 0,
            icon: Users,
            color: "text-rose-500",
            bgColor: "bg-rose-500/10",
        },
    ];

    return (
        <GlassCard className="!p-6">
            <div className="flex items-center gap-2 mb-6">
                <BarChart3 className="w-5 h-5 text-primary" />
                <h3 className="font-bold font-mono">Performance Metrics</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {statCards.map((stat) => (
                    <div key={stat.label} className="p-4 rounded-xl bg-secondary/20">
                        <div className={`w-10 h-10 rounded-lg ${stat.bgColor} flex items-center justify-center mb-3`}>
                            <stat.icon className={`w-5 h-5 ${stat.color}`} />
                        </div>
                        <p className="text-2xl font-bold font-mono">{stat.value}</p>
                        <p className="text-sm text-muted-foreground">{stat.label}</p>
                    </div>
                ))}
            </div>
        </GlassCard>
    );
}

// Speed Test Section
function SpeedTestSection({ speedTests }: { speedTests: SpeedTest[] }) {
    const [currentIndex, setCurrentIndex] = useState(0);

    const currentTest = speedTests[currentIndex];

    const chartData = speedTests.slice(0, 10).map((test, i) => ({
        name: `#${speedTests.length - i}`,
        download: test.download_speed,
        upload: test.upload_speed,
        latency: test.latency_ms,
    }));

    return (
        <GlassCard className="!p-6">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                    <Zap className="w-5 h-5 text-primary" />
                    <h3 className="font-bold font-mono">Speed Test History</h3>
                </div>
                <span className="text-sm text-muted-foreground font-mono">
                    {currentIndex + 1} / {speedTests.length}
                </span>
            </div>

            {/* Current Test */}
            <div className="grid md:grid-cols-3 gap-4 mb-6">
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                    <p className="text-sm text-muted-foreground mb-1">Download</p>
                    <p className="text-3xl font-bold font-mono text-emerald-500">
                        {Number(currentTest.download_speed || 0).toFixed(1)}
                        <span className="text-lg ml-1">Mbps</span>
                    </p>
                </div>
                <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
                    <p className="text-sm text-muted-foreground mb-1">Upload</p>
                    <p className="text-3xl font-bold font-mono text-blue-500">
                        {Number(currentTest.upload_speed || 0).toFixed(1)}
                        <span className="text-lg ml-1">Mbps</span>
                    </p>
                </div>
                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                    <p className="text-sm text-muted-foreground mb-1">Latency</p>
                    <p className="text-3xl font-bold font-mono text-amber-500">
                        {currentTest.latency_ms}
                        <span className="text-lg ml-1">ms</span>
                    </p>
                </div>
            </div>

            {/* Chart */}
            {speedTests.length > 1 && (
                <div className="h-48 mb-4">
                    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                        <LineChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                            <XAxis dataKey="name" stroke="#666" fontSize={12} />
                            <YAxis stroke="#666" fontSize={12} />
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: "#1a1a1a",
                                    border: "1px solid #333",
                                    borderRadius: "8px",
                                }}
                            />
                            <Line
                                type="monotone"
                                dataKey="download"
                                stroke="#10b981"
                                strokeWidth={2}
                                dot={{ fill: "#10b981", strokeWidth: 0 }}
                                name="Download"
                            />
                            <Line
                                type="monotone"
                                dataKey="upload"
                                stroke="#3b82f6"
                                strokeWidth={2}
                                dot={{ fill: "#3b82f6", strokeWidth: 0 }}
                                name="Upload"
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            )}

            {/* Navigation */}
            {speedTests.length > 1 && (
                <div className="flex items-center justify-between">
                    <button
                        onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                        disabled={currentIndex === 0}
                        className="p-2 rounded-lg hover:bg-secondary disabled:opacity-50 transition-colors"
                    >
                        <ChevronLeft className="w-5 h-5" />
                    </button>
                    <span className="text-xs text-muted-foreground font-mono">
                        Tested {formatDistanceToNow(new Date(currentTest.tested_at))} ago
                    </span>
                    <button
                        onClick={() => setCurrentIndex((i) => Math.min(speedTests.length - 1, i + 1))}
                        disabled={currentIndex === speedTests.length - 1}
                        className="p-2 rounded-lg hover:bg-secondary disabled:opacity-50 transition-colors"
                    >
                        <ChevronRight className="w-5 h-5" />
                    </button>
                </div>
            )}
        </GlassCard>
    );
}

// Testimonials Section
function TestimonialsSection({ testimonials }: { testimonials: Testimonial[] }) {
    const featured = testimonials.filter((t) => t.is_featured);
    const regular = testimonials.filter((t) => !t.is_featured);

    return (
        <GlassCard className="!p-6">
            <div className="flex items-center gap-2 mb-6">
                <Quote className="w-5 h-5 text-primary" />
                <h3 className="font-bold font-mono">Customer Testimonials</h3>
                <span className="ml-auto text-sm text-muted-foreground font-mono">
                    {testimonials.length} reviews
                </span>
            </div>

            {/* Featured Testimonials */}
            {featured.length > 0 && (
                <div className="space-y-4 mb-6">
                    {featured.map((testimonial) => (
                        <FeaturedTestimonialCard key={testimonial.id} testimonial={testimonial} />
                    ))}
                </div>
            )}

            {/* Regular Testimonials */}
            {regular.length > 0 && (
                <div className="grid md:grid-cols-2 gap-4">
                    {regular.slice(0, 4).map((testimonial) => (
                        <TestimonialCard key={testimonial.id} testimonial={testimonial} />
                    ))}
                </div>
            )}
        </GlassCard>
    );
}

// Featured Testimonial Card
function FeaturedTestimonialCard({ testimonial }: { testimonial: Testimonial }) {
    return (
        <div className="p-6 rounded-xl bg-gradient-to-br from-primary/5 to-transparent border border-primary/20">
            <div className="flex items-start gap-1 mb-3">
                {[...Array(5)].map((_, i) => (
                    <Star
                        key={i}
                        className={`w-4 h-4 ${
                            i < testimonial.rating ? "text-yellow-500 fill-yellow-500" : "text-muted-foreground"
                        }`}
                    />
                ))}
            </div>
            <p className="text-lg italic mb-4">&ldquo;{testimonial.content}&rdquo;</p>
            <div className="flex items-center gap-3">
                {testimonial.customer?.avatar_url ? (
                    <img
                        src={testimonial.customer.avatar_url}
                        alt=""
                        className="w-10 h-10 rounded-full object-cover"
                    />
                ) : (
                    <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center">
                        <span className="text-sm font-bold">
                            {testimonial.customer?.username?.[0]?.toUpperCase()}
                        </span>
                    </div>
                )}
                <div>
                    <p className="font-medium font-mono">@{testimonial.customer?.username}</p>
                    {testimonial.is_verified && (
                        <span className="text-xs text-emerald-500 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            Verified Purchase
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}

// Regular Testimonial Card
function TestimonialCard({ testimonial }: { testimonial: Testimonial }) {
    return (
        <div className="p-4 rounded-xl bg-secondary/20">
            <div className="flex items-start gap-1 mb-2">
                {[...Array(5)].map((_, i) => (
                    <Star
                        key={i}
                        className={`w-3 h-3 ${
                            i < testimonial.rating ? "text-yellow-500 fill-yellow-500" : "text-muted-foreground"
                        }`}
                    />
                ))}
            </div>
            <p className="text-sm text-muted-foreground line-clamp-3 mb-3">&ldquo;{testimonial.content}&rdquo;</p>
            <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-primary">@{testimonial.customer?.username}</span>
                {testimonial.is_verified && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
            </div>
        </div>
    );
}

// Showcase Item Component
function ShowcaseItem({ showcase }: { showcase: ProviderShowcase }) {
    return (
        <GlassCard className="!p-6">
            <div className="flex items-center gap-2 mb-4">
                <Award className="w-5 h-5 text-primary" />
                <h3 className="font-bold font-mono">{showcase.title}</h3>
                {showcase.is_featured && (
                    <span className="ml-auto px-2 py-0.5 bg-primary/10 text-primary text-[10px] font-bold font-mono rounded">
                        FEATURED
                    </span>
                )}
            </div>
            <p className="text-muted-foreground mb-4">{showcase.description}</p>

            {/* Media Gallery */}
            {showcase.media_urls && showcase.media_urls.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                    {showcase.media_urls.map((url, index) => (
                        <div key={index} className="aspect-video rounded-lg overflow-hidden bg-secondary">
                            <img src={url} alt="" className="w-full h-full object-cover" />
                        </div>
                    ))}
                </div>
            )}

            {/* Metrics */}
            {showcase.metrics && Object.keys(showcase.metrics).length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {Object.entries(showcase.metrics).map(([key, value]) => (
                        <div key={key} className="p-3 rounded-lg bg-secondary/30">
                            <p className="text-xs text-muted-foreground uppercase font-mono">{key}</p>
                            <p className="text-lg font-bold font-mono">{value}</p>
                        </div>
                    ))}
                </div>
            )}
        </GlassCard>
    );
}

export default ProviderShowcase;
