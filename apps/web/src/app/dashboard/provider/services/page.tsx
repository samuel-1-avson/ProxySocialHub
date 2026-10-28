"use client";

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    Globe,
    Server,
    Activity,
    Info,
    Settings,
    Zap,
    Save,
    Cpu,
    Eye,
    Layout,
    MousePointer2,
    Plus,
    X,
} from 'lucide-react';
import { ApiError } from '@/lib/api/client';
import {
    getProviderServiceConfigs,
    getProviderServiceTemplates,
    updateProviderServiceConfig,
    createProviderServiceConfig,
    getMyNodes,
    type ProviderServiceConfig,
    type ProviderServiceTemplate,
    type NodeRegistration,
} from '@/lib/api/provider';
import {
    PageHeading,
    Loading,
    DataError,
    EmptyState,
    Status,
} from '@/components/workspace/Patterns';

const TIERS = [
    { value: 'standard', label: 'Standard', color: '#6b7280' },
    { value: 'priority', label: 'Priority', color: '#f59e0b' },
    { value: 'enterprise', label: 'Enterprise', color: '#8b5cf6' },
];

function getErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof ApiError || err instanceof Error) return err.message || fallback;
    return fallback;
}

export default function ProviderServicesPage() {
    const queryClient = useQueryClient();
    const [selectedConfig, setSelectedConfig] = useState<ProviderServiceConfig | null>(null);
    const [saving, setSaving] = useState(false);
    const [creatingNodeId, setCreatingNodeId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [bandwidthDraft, setBandwidthDraft] = useState<string>('');

    const { data: configs = [], isLoading: configsLoading, isError: configsError, error: configsQueryError, refetch: refetchConfigs } = useQuery({
        queryKey: ['provider-service-configs'],
        queryFn: getProviderServiceConfigs,
        retry: 2,
    });

    const { data: nodesData, isLoading: nodesLoading, isError: nodesError, error: nodesQueryError, refetch: refetchNodes } = useQuery({
        queryKey: ['provider-nodes-for-services'],
        queryFn: getMyNodes,
        retry: 2,
    });
    const nodes: NodeRegistration[] = nodesData?.nodes || [];

    const { data: templatesData } = useQuery({
        queryKey: ['provider-service-templates'],
        queryFn: getProviderServiceTemplates,
        retry: 2,
    });

    const templates = templatesData?.templates || [];

    const configuredNodeIds = new Set(configs.map((c) => c.node_id));
    const nodesWithoutConfig = nodes.filter((n) => !configuredNodeIds.has(n.id));

    // Keep the bandwidth draft in sync whenever a different config is selected
    // (or the server-confirmed value changes), without clobbering in-progress edits.
    useEffect(() => {
        setBandwidthDraft(selectedConfig ? String(selectedConfig.max_bandwidth_mbps) : '');
        // Deliberately narrow deps: only reset the draft when the node selection changes or the
        // server-confirmed bandwidth changes, so editing other fields doesn't clobber in-progress typing.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedConfig?.id, selectedConfig?.max_bandwidth_mbps]);

    const loading = configsLoading || nodesLoading;

    const updateConfig = async (nodeId: string, updates: Partial<ProviderServiceConfig>) => {
        setSaving(true);
        setError(null);
        try {
            const updated = await updateProviderServiceConfig(nodeId, updates);
            queryClient.invalidateQueries({ queryKey: ['provider-service-configs'] });
            if (selectedConfig && selectedConfig.node_id === nodeId) {
                setSelectedConfig(updated);
            }
        } catch (err) {
            console.error('Failed to update config:', err);
            setError(getErrorMessage(err, 'Failed to update service config. Please try again.'));
        } finally {
            setSaving(false);
        }
    };

    const commitBandwidthDraft = () => {
        if (!selectedConfig) return;
        const parsed = parseInt(bandwidthDraft, 10);
        if (Number.isNaN(parsed) || parsed <= 0) {
            setBandwidthDraft(String(selectedConfig.max_bandwidth_mbps));
            return;
        }
        if (parsed === selectedConfig.max_bandwidth_mbps) return;
        updateConfig(selectedConfig.node_id, { max_bandwidth_mbps: parsed });
    };

    const applyTemplate = async (nodeId: string, template: ProviderServiceTemplate) => {
        await updateConfig(nodeId, template.config);
    };

    const createConfig = async (nodeId: string) => {
        setCreatingNodeId(nodeId);
        setError(null);
        try {
            const created = await createProviderServiceConfig({ node_id: nodeId });
            await queryClient.invalidateQueries({ queryKey: ['provider-service-configs'] });
            setSelectedConfig(created);
        } catch (err) {
            console.error('Failed to create config:', err);
            setError(getErrorMessage(err, 'Failed to create service config. Please try again.'));
        } finally {
            setCreatingNodeId(null);
        }
    };

    if (loading) {
        return (
            <div className="ui-page">
                <PageHeading
                    eyebrow="Provider services"
                    title="Node logistics"
                    description="Configure protocols, bandwidth, and service tiers for each registered node."
                />
                <Loading label="Loading your node service configurations…" />
            </div>
        );
    }

    return (
        <div className="ui-page">
            <PageHeading
                eyebrow="Provider services"
                title="Node logistics"
                description="Configure protocols, bandwidth, and service tiers for each registered node."
            />

            {configsError && (
                <DataError error={configsQueryError} retry={() => void refetchConfigs()} />
            )}
            {nodesError && (
                <DataError error={nodesQueryError} retry={() => void refetchNodes()} />
            )}

            {error && (
                <div className="ui-error" role="alert">
                    <strong>This change could not be saved</strong>
                    <p>{error}</p>
                    <button
                        onClick={() => setError(null)}
                        className="ui-button small secondary"
                        aria-label="Dismiss error"
                    >
                        <X size={14} aria-hidden="true" />
                        Dismiss
                    </button>
                </div>
            )}

            <div className="ui-columns">
                <div>
                    <section>
                        <div className="ui-section-heading">
                            <h2>Connected nodes ({configs.length})</h2>
                        </div>

                        {configs.length === 0 && nodesWithoutConfig.length === 0 ? (
                            <EmptyState
                                title="No nodes detected"
                                description="Connect a node via CLI or the setup wizard to start provisioning service configuration."
                                href="/dashboard/provider/setup"
                                action="Go to Setup"
                            />
                        ) : (
                            <div>
                                {configs.map((config) => (
                                    <button
                                        key={config.id}
                                        type="button"
                                        onClick={() => setSelectedConfig(config)}
                                        className={`ui-row w-full text-left ${
                                            selectedConfig?.id === config.id
                                                ? 'bg-secondary'
                                                : ''
                                        }`}
                                    >
                                        <div className="ui-row-identity">
                                            <span className="ui-region">
                                                <Activity size={16} aria-hidden="true" />
                                            </span>
                                            <div>
                                                <h3>{config.node?.ip_address || 'Unidentified node'}</h3>
                                                <p>
                                                    {config.node?.country_code || 'Location not specified'}
                                                    {' · '}
                                                    {config.max_bandwidth_mbps} Mbps
                                                </p>
                                            </div>
                                        </div>
                                        <Status tone={config.is_active ? 'good' : 'neutral'}>
                                            {config.is_active ? 'Streaming' : 'Deactivated'}
                                        </Status>
                                    </button>
                                ))}

                                {nodesWithoutConfig.length > 0 && (
                                    <div className="ui-section-space">
                                        <p className="ui-note">
                                            {configs.length === 0 ? 'Create a service config to get started' : 'Nodes awaiting a service config'}
                                        </p>
                                        {nodesWithoutConfig.map((node) => (
                                            <div
                                                key={node.id}
                                                className="ui-row"
                                            >
                                                <div className="ui-row-identity">
                                                    <span className="ui-region">
                                                        <Server size={16} aria-hidden="true" />
                                                    </span>
                                                    <div>
                                                        <h3>
                                                            {node.name || node.ip_address || 'Unnamed node'}
                                                        </h3>
                                                        <p>
                                                            {node.country || 'Location not specified'} · No service config
                                                        </p>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => createConfig(node.id)}
                                                    disabled={creatingNodeId === node.id}
                                                    className="ui-button small"
                                                >
                                                    {creatingNodeId === node.id ? (
                                                        'Creating…'
                                                    ) : (
                                                        <>
                                                            <Plus size={14} aria-hidden="true" />
                                                            Create config
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </section>

                    <section className="ui-section-space">
                        <div className="ui-section-heading">
                            <h2>Logic presets</h2>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            {templates.map((template) => (
                                <button
                                    key={template.name}
                                    type="button"
                                    onClick={() => selectedConfig && applyTemplate(selectedConfig.node_id, template)}
                                    disabled={!selectedConfig}
                                    className="ui-surface text-left disabled:cursor-not-allowed"
                                >
                                    <span className="ui-tag">
                                        <Layout size={12} aria-hidden="true" />
                                        Preset
                                    </span>
                                    <h3 className="mt-3 text-[15px] font-semibold">{template.name}</h3>
                                    <p className="ui-note mt-1">{template.description}</p>
                                    {selectedConfig ? (
                                        <p className="ui-link mt-3">Apply to selected node</p>
                                    ) : (
                                        <p className="ui-note mt-3">Select a node first</p>
                                    )}
                                </button>
                            ))}
                        </div>
                    </section>
                </div>

                <div>
                    {selectedConfig ? (
                        <section className="ui-surface relative">
                            <div className="ui-section-heading">
                                <div className="ui-row-identity">
                                    <span className="ui-region">
                                        <Settings size={16} aria-hidden="true" />
                                    </span>
                                    <div>
                                        <h2>Parameterization</h2>
                                        <p className="ui-note">Modulating {selectedConfig.node?.ip_address}</p>
                                    </div>
                                </div>
                                <label className="ui-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={selectedConfig.is_active}
                                        onChange={() => updateConfig(selectedConfig.node_id, { is_active: !selectedConfig.is_active })}
                                        disabled={saving}
                                    />
                                    {selectedConfig.is_active ? 'Node active' : 'Node deactivated'}
                                </label>
                            </div>

                            {saving && (
                                <Loading label="Saving your service configuration…" />
                            )}

                            <div className="ui-page">
                                <div>
                                    <label className="ui-field">
                                        <span className="ui-inline-icon">
                                            <Globe size={14} aria-hidden="true" /> Communication protocols
                                        </span>
                                    </label>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                                        {[
                                            { key: 'enable_http' as const, label: 'HTTP' },
                                            { key: 'enable_https' as const, label: 'HTTPS' },
                                            { key: 'enable_socks5' as const, label: 'SOCKS5' },
                                            { key: 'enable_ssh_tunnel' as const, label: 'SSH' },
                                        ].map(proto => (
                                            <button
                                                key={proto.key}
                                                type="button"
                                                onClick={() => updateConfig(selectedConfig.node_id, { [proto.key]: !selectedConfig[proto.key] })}
                                                className={`ui-button ${selectedConfig[proto.key] ? '' : 'secondary'}`}
                                                disabled={saving}
                                            >
                                                {proto.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="ui-form-grid">
                                    <div>
                                        <label className="ui-field">
                                            <span className="ui-inline-icon">
                                                <Layout size={14} aria-hidden="true" /> Service tier
                                            </span>
                                        </label>
                                        <div className="ui-tabs mt-3" role="tablist" aria-label="Service tier">
                                            {TIERS.map(t => (
                                                <button
                                                    key={t.value}
                                                    type="button"
                                                    role="tab"
                                                    aria-selected={selectedConfig.priority_tier === t.value}
                                                    onClick={() => updateConfig(selectedConfig.node_id, { priority_tier: t.value as ProviderServiceConfig['priority_tier'] })}
                                                    className={selectedConfig.priority_tier === t.value ? 'active' : ''}
                                                    disabled={saving}
                                                >
                                                    {t.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <label className="ui-field">
                                        <span className="ui-inline-icon">
                                            <Activity size={14} aria-hidden="true" /> Max bandwidth (Mbps)
                                        </span>
                                        <div className="ui-actions">
                                            <input
                                                type="number"
                                                value={bandwidthDraft}
                                                onChange={(e) => setBandwidthDraft(e.target.value)}
                                                onBlur={commitBandwidthDraft}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') e.currentTarget.blur();
                                                }}
                                                className="ui-input flex-1"
                                                disabled={saving}
                                            />
                                            {parseInt(bandwidthDraft, 10) !== selectedConfig.max_bandwidth_mbps && !Number.isNaN(parseInt(bandwidthDraft, 10)) && (
                                                <button
                                                    onClick={commitBandwidthDraft}
                                                    title="Save bandwidth"
                                                    className="ui-button"
                                                    type="button"
                                                    disabled={saving}
                                                >
                                                    <Save size={16} aria-hidden="true" />
                                                    Save
                                                </button>
                                            )}
                                        </div>
                                    </label>
                                </div>

                                <div>
                                    <label className="ui-field">
                                        <span className="ui-inline-icon">
                                            <Zap size={14} aria-hidden="true" /> Advanced service options
                                        </span>
                                    </label>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                                        {[
                                            { key: 'captcha_solving_enabled' as const, label: 'Captcha decryption', icon: MousePointer2 },
                                            { key: 'javascript_render_enabled' as const, label: 'Logic rendering', icon: Cpu },
                                            { key: 'screenshot_enabled' as const, label: 'Visual capture', icon: Eye },
                                        ].map(feature => (
                                            <button
                                                key={feature.key}
                                                type="button"
                                                onClick={() => updateConfig(selectedConfig.node_id, { [feature.key]: !selectedConfig[feature.key] })}
                                                className={`ui-surface text-left ${selectedConfig[feature.key] ? 'border border-primary' : 'border border-border'}`}
                                                disabled={saving}
                                            >
                                                <span className="ui-inline-icon">
                                                    <feature.icon size={16} aria-hidden="true" />
                                                    {feature.label}
                                                </span>
                                                <p className="ui-note mt-2">
                                                    {selectedConfig[feature.key] ? 'Active' : 'Offline'}
                                                </p>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="ui-attention">
                                    <Info size={16} aria-hidden="true" />
                                    <p>
                                        Any changes to protocol parameters are propagated to the Edge-Gateway in real-time. Unauthorized traffic spikes will trigger automatic throttle mechanisms.
                                    </p>
                                </div>
                            </div>
                        </section>
                    ) : (
                        <EmptyState
                            title="Select a node to configure"
                            description={
                                configs.length === 0
                                    ? 'Create a service config for one of your nodes to begin logistical parameterization.'
                                    : 'Select a node from the list to begin logistical parameterization and protocol modulation.'
                            }
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
