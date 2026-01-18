"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { getMyListings, getMySales, type Listing, type Order } from "@/lib/social-api";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import {
  BarChart3,
  Plus,
  DollarSign,
  Activity,
  ShoppingBag,
  Package,
  ArrowUpRight,
  Users,
  Eye,
  ChevronRight,
  ExternalLink
} from "lucide-react";

function ProviderDashboardContent() {
  const { } = useAuth();
  const [listings, setListings] = useState<Listing[]>([]);
  const [sales, setSales] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "listings" | "sales">("overview");

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const [listingsData, salesData] = await Promise.all([
          getMyListings(),
          getMySales(),
        ]);
        setListings(listingsData.listings || []);
        setSales(salesData.sales || []);
      } catch {
        // Handle error silently for now
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // Calculate stats
  const totalEarnings = sales.reduce((sum, s) => sum + (s.total_price || 0), 0);
  const totalBandwidthSold = sales.reduce((sum, s) => sum + (s.bandwidth_gb || 0), 0);
  const activeListings = listings.filter(l => l.status === "active").length;

  return (
    <div className="relative min-h-[calc(100vh-120px)]">
      {/* Decorative Background Elements */}
      <div className="absolute -top-24 -right-24 w-96 h-96 bg-primary/10 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-primary/5 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10 relative">
        <div>
          <h1 className="text-4xl font-bold tracking-tighter text-white mb-2">
            Provider Dashboard
          </h1>
          <p className="text-muted-foreground flex items-center gap-2">
            <Activity size={14} className="text-primary" />
            Manage your network infrastructure and track earnings
          </p>
        </div>
        <Link
          href="/marketplace/create"
          className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-2xl font-bold hover:opacity-90 transition-all shadow-lg shadow-primary/20 hover:shadow-primary/40 active:scale-95 group"
        >
          <Plus size={18} className="transition-transform group-hover:rotate-90" />
          <span>Create New Listing</span>
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex p-1.5 bg-white/[0.03] backdrop-blur-3xl border border-white/5 rounded-2xl w-fit mb-8 relative">
        {(["overview", "listings", "sales"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 ${activeTab === tab
              ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
              : "text-muted-foreground hover:text-white hover:bg-white/5"
              }`}
          >
            {tab === "overview" && <BarChart3 size={16} />}
            {tab === "listings" && <Package size={16} />}
            {tab === "sales" && <ShoppingBag size={16} />}
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-32 space-y-4">
          <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
          <p className="text-muted-foreground font-medium animate-pulse">Syncing distribution data...</p>
        </div>
      ) : (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-1000">
          {/* Overview Tab */}
          {activeTab === "overview" && (
            <div className="space-y-8">
              {/* Stats Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {[
                  { label: "Total Earnings", value: `₵${totalEarnings.toFixed(2)}`, icon: <DollarSign className="text-primary" />, trend: "+₵12.50 today" },
                  { label: "Bandwidth Sold", value: `${totalBandwidthSold.toFixed(1)} GB`, icon: <Activity className="text-blue-400" />, trend: "Across 4 nodes" },
                  { label: "Total Orders", value: sales.length.toString(), icon: <ShoppingBag className="text-purple-400" />, trend: "72% conversion" },
                  { label: "Active Listings", value: activeListings.toString(), icon: <Package className="text-orange-400" />, trend: "Global availability" },
                ].map((stat, i) => (
                  <div key={i} className="group p-6 bg-white/[0.03] backdrop-blur-3xl border border-white/5 rounded-3xl hover:border-white/10 transition-all duration-500 hover:-translate-y-1">
                    <div className="flex items-center justify-between mb-4">
                      <div className="p-3 bg-white/[0.03] rounded-2xl group-hover:bg-primary/10 transition-colors">
                        {stat.icon}
                      </div>
                      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-50">{stat.label}</div>
                    </div>
                    <div className="text-3xl font-bold text-white tracking-tighter mb-1">{stat.value}</div>
                    <div className="text-[11px] text-muted-foreground font-medium">{stat.trend}</div>
                  </div>
                ))}
              </div>

              {/* Recent Sales Section */}
              <div className="bg-white/[0.03] backdrop-blur-3xl border border-white/5 rounded-3xl overflow-hidden">
                <div className="p-6 border-b border-white/5 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-white tracking-tight">Recent Infrastructure Sales</h2>
                    <p className="text-xs text-muted-foreground">Most recent bandwidth acquisitions by global buyers</p>
                  </div>
                  <button onClick={() => setActiveTab('sales')} className="text-xs font-bold text-primary hover:underline flex items-center gap-1">
                    View Ledger <ChevronRight size={14} />
                  </button>
                </div>

                <div className="p-2">
                  {sales.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
                      <div className="w-16 h-16 rounded-full bg-white/[0.02] border border-white/5 flex items-center justify-center">
                        <ShoppingBag size={32} className="text-white/10" />
                      </div>
                      <div className="space-y-1">
                        <p className="font-bold text-white/50">Inert Infrastructure</p>
                        <p className="text-sm text-muted-foreground max-w-[250px]">No bandwidth has been acquired yet. Nodes are operational.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {sales.slice(0, 5).map((sale) => (
                        <div key={sale.id} className="group flex items-center justify-between p-4 rounded-2xl hover:bg-white/[0.02] transition-all border border-transparent hover:border-white/5">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                              <ArrowUpRight size={20} />
                            </div>
                            <div>
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="font-bold text-white tracking-tight">{sale.bandwidth_gb} GB Bandwidth Ticket</span>
                                <span className="text-[10px] bg-white/[0.05] text-muted-foreground px-2 py-0.5 rounded-full uppercase tracking-tighter">Settled</span>
                              </div>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Users size={12} />
                                <span>Acquired by <span className="text-white/60">@{sale.buyer?.username || "anonymous"}</span></span>
                                <span>•</span>
                                <span>{new Date(sale.created_at).toLocaleDateString()}</span>
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-bold text-primary">₵{sale.total_price?.toFixed(2)}</div>
                            <div className="text-[10px] text-muted-foreground uppercase font-bold opacity-40">Revenue</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Listings Tab */}
          {activeTab === "listings" && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {listings.length === 0 ? (
                <div className="col-span-full bg-white/[0.03] backdrop-blur-3xl border border-white/5 rounded-3xl p-20 flex flex-col items-center justify-center text-center space-y-6">
                  <div className="w-24 h-24 rounded-3xl bg-white/[0.02] border border-white/5 flex items-center justify-center shadow-2xl">
                    <Plus size={48} className="text-primary/40 animate-pulse" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-2xl font-bold text-white tracking-tighter">No Active Nodes</h3>
                    <p className="text-muted-foreground max-w-sm mx-auto">
                      Your infrastructure is not yet visible on the marketplace. Create a listing to begin monetizing your bandwidth.
                    </p>
                  </div>
                  <Link
                    href="/marketplace/create"
                    className="flex items-center gap-2 px-8 py-4 bg-primary text-primary-foreground rounded-2xl font-bold shadow-xl shadow-primary/20 hover:shadow-primary/40 transition-all active:scale-95"
                  >
                    Deploy First Listing
                  </Link>
                </div>
              ) : (
                listings.map((listing) => (
                  <div key={listing.id} className="group bg-white/[0.03] backdrop-blur-3xl border border-white/5 rounded-3xl overflow-hidden hover:border-primary/30 transition-all duration-500">
                    <div className="p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest ${listing.status === "active" ? "bg-primary/20 text-primary" : "bg-white/[0.05] text-muted-foreground"
                          }`}>
                          {listing.status}
                        </div>
                        <div className="text-white/20">
                          <ExternalLink size={16} />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <h3 className="text-xl font-bold text-white tracking-tighter leading-none group-hover:text-primary transition-colors">
                          {listing.title}
                        </h3>
                        <p className="text-xs text-muted-foreground line-clamp-1">{listing.description || "Premium proxy infrastructure node"}</p>
                      </div>

                      <div className="grid grid-cols-2 gap-4 py-4 border-y border-white/5">
                        <div>
                          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-40 mb-1">Price / GB</p>
                          <p className="text-lg font-bold text-white">₵{listing.price_per_gb}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest opacity-40 mb-1">Available</p>
                          <p className="text-lg font-bold text-white">{listing.available_bandwidth_gb} GB</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2">
                        <div className="flex items-center gap-2">
                          <div className="flex -space-x-2">
                            {[1, 2, 3].map(i => (
                              <div key={i} className="w-6 h-6 rounded-full bg-white/[0.05] border border-black/20 flex items-center justify-center text-[10px] font-bold text-white/40">
                                {i}
                              </div>
                            ))}
                          </div>
                          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">
                            {listing.orders_count || 0} Distributions
                          </span>
                        </div>
                        <Link
                          href={`/marketplace/${listing.id}`}
                          className="p-2 rounded-xl bg-white/[0.05] text-white hover:bg-primary hover:text-primary-foreground transition-all"
                        >
                          <Eye size={18} />
                        </Link>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Sales Tab */}
          {activeTab === "sales" && (
            <div className="bg-white/[0.03] backdrop-blur-3xl border border-white/5 rounded-3xl overflow-hidden shadow-2xl">
              {sales.length === 0 ? (
                <div className="p-20 text-center space-y-6">
                  <div className="w-20 h-20 rounded-full bg-white/[0.02] border border-white/5 flex items-center justify-center mx-auto">
                    <BarChart3 size={32} className="text-white/10" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-xl font-bold text-white tracking-tight">Ledger Empty</h3>
                    <p className="text-muted-foreground text-sm max-w-xs mx-auto">Transactional history will materialize here once network traffic is routed through your nodes.</p>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-white/[0.02] border-b border-white/5">
                        <th className="text-left py-5 px-6 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Acquisition Date</th>
                        <th className="text-left py-5 px-6 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Buyer Identity</th>
                        <th className="text-left py-5 px-6 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Throughput Allocation</th>
                        <th className="text-right py-5 px-6 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Transaction Value</th>
                        <th className="text-center py-5 px-6 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {sales.map((sale) => (
                        <tr key={sale.id} className="hover:bg-white/[0.01] transition-colors group">
                          <td className="py-5 px-6">
                            <div className="flex flex-col">
                              <span className="text-sm font-medium text-white/90">{new Date(sale.created_at).toLocaleDateString()}</span>
                              <span className="text-[10px] text-muted-foreground">{new Date(sale.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                          </td>
                          <td className="py-5 px-6">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center text-[10px] font-bold text-primary ring-1 ring-primary/20">
                                {(sale.buyer?.username?.[0] || 'B').toUpperCase()}
                              </div>
                              <span className="text-sm font-semibold text-white/80 group-hover:text-primary transition-colors">
                                @{sale.buyer?.username || "anonymous"}
                              </span>
                            </div>
                          </td>
                          <td className="py-5 px-6 text-sm font-medium text-white/70">
                            {sale.bandwidth_gb} Gigabytes
                          </td>
                          <td className="py-5 px-6 text-right">
                            <span className="text-sm font-bold text-primary">+₵{sale.total_price?.toFixed(2)}</span>
                          </td>
                          <td className="py-5 px-6">
                            <div className="flex justify-center">
                              <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${sale.status === "active" ? "bg-green-500/10 text-green-500" : "bg-white/5 text-muted-foreground"
                                }`}>
                                {sale.status}
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ProviderDashboardPage() {
  return (
    <ProtectedRoute requiredRole="provider">
      <ProviderDashboardContent />
    </ProtectedRoute>
  );
}
