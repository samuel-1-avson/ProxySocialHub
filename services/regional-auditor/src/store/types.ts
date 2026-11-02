import type { AuditJob, JobStatus } from "../contracts.ts";

/**
 * Persistence for audit jobs. Ownership is enforced here: every read that
 * serves a user goes through getOwned/list, which never return another
 * owner's job. get() is for the worker's own bookkeeping only.
 */
export interface JobStore {
  create(job: AuditJob): Promise<void>;
  /** Replace the stored document. Fails if the stored revision is newer (lost update). */
  save(job: AuditJob): Promise<void>;
  get(id: string): Promise<AuditJob | null>;
  getOwned(id: string, ownerId: string): Promise<AuditJob | null>;
  list(ownerId: string, limit: number): Promise<AuditJob[]>;
  listByStatus(statuses: readonly JobStatus[]): Promise<AuditJob[]>;
  countActive(ownerId: string): Promise<number>;
  /** Delete FINISHED audits created before `cutoffIso`; unfinished audits are never deleted. Returns the deleted ids. */
  deleteFinishedBefore(cutoffIso: string): Promise<string[]>;
  close?(): Promise<void>;
}

export class StaleRevisionError extends Error {
  constructor(id: string) {
    super(`audit ${id} was modified concurrently`);
    this.name = "StaleRevisionError";
  }
}

/** Binary evidence (screenshots). Private: only reachable through ownership-checked routes. */
export interface ArtifactStore {
  put(auditId: string, artifactId: string, bytes: Buffer): Promise<void>;
  get(auditId: string, artifactId: string): Promise<Buffer | null>;
  copy(fromAuditId: string, toAuditId: string, artifactId: string): Promise<boolean>;
  /** Remove every artifact of an audit. */
  deleteAudit(auditId: string): Promise<void>;
}

export const ARTIFACT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
