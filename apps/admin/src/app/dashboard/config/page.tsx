"use client";

import { useState, useEffect } from "react";
import { Settings, ToggleLeft, ToggleRight, Save } from "lucide-react";
import { getSystemConfig, updateSystemConfig, getFeatureFlags, updateFeatureFlag, type SystemConfig } from "@/lib/api";

function ConfigRow({ item, onSave }: { item: SystemConfig; onSave: (key: string, val: string) => Promise<void> }) {
  const [value, setValue] = useState(item.value);
  const [saving, setSaving] = useState(false);
  const changed = value !== item.value;

  const save = async () => {
    setSaving(true);
    try { await onSave(item.key, value); }
    catch (e) { alert(String(e)); setValue(item.value); }
    finally { setSaving(false); }
  };

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-[#1e1e2e] last:border-0">
      <span className="font-mono text-xs text-indigo-300 w-52 shrink-0">{item.key}</span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="flex-1 bg-[#0a0a0f] border border-[#1e1e2e] rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
      />
      <button
        onClick={save}
        disabled={!changed || saving}
        className="p-1.5 rounded hover:bg-indigo-500/10 text-[#4a4a6a] hover:text-indigo-400 disabled:opacity-30 transition-colors"
        title="Save"
      >
        <Save className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function FlagRow({ item, onToggle }: { item: SystemConfig; onToggle: (key: string, enabled: boolean) => Promise<void> }) {
  const enabled = item.value === "true";
  const [toggling, setToggling] = useState(false);

  const handle = async () => {
    setToggling(true);
    try { await onToggle(item.key.replace("feature.", ""), !enabled); }
    catch (e) { alert(String(e)); }
    finally { setToggling(false); }
  };

  return (
    <div className="flex items-center justify-between py-2.5 border-b border-[#1e1e2e] last:border-0">
      <span className="font-mono text-xs text-[#94a3b8]">{item.key.replace("feature.", "")}</span>
      <button onClick={handle} disabled={toggling} className="disabled:opacity-40">
        {enabled
          ? <ToggleRight className="w-6 h-6 text-emerald-400" />
          : <ToggleLeft className="w-6 h-6 text-[#4a4a6a]" />
        }
      </button>
    </div>
  );
}

export default function ConfigPage() {
  const [configs, setConfigs] = useState<SystemConfig[]>([]);
  const [flags, setFlags] = useState<SystemConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [c, f] = await Promise.all([getSystemConfig(), getFeatureFlags()]);
      setConfigs(c.config.filter((i) => !i.key.startsWith("feature.")));
      setFlags(f.flags);
    } catch { /* handled */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleSave = async (key: string, value: string) => {
    await updateSystemConfig(key, value);
    await load();
  };

  const handleToggle = async (key: string, enabled: boolean) => {
    await updateFeatureFlag(key, enabled);
    await load();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* System Config */}
      <div className="admin-card space-y-1">
        <div className="flex items-center gap-2 mb-4">
          <Settings className="w-4 h-4 text-indigo-400" />
          <h2 className="text-sm font-semibold text-white">System Configuration</h2>
        </div>
        {configs.length === 0 ? (
          <p className="text-sm text-[#4a4a6a] py-4 text-center">No config entries</p>
        ) : (
          configs.map((c) => <ConfigRow key={c.id} item={c} onSave={handleSave} />)
        )}
      </div>

      {/* Feature Flags */}
      <div className="admin-card space-y-1">
        <div className="flex items-center gap-2 mb-4">
          <ToggleRight className="w-4 h-4 text-emerald-400" />
          <h2 className="text-sm font-semibold text-white">Feature Flags</h2>
        </div>
        {flags.length === 0 ? (
          <p className="text-sm text-[#4a4a6a] py-4 text-center">No feature flags (keys prefixed with <code>feature.</code>)</p>
        ) : (
          flags.map((f) => <FlagRow key={f.id} item={f} onToggle={handleToggle} />)
        )}
      </div>
    </div>
  );
}
