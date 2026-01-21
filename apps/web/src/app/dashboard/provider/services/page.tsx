'use client';

import { useState, useEffect, useCallback } from 'react';
import styles from './ProviderServices.module.css';

interface ServiceConfig {
    id: string;
    node_id: string;
    enable_http: boolean;
    enable_https: boolean;
    enable_socks5: boolean;
    enable_ssh_tunnel: boolean;
    max_bandwidth_mbps: number;
    priority_tier: 'standard' | 'priority' | 'enterprise';
    allowed_countries: string[];
    blocked_countries: string[];
    max_concurrent_connections: number;
    max_daily_bandwidth_gb: number;
    captcha_solving_enabled: boolean;
    javascript_render_enabled: boolean;
    browser_fingerprint_enabled: boolean;
    screenshot_enabled: boolean;
    price_multiplier_http: number;
    price_multiplier_socks5: number;
    is_active: boolean;
    node?: {
        ip_address: string;
        country_code: string;
        quality_score: number;
    };
}

interface Template {
    name: string;
    description: string;
    config: Partial<ServiceConfig>;
}

const TIERS = [
    { value: 'standard', label: 'Standard', color: '#6b7280' },
    { value: 'priority', label: 'Priority', color: '#f59e0b' },
    { value: 'enterprise', label: 'Enterprise', color: '#8b5cf6' },
];

