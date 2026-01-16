"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { getMyListings, getMySales, type Listing, type Order } from "@/lib/social-api";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Navbar } from "@/components/Navbar";

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
    <div className="min-h-screen" style={{ background: "var(--background)" }}>
      <Navbar />

      <main className="container py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: "var(--foreground)" }}>
              Provider Dashboard
            </h1>
            <p style={{ color: "var(--muted)" }}>
              Manage your listings and track sales
            </p>
          </div>
          <Link href="/marketplace/create" className="btn btn-primary">
            + Create Listing
          </Link>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {(["overview", "listings", "sales"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`btn ${activeTab === tab ? "btn-primary" : "btn-secondary"}`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="spinner"></div>
          </div>
        ) : (
          <>
            {/* Overview Tab */}
            {activeTab === "overview" && (
              <div className="space-y-6">
                {/* Stats Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="card text-center">
                    <div className="text-3xl font-bold mb-1" style={{ color: "var(--primary)" }}>
                      ₵{totalEarnings.toFixed(2)}
                    </div>
                    <div className="text-sm" style={{ color: "var(--muted)" }}>Total Earnings</div>
                  </div>
                  <div className="card text-center">
                    <div className="text-3xl font-bold mb-1" style={{ color: "var(--foreground)" }}>
                      {totalBandwidthSold.toFixed(1)} GB
                    </div>
                    <div className="text-sm" style={{ color: "var(--muted)" }}>Bandwidth Sold</div>
                  </div>
                  <div className="card text-center">
                    <div className="text-3xl font-bold mb-1" style={{ color: "var(--foreground)" }}>
                      {sales.length}
                    </div>
                    <div className="text-sm" style={{ color: "var(--muted)" }}>Total Orders</div>
                  </div>
                  <div className="card text-center">
                    <div className="text-3xl font-bold mb-1" style={{ color: "var(--foreground)" }}>
                      {activeListings}
                    </div>
                    <div className="text-sm" style={{ color: "var(--muted)" }}>Active Listings</div>
                  </div>
                </div>

                {/* Recent Sales */}
                <div className="card">
                  <h2 className="font-semibold mb-4" style={{ color: "var(--foreground)" }}>
                    Recent Sales
                  </h2>
                  {sales.length === 0 ? (
                    <p className="text-center py-8" style={{ color: "var(--muted)" }}>
                      No sales yet. Create a listing to start earning!
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {sales.slice(0, 5).map((sale) => (
                        <div key={sale.id} className="flex items-center justify-between py-2 border-b" style={{ borderColor: "var(--card-border)" }}>
                          <div>
                            <span className="font-medium" style={{ color: "var(--foreground)" }}>
                              {sale.bandwidth_gb} GB
                            </span>
                            <span className="text-sm ml-2" style={{ color: "var(--muted)" }}>
                              to @{sale.buyer?.username || "buyer"}
                            </span>
                          </div>
                          <span className="font-semibold" style={{ color: "var(--success)" }}>
                            +₵{sale.total_price?.toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Listings Tab */}
            {activeTab === "listings" && (
              <div className="space-y-4">
                {listings.length === 0 ? (
                  <div className="card text-center py-12">
                    <p className="mb-4" style={{ color: "var(--muted)" }}>
                      You haven&apos;t created any listings yet.
                    </p>
                    <Link href="/marketplace/create" className="btn btn-primary">
                      Create Your First Listing
                    </Link>
                  </div>
                ) : (
                  listings.map((listing) => (
                    <div key={listing.id} className="card flex items-center gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold" style={{ color: "var(--foreground)" }}>
                            {listing.title}
                          </h3>
                          <span className={`badge ${listing.status === "active" ? "" : "badge-muted"}`}>
                            {listing.status}
                          </span>
                        </div>
                        <div className="text-sm" style={{ color: "var(--muted)" }}>
                          ₵{listing.price_per_gb}/GB • {listing.available_bandwidth_gb} GB available • {listing.orders_count || 0} orders
                        </div>
                      </div>
                      <Link href={`/marketplace/${listing.id}`} className="btn btn-secondary text-sm">
                        View
                      </Link>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Sales Tab */}
            {activeTab === "sales" && (
              <div className="card">
                {sales.length === 0 ? (
                  <p className="text-center py-12" style={{ color: "var(--muted)" }}>
                    No sales yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b" style={{ borderColor: "var(--card-border)" }}>
                          <th className="text-left py-3 px-2 text-sm font-medium" style={{ color: "var(--muted)" }}>Date</th>
                          <th className="text-left py-3 px-2 text-sm font-medium" style={{ color: "var(--muted)" }}>Buyer</th>
                          <th className="text-left py-3 px-2 text-sm font-medium" style={{ color: "var(--muted)" }}>Bandwidth</th>
                          <th className="text-right py-3 px-2 text-sm font-medium" style={{ color: "var(--muted)" }}>Amount</th>
                          <th className="text-left py-3 px-2 text-sm font-medium" style={{ color: "var(--muted)" }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sales.map((sale) => (
                          <tr key={sale.id} className="border-b" style={{ borderColor: "var(--card-border)" }}>
                            <td className="py-3 px-2 text-sm" style={{ color: "var(--foreground)" }}>
                              {new Date(sale.created_at).toLocaleDateString()}
                            </td>
                            <td className="py-3 px-2 text-sm" style={{ color: "var(--foreground)" }}>
                              @{sale.buyer?.username || "unknown"}
                            </td>
                            <td className="py-3 px-2 text-sm" style={{ color: "var(--foreground)" }}>
                              {sale.bandwidth_gb} GB
                            </td>
                            <td className="py-3 px-2 text-sm text-right font-medium" style={{ color: "var(--success)" }}>
                              +₵{sale.total_price?.toFixed(2)}
                            </td>
                            <td className="py-3 px-2">
                              <span className={`badge ${sale.status === "active" ? "" : "badge-muted"}`}>
                                {sale.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
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
