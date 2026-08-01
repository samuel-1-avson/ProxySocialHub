'use client';

import { useState, useEffect } from 'react';
import {
  Brain,
  Sparkles,
  Tv,
  Database,
  Gamepad2,
  ShieldCheck,
  Globe,
  Server,
  CheckCircle,
  Zap,
} from 'lucide-react';
import { getUseCases, getRecommendations, UseCase, Recommendation } from '@/lib/api';
import { Modal } from '@/components/patterns/Modal';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/StatusBadge';

interface SmartConnectWizardProps {
  onClose: () => void;
  onConnect: (nodeId: string) => void;
}

export function SmartConnectWizard({ onClose, onConnect }: SmartConnectWizardProps) {
  const [step, setStep] = useState(1);
  const [useCases, setUseCases] = useState<UseCase[]>([]);
  const [selectedUseCase, setSelectedUseCase] = useState<UseCase | null>(null);
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState<Recommendation[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setUseCases(await getUseCases());
      } catch (e) {
        console.error('Failed to load use cases', e);
      }
    }
    void load();
  }, []);

  const handleScan = async () => {
    if (!selectedUseCase) return;
    setStep(2);
    setScanning(true);
    setError(null);

    setTimeout(async () => {
      try {
        const data = await getRecommendations(selectedUseCase.id);
        setResults(data.recommendations || []);
        setScanning(false);
        setStep(3);
      } catch (e) {
        console.error('Scanning failed', e);
        setError('Network analysis failed. Please try again.');
        setScanning(false);
        setStep(1);
      }
    }, 1500);
  };

  const getIcon = (id: string) => {
    switch (id) {
      case 'streaming':
        return Tv;
      case 'scraping':
        return Database;
      case 'gaming':
        return Gamepad2;
      case 'privacy':
        return ShieldCheck;
      default:
        return Globe;
    }
  };

  const stepLabel =
    step === 1 ? 'Select objective' : step === 2 ? 'Analyzing network' : 'Optimal nodes found';

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !scanning) onClose();
      }}
      title="Smart Connect"
      description={stepLabel}
      size="xl"
    >
      <div className="mb-4 flex items-center gap-3">
        <div className="rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--info)_15%,transparent)] p-2 text-[var(--info)]">
          <Brain size={20} aria-hidden />
        </div>
        <p className="text-sm text-muted-foreground">
          Match your use case to high-scoring nodes on the network.
        </p>
      </div>

      {error ? (
        <p className="mb-4 text-sm text-[var(--destructive)]" role="alert">
          {error}
        </p>
      ) : null}

      {step === 1 ? (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {useCases.map((uc) => {
              const Icon = getIcon(uc.id);
              const isSelected = selectedUseCase?.id === uc.id;
              return (
                <button
                  key={uc.id}
                  type="button"
                  onClick={() => setSelectedUseCase(uc)}
                  className={`rounded-[var(--radius-lg)] border p-4 text-left transition-colors ${
                    isSelected
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-secondary hover:border-[var(--border-strong)]'
                  }`}
                  aria-pressed={isSelected}
                >
                  <div className="mb-3 flex items-start justify-between">
                    <div
                      className={`rounded-[var(--radius-md)] p-2 ${
                        isSelected ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'
                      }`}
                    >
                      <Icon size={20} aria-hidden />
                    </div>
                    {isSelected ? <CheckCircle size={18} className="text-primary" aria-hidden /> : null}
                  </div>
                  <h3 className="mb-1 text-sm font-semibold text-foreground">{uc.name}</h3>
                  <p className="text-xs leading-relaxed text-muted-foreground">{uc.description}</p>
                </button>
              );
            })}
          </div>
          <Button
            type="button"
            onClick={() => void handleScan()}
            disabled={!selectedUseCase}
            className="w-full"
          >
            <Sparkles size={16} className="mr-2" aria-hidden />
            Find best proxies
          </Button>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="flex flex-col items-center gap-6 py-10" aria-live="polite">
          <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-primary/30 border-t-primary animate-spin motion-reduce:animate-none">
            <Brain size={32} className="text-primary" aria-hidden />
          </div>
          <div className="text-center">
            <h3 className="text-lg font-semibold">Scanning network…</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Analyzing latency, uptime, and trust for{' '}
              <strong>{selectedUseCase?.name}</strong>
            </p>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Top recommendations</h3>
            <StatusBadge status="verified" label="Matched" />
          </div>
          <div className="space-y-3">
            {results.map((rec, i) => (
              <div
                key={rec.listing.id || i}
                className="flex items-center gap-4 rounded-[var(--radius-md)] border border-border bg-secondary p-3"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-border bg-card font-mono text-sm font-semibold">
                  {Math.round(rec.score)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="truncate font-mono text-sm font-medium">
                      Node {rec.listing.id?.substring(0, 8)}…
                    </span>
                    <StatusBadge status="online" size="sm" />
                    {i === 0 ? <StatusBadge status="verified" label="Best match" size="sm" /> : null}
                  </div>
                  <div className="flex gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1 font-mono">
                      <Zap size={10} aria-hidden />
                      {rec.listing.avg_latency_ms || 45}ms
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Server size={10} aria-hidden />
                      {rec.listing.country || 'GH'}
                    </span>
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => onConnect(rec.listing.id || '')}
                >
                  Connect
                </Button>
              </div>
            ))}
          </div>
          <Button type="button" variant="outline" onClick={() => setStep(1)}>
            Back
          </Button>
        </div>
      ) : null}
    </Modal>
  );
}