export default function ProviderServicesPage() {
    const [configs, setConfigs] = useState<ServiceConfig[]>([]);
    const [templates, setTemplates] = useState<Template[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedConfig, setSelectedConfig] = useState<ServiceConfig | null>(null);
    const [saving, setSaving] = useState(false);

    const fetchConfigs = useCallback(async () => {
        try {
            const response = await fetch('/api/v1/provider/services', {
                credentials: 'include',
            });
            if (response.ok) {
                const data = await response.json();
                setConfigs(data);
            }
        } catch (err) {
            console.error('Failed to fetch configs:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    const fetchTemplates = useCallback(async () => {
        try {
            const response = await fetch('/api/v1/provider/services/templates', {
                credentials: 'include',
            });
            if (response.ok) {
                const data = await response.json();
                setTemplates(data.templates || []);
            }
        } catch (err) {
            console.error('Failed to fetch templates:', err);
        }
    }, []);

    useEffect(() => {
        fetchConfigs();
        fetchTemplates();
    }, [fetchConfigs, fetchTemplates]);

    const updateConfig = async (nodeId: string, updates: Partial<ServiceConfig>) => {
        setSaving(true);
        try {
            const response = await fetch(`/api/v1/provider/services/${nodeId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(updates),
            });
            if (response.ok) {
                fetchConfigs();
            }
        } catch (err) {
            console.error('Failed to update config:', err);
        } finally {
            setSaving(false);
        }
    };

    const applyTemplate = async (nodeId: string, template: Template) => {
        await updateConfig(nodeId, template.config);
    };

    if (loading) {
        return <div className={styles.loading}>Loading service configurations...</div>;
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1>Service Configuration</h1>
                <p>Configure the services your nodes offer to buyers</p>
            </div>

            {/* Quick Templates */}
            <div className={styles.section}>
                <h2>Quick Templates</h2>
                <div className={styles.templates}>
                    {templates.map((template) => (
                        <div key={template.name} className={styles.templateCard}>
                            <h3>{template.name}</h3>
                            <p>{template.description}</p>
                            <button
                                className={styles.applyButton}
                                onClick={() => selectedConfig && applyTemplate(selectedConfig.node_id, template)}
                                disabled={!selectedConfig}
                            >
                                Apply to Selected
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            {/* Node Configurations */}
            <div className={styles.section}>
                <h2>Your Nodes ({configs.length})</h2>

                {configs.length === 0 ? (
                    <div className={styles.emptyState}>
                        <p>No service configurations yet. Add a node to get started.</p>
                    </div>
                ) : (
                    <div className={styles.configList}>
                        {configs.map((config) => (
                            <div
                                key={config.id}
                                className={`${styles.configCard} ${selectedConfig?.id === config.id ? styles.selected : ''}`}
                                onClick={() => setSelectedConfig(config)}
                            >
                                <div className={styles.configHeader}>
                                    <div className={styles.nodeInfo}>
                                        <span className={styles.nodeIP}>{config.node?.ip_address || 'Node'}</span>
                                        <span className={styles.countryBadge}>{config.node?.country_code || 'N/A'}</span>
                                    </div>
                                    <div className={styles.statusBadge} data-active={config.is_active}>
                                        {config.is_active ? 'Active' : 'Inactive'}
                                    </div>
                                </div>

                                {/* Protocols */}
                                <div className={styles.protocols}>
                                    <span className={`${styles.protocol} ${config.enable_http ? styles.enabled : ''}`}>HTTP</span>
                                    <span className={`${styles.protocol} ${config.enable_https ? styles.enabled : ''}`}>HTTPS</span>
                                    <span className={`${styles.protocol} ${config.enable_socks5 ? styles.enabled : ''}`}>SOCKS5</span>
                                    <span className={`${styles.protocol} ${config.enable_ssh_tunnel ? styles.enabled : ''}`}>SSH</span>
                                </div>

                                {/* Tier */}
                                <div className={styles.tierRow}>
                                    <span>Tier:</span>
                                    <span
                                        className={styles.tierBadge}
                                        style={{ backgroundColor: TIERS.find(t => t.value === config.priority_tier)?.color }}
                                    >
                                        {config.priority_tier}
                                    </span>
                                    <span className={styles.bandwidth}>{config.max_bandwidth_mbps} Mbps</span>
                                </div>

                                {/* Premium Services */}
                                <div className={styles.premiumRow}>
                                    {config.captcha_solving_enabled && <span className={styles.premiumBadge}>🔓 Captcha</span>}
                                    {config.javascript_render_enabled && <span className={styles.premiumBadge}>📄 JS Render</span>}
                                    {config.browser_fingerprint_enabled && <span className={styles.premiumBadge}>🖥️ Fingerprint</span>}
                                    {config.screenshot_enabled && <span className={styles.premiumBadge}>📷 Screenshot</span>}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Edit Panel */}
            {selectedConfig && (
                <div className={styles.editPanel}>
                    <h2>Edit Configuration</h2>

                    {/* Protocols */}
                    <div className={styles.editSection}>
                        <h3>Protocols</h3>
                        <div className={styles.toggleGroup}>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={selectedConfig.enable_http}
                                    onChange={(e) => updateConfig(selectedConfig.node_id, { enable_http: e.target.checked })}
                                />
                                HTTP
                            </label>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={selectedConfig.enable_https}
                                    onChange={(e) => updateConfig(selectedConfig.node_id, { enable_https: e.target.checked })}
                                />
                                HTTPS
                            </label>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={selectedConfig.enable_socks5}
                                    onChange={(e) => updateConfig(selectedConfig.node_id, { enable_socks5: e.target.checked })}
                                />
                                SOCKS5
                            </label>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={selectedConfig.enable_ssh_tunnel}
                                    onChange={(e) => updateConfig(selectedConfig.node_id, { enable_ssh_tunnel: e.target.checked })}
                                />
                                SSH Tunnel
                            </label>
                        </div>
                    </div>

                    {/* Tier & Speed */}
                    <div className={styles.editSection}>
                        <h3>Tier & Speed</h3>
                        <div className={styles.inputGroup}>
                            <label>Priority Tier</label>
                            <select
                                value={selectedConfig.priority_tier}
                                onChange={(e) => updateConfig(selectedConfig.node_id, { priority_tier: e.target.value as any })}
                            >
                                {TIERS.map((tier) => (
                                    <option key={tier.value} value={tier.value}>{tier.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className={styles.inputGroup}>
                            <label>Max Bandwidth (Mbps)</label>
                            <input
                                type="number"
                                value={selectedConfig.max_bandwidth_mbps}
                                onChange={(e) => updateConfig(selectedConfig.node_id, { max_bandwidth_mbps: parseInt(e.target.value) })}
                            />
                        </div>
                    </div>

                    {/* Premium Services */}
                    <div className={styles.editSection}>
                        <h3>Premium Services</h3>
                        <div className={styles.toggleGroup}>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={selectedConfig.captcha_solving_enabled}
                                    onChange={(e) => updateConfig(selectedConfig.node_id, { captcha_solving_enabled: e.target.checked })}
                                />
                                Captcha Solving
                            </label>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={selectedConfig.javascript_render_enabled}
                                    onChange={(e) => updateConfig(selectedConfig.node_id, { javascript_render_enabled: e.target.checked })}
                                />
                                JavaScript Rendering
                            </label>
                            <label>
                                <input
                                    type="checkbox"
                                    checked={selectedConfig.screenshot_enabled}
                                    onChange={(e) => updateConfig(selectedConfig.node_id, { screenshot_enabled: e.target.checked })}
                                />
                                Screenshot API
                            </label>
                        </div>
                    </div>

                    {/* Status */}
                    <div className={styles.editSection}>
                        <button
                            className={`${styles.statusButton} ${selectedConfig.is_active ? styles.deactivate : styles.activate}`}
                            onClick={() => updateConfig(selectedConfig.node_id, { is_active: !selectedConfig.is_active })}
                            disabled={saving}
                        >
                            {selectedConfig.is_active ? 'Deactivate Node' : 'Activate Node'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
