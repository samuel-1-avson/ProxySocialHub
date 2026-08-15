/**
 * Client-side upload bandwidth measurement against control-api probe.
 * Uses incompressible payloads so proxies/CDNs cannot inflate results via compression.
 */

import { fetchWithAuth } from '@/lib/auth';

export type BandwidthTestProgress = {
  phase: 'warming' | 'measuring' | 'done' | 'error';
  attempt: number;
  totalAttempts: number;
  lastMbps?: number;
  message?: string;
};

export type BandwidthTestResult = {
  mbps: number;
  label: string;
  samplesMbps: number[];
  bytesProbed: number;
  durationMs: number;
};

const WARMUP_BYTES = 256 * 1024;
const SAMPLE_BYTES = [512 * 1024, 1024 * 1024, 1536 * 1024] as const;
const PROBE_PATH = '/v1/provider/bandwidth-probe';

function formatMbpsLabel(mbps: number): string {
  if (!Number.isFinite(mbps) || mbps <= 0) return '0 Mbps (measured)';
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(2)} Gbps (measured)`;
  if (mbps >= 100) return `${Math.round(mbps)} Mbps (measured)`;
  if (mbps >= 10) return `${mbps.toFixed(1)} Mbps (measured)`;
  return `${mbps.toFixed(2)} Mbps (measured)`;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function buildIncompressiblePayload(byteLength: number): Blob {
  const bytes = new Uint8Array(byteLength);
  // Fill in chunks — getRandomValues has a practical per-call size limit in some browsers.
  const chunk = 65536;
  for (let offset = 0; offset < byteLength; offset += chunk) {
    const end = Math.min(offset + chunk, byteLength);
    crypto.getRandomValues(bytes.subarray(offset, end));
  }
  return new Blob([bytes], { type: 'application/octet-stream' });
}

async function probeOnce(byteLength: number): Promise<{ mbps: number; elapsedMs: number }> {
  const body = buildIncompressiblePayload(byteLength);
  const started = performance.now();
  const response = await fetchWithAuth(PROBE_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      Accept: 'application/json',
    },
    body,
  });
  const elapsedMs = Math.max(performance.now() - started, 1);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Bandwidth probe failed (${response.status})`);
  }
  // bits / seconds / 1e6 = Mbps
  const mbps = (byteLength * 8) / (elapsedMs / 1000) / 1_000_000;
  return { mbps, elapsedMs };
}

/**
 * Measure upstream throughput via authenticated control-api probe.
 * Warm-up sample is discarded; result is the median of remaining samples.
 */
export async function measureUploadBandwidth(
  onProgress?: (progress: BandwidthTestProgress) => void,
): Promise<BandwidthTestResult> {
  const totalAttempts = 1 + SAMPLE_BYTES.length;
  const samplesMbps: number[] = [];
  let bytesProbed = 0;
  let durationMs = 0;

  onProgress?.({
    phase: 'warming',
    attempt: 1,
    totalAttempts,
    message: 'Warming up connection…',
  });

  try {
    const warm = await probeOnce(WARMUP_BYTES);
    bytesProbed += WARMUP_BYTES;
    durationMs += warm.elapsedMs;

    for (let i = 0; i < SAMPLE_BYTES.length; i += 1) {
      const size = SAMPLE_BYTES[i];
      onProgress?.({
        phase: 'measuring',
        attempt: i + 2,
        totalAttempts,
        lastMbps: samplesMbps[samplesMbps.length - 1],
        message: `Measuring upload (${i + 1}/${SAMPLE_BYTES.length})…`,
      });
      const sample = await probeOnce(size);
      samplesMbps.push(sample.mbps);
      bytesProbed += size;
      durationMs += sample.elapsedMs;
      onProgress?.({
        phase: 'measuring',
        attempt: i + 2,
        totalAttempts,
        lastMbps: sample.mbps,
        message: `Sample ${i + 1}: ${formatMbpsLabel(sample.mbps)}`,
      });
    }

    const mbps = median(samplesMbps);
    const result: BandwidthTestResult = {
      mbps,
      label: formatMbpsLabel(mbps),
      samplesMbps,
      bytesProbed,
      durationMs,
    };

    onProgress?.({
      phase: 'done',
      attempt: totalAttempts,
      totalAttempts,
      lastMbps: mbps,
      message: result.label,
    });

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Bandwidth test failed';
    onProgress?.({
      phase: 'error',
      attempt: 0,
      totalAttempts,
      message,
    });
    throw err;
  }
}
