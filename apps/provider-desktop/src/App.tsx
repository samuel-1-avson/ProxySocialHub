import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Globe, Settings, Plug, ShoppingCart, Clock, BarChart, CheckCircle, XCircle, Coins, Upload, Download, Database, Network, TrendingUp, DollarSign, Lightbulb, Package } from "lucide-react";
import "./App.css";

interface ProviderStats {
  connected: boolean;
  total_bytes_up: number;
  total_bytes_down: number;
  total_gb: number;
  total_connections: number;
  active_connections: number;
  earnings_ghs: number;
  session_duration_secs: number;
  within_schedule: boolean;
  within_bandwidth_limit: boolean;
}

interface ProviderSettings {
  auto_connect: boolean;
  auto_reconnect: boolean;
  reconnect_delay_secs: number;
  max_reconnect_attempts: number;
  daily_bandwidth_limit_gb: number;
  monthly_bandwidth_limit_gb: number;
  schedule_enabled: boolean;
  schedule_start_hour: number;
  schedule_end_hour: number;
  schedule_days: string[];
  gateway_url: string;
}

// Marketplace types
interface MarketplaceListing {
  id: string;
  title: string;
  price_per_gb: number;
  available_bandwidth_gb: number;
  orders_count: number;
  status: string;
}

interface MarketplaceSale {
  id: string;
  bandwidth_gb: number;
  total_price: number;
  buyer_username: string;
  created_at: string;
}

interface MarketplaceStats {
  total_earnings: number;
  total_bandwidth_sold: number;
  active_listings: number;
  total_orders: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatDuration(secs: number): string {
  const hours = Math.floor(secs / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${hours}h ${mins}m ${s}s`;
}

function App() {
  const [stats, setStats] = useState<ProviderStats | null>(null);
  const [settings, setSettings] = useState<ProviderSettings | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Marketplace state
  const [activeTab, setActiveTab] = useState<"gateway" | "marketplace">("gateway");
  const [marketplaceStats, setMarketplaceStats] = useState<MarketplaceStats | null>(null);
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [sales, setSales] = useState<MarketplaceSale[]>([]);

  // Refresh stats every 2 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const data = await invoke<ProviderStats>("get_provider_stats");
        setStats(data);
      } catch (e) {
        console.error("Failed to get stats:", e);
      }
    }, 2000);

    // Initial fetch
    invoke<ProviderStats>("get_provider_stats").then(setStats);
    invoke<ProviderSettings>("get_settings").then(setSettings);

    // Fetch marketplace data (simulated - would be from API)
    fetchMarketplaceData();

    return () => clearInterval(interval);
  }, []);

  async function fetchMarketplaceData() {
    // In a real implementation, this would call the control API
    // For now, we simulate with placeholder data
    try {
      // These would be actual Tauri invoke calls to fetch from the API
      setMarketplaceStats({
        total_earnings: 0,
        total_bandwidth_sold: 0,
        active_listings: 0,
        total_orders: 0,
      });
      setListings([]);
      setSales([]);
    } catch (e) {
      console.error("Failed to fetch marketplace data:", e);
    }
  }

  async function connect() {
    setConnecting(true);
    setError(null);
    try {
      const url = settings?.gateway_url || "127.0.0.1:4000";
      await invoke("connect_gateway", { gatewayUrl: url });
    } catch (e) {
      setError(String(e));
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    try {
      await invoke("disconnect_gateway");
    } catch (e) {
      setError(String(e));
    }
  }

  async function saveSettings(newSettings: ProviderSettings) {
    try {
      await invoke("update_settings", { settings: newSettings });
      setSettings(newSettings);
      setShowSettings(false);
    } catch (e) {
      setError(String(e));
    }
  }

  const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  return (
    <div className="provider-app">
      {/* Header */}
      <header className="header">
        <h1 className="flex items-center gap-2"><Globe className="w-6 h-6" /> ProxySocialHub</h1>
        <div className="header-actions">
          <button
            className="btn btn-icon"
            onClick={() => setShowSettings(true)}
            title="Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
          <span className={`status-badge ${stats?.connected ? "online" : "offline"}`}>
            {stats?.connected ? "● Online" : "○ Offline"}
          </span>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="tab-nav">
        <button
          className={`tab-btn ${activeTab === "gateway" ? "active" : ""}`}
          onClick={() => setActiveTab("gateway")}
        >
          <Plug className="w-4 h-4 mr-2" /> Gateway
        </button>
        <button
          className={`tab-btn ${activeTab === "marketplace" ? "active" : ""}`}
          onClick={() => setActiveTab("marketplace")}
        >
          <ShoppingCart className="w-4 h-4 mr-2" /> Marketplace
        </button>
      </div>

      {/* Gateway Tab Content */}
      {activeTab === "gateway" && (
        <>
          {/* Warnings */}
          {stats && !stats.within_schedule && (
            <div className="warning-banner flex items-center gap-2">
              <Clock className="w-4 h-4" /> Outside scheduled hours - Connection disabled
            </div>
          )}
          {stats && !stats.within_bandwidth_limit && (
            <div className="warning-banner flex items-center gap-2">
              <BarChart className="w-4 h-4" /> Daily bandwidth limit reached
            </div>
          )}

          {/* Connection Card */}
          <div className="card connection-card">
            <div className="connection-status">
              <div className={`status-indicator ${stats?.connected ? "connected" : ""}`}>
                {stats?.connected ? <CheckCircle className="w-8 h-8 text-green-500" /> : <XCircle className="w-8 h-8 text-gray-400" />}
              </div>
              <div className="connection-info">
                <h2>{stats?.connected ? "Connected to Gateway" : "Disconnected"}</h2>
                <p className="gateway-url">Gateway: {settings?.gateway_url || "127.0.0.1:4000"}</p>
                {stats?.connected && stats.session_duration_secs > 0 && (
                  <p className="session-duration">Session: {formatDuration(stats.session_duration_secs)}</p>
                )}
              </div>
            </div>

            <div className="connection-actions">
              {stats?.connected ? (
                <button className="btn btn-danger" onClick={disconnect}>
                  Disconnect
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={connect}
                  disabled={connecting || !!(stats && (!stats.within_schedule || !stats.within_bandwidth_limit))}
                >
                  {connecting ? "Connecting..." : "Connect to Gateway"}
                </button>
              )}
            </div>

            {error && <p className="error-msg">{error}</p>}
          </div>

          {/* Stats Grid */}
          <div className="stats-grid">
            <div className="stat-card earnings">
              <div className="stat-icon">💰</div>
              <div className="stat-content">
                <span className="stat-value">GHS {(stats?.earnings_ghs ?? 0).toFixed(4)}</span>
                <span className="stat-label">Session Earnings</span>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon"><Upload className="w-6 h-6 text-blue-500" /></div>
              <div className="stat-content">
                <span className="stat-value">{formatBytes(stats?.total_bytes_up || 0)}</span>
                <span className="stat-label">Uploaded</span>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon"><Download className="w-6 h-6 text-green-500" /></div>
              <div className="stat-content">
                <span className="stat-value">{formatBytes(stats?.total_bytes_down || 0)}</span>
                <span className="stat-label">Downloaded</span>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon">📊</div>
              <div className="stat-content">
                <span className="stat-value">{(stats?.total_gb ?? 0).toFixed(4)} GB</span>
                <span className="stat-label">Total Data</span>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon"><Network className="w-6 h-6 text-indigo-500" /></div>
              <div className="stat-content">
                <span className="stat-value">{stats?.active_connections || 0}</span>
                <span className="stat-label">Active Connections</span>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon"><TrendingUp className="w-6 h-6 text-orange-500" /></div>
              <div className="stat-content">
                <span className="stat-value">{stats?.total_connections || 0}</span>
                <span className="stat-label">Total Connections</span>
              </div>
            </div>
          </div>

          {/* Earnings Info */}
          <div className="card earnings-card">
            <h3 className="flex items-center gap-2"><DollarSign className="w-5 h-5" /> Earnings Breakdown</h3>
            <div className="earnings-info">
              <div className="earnings-row">
                <span>Rate per GB:</span>
                <span className="value">GHS 0.20</span>
              </div>
              <div className="earnings-row">
                <span>Data Served:</span>
                <span className="value">{(stats?.total_gb ?? 0).toFixed(4)} GB</span>
              </div>
              <div className="earnings-row highlight">
                <span>Current Session:</span>
                <span className="value">GHS {(stats?.earnings_ghs ?? 0).toFixed(4)}</span>
              </div>
            </div>
            <p className="earnings-note flex items-center gap-2">
              <Lightbulb className="w-4 h-4 text-yellow-400" /> Earnings are calculated at GHS 0.20 per GB (40% provider share)
            </p>
          </div>
        </>
      )}

      {/* Marketplace Tab Content */}
      {activeTab === "marketplace" && (
        <div className="marketplace-content">
          {/* Marketplace Stats */}
          <div className="stats-grid">
            <div className="stat-card earnings">
              <div className="stat-icon">💰</div>
              <div className="stat-content">
                <span className="stat-value">GHS {(marketplaceStats?.total_earnings ?? 0).toFixed(2)}</span>
                <span className="stat-label">Total Earnings</span>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon">📊</div>
              <div className="stat-content">
                <span className="stat-value">{(marketplaceStats?.total_bandwidth_sold ?? 0).toFixed(2)} GB</span>
                <span className="stat-label">Bandwidth Sold</span>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon"><Package className="w-6 h-6 text-orange-500" /></div>
              <div className="stat-content">
                <span className="stat-value">{marketplaceStats?.active_listings ?? 0}</span>
                <span className="stat-label">Active Listings</span>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon"><ShoppingCart className="w-6 h-6 text-purple-500" /></div>
              <div className="stat-content">
                <span className="stat-value">{marketplaceStats?.total_orders ?? 0}</span>
                <span className="stat-label">Total Orders</span>
              </div>
            </div>
          </div>

          {/* Listings */}
          <div className="card">
            <h3 className="flex items-center gap-2"><Package className="w-5 h-5" /> My Listings</h3>
            {listings.length === 0 ? (
              <p className="empty-state">No listings yet. Create one on the web app!</p>
            ) : (
              <div className="listings-list">
                {listings.map(listing => (
                  <div key={listing.id} className="listing-item">
                    <div className="listing-info">
                      <span className="listing-title">{listing.title}</span>
                      <span className="listing-price">GHS {listing.price_per_gb}/GB</span>
                    </div>
                    <div className="listing-stats">
                      <span>{listing.available_bandwidth_gb} GB available</span>
                      <span>{listing.orders_count} orders</span>
                      <span className={`status ${listing.status}`}>{listing.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Sales */}
          <div className="card">
            <h3 className="flex items-center gap-2"><TrendingUp className="w-5 h-5" /> Recent Sales</h3>
            {sales.length === 0 ? (
              <p className="empty-state">No sales yet.</p>
            ) : (
              <div className="sales-list">
                {sales.map(sale => (
                  <div key={sale.id} className="sale-item">
                    <div className="sale-info">
                      <span>{sale.bandwidth_gb} GB sold to @{sale.buyer_username}</span>
                      <span className="sale-date">{new Date(sale.created_at).toLocaleDateString()}</span>
                    </div>
                    <span className="sale-amount">+GHS {sale.total_price.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="marketplace-note flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-yellow-400" /> Manage your listings on the web app at{' '}
            <a href="https://proxyhubb.com/dashboard/provider" target="_blank" rel="noopener noreferrer">
              proxyhubb.com
            </a>
          </p>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && settings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 className="flex items-center gap-2"><Settings className="w-6 h-6" /> Settings</h2>
            <div className="settings-form">
              {/* Gateway URL */}
              <div className="form-group">
                <label>Gateway URL</label>
                <input
                  type="text"
                  value={settings.gateway_url}
                  onChange={e => setSettings({ ...settings, gateway_url: e.target.value })}
                />
              </div>

              {/* Auto Reconnect */}
              <div className="form-group checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={settings.auto_reconnect}
                    onChange={e => setSettings({ ...settings, auto_reconnect: e.target.checked })}
                  />
                  Auto-reconnect on disconnect
                </label>
              </div>

              {/* Reconnect Settings */}
              {settings.auto_reconnect && (
                <div className="form-row">
                  <div className="form-group">
                    <label>Reconnect Delay (sec)</label>
                    <input
                      type="number"
                      min="1"
                      max="300"
                      value={settings.reconnect_delay_secs}
                      onChange={e => setSettings({ ...settings, reconnect_delay_secs: parseInt(e.target.value) })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Max Attempts</label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={settings.max_reconnect_attempts}
                      onChange={e => setSettings({ ...settings, max_reconnect_attempts: parseInt(e.target.value) })}
                    />
                  </div>
                </div>
              )}

              {/* Bandwidth Limit */}
              <div className="form-group">
                <label>Daily Bandwidth Limit (GB, 0 = unlimited)</label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={settings.daily_bandwidth_limit_gb}
                  onChange={e => setSettings({ ...settings, daily_bandwidth_limit_gb: parseFloat(e.target.value) })}
                />
              </div>

              {/* Schedule */}
              <div className="form-group checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={settings.schedule_enabled}
                    onChange={e => setSettings({ ...settings, schedule_enabled: e.target.checked })}
                  />
                  Enable Schedule
                </label>
              </div>

              {settings.schedule_enabled && (
                <>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Start Hour</label>
                      <select
                        value={settings.schedule_start_hour}
                        onChange={e => setSettings({ ...settings, schedule_start_hour: parseInt(e.target.value) })}
                      >
                        {Array.from({ length: 24 }, (_, i) => (
                          <option key={i} value={i}>{i.toString().padStart(2, '0')}:00</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>End Hour</label>
                      <select
                        value={settings.schedule_end_hour}
                        onChange={e => setSettings({ ...settings, schedule_end_hour: parseInt(e.target.value) })}
                      >
                        {Array.from({ length: 24 }, (_, i) => (
                          <option key={i} value={i}>{i.toString().padStart(2, '0')}:00</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Active Days</label>
                    <div className="days-selector">
                      {weekdays.map(day => (
                        <label key={day} className={`day-checkbox ${settings.schedule_days.includes(day) ? 'active' : ''}`}>
                          <input
                            type="checkbox"
                            checked={settings.schedule_days.includes(day)}
                            onChange={e => {
                              if (e.target.checked) {
                                setSettings({ ...settings, schedule_days: [...settings.schedule_days, day] });
                              } else {
                                setSettings({ ...settings, schedule_days: settings.schedule_days.filter(d => d !== day) });
                              }
                            }}
                          />
                          {day.slice(0, 3)}
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => setShowSettings(false)}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={() => saveSettings(settings)}>
                  Save Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="footer">
        <p>ProxyHub Provider Desktop v0.2.0</p>
      </footer>
    </div>
  );
}

export default App;
