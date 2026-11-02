// PostgreSQL-backed job store (production path). The schema lives in
// migrations/000176_regional_audits.up.sql; this class never creates tables.
// The whole job is a validated JSONB document, with the columns needed for
// ownership checks, listing and recovery kept in plain columns.

import pg from "pg";
import { AuditJob, TERMINAL_JOB_STATUSES, type JobStatus } from "../contracts.ts";
import { AUDIT_ID_RE } from "../util.ts";
import { StaleRevisionError, type JobStore } from "./types.ts";

export class PgJobStore implements JobStore {
  private readonly pool: pg.Pool;

  constructor(connectionString: string, pool?: pg.Pool) {
    this.pool = pool ?? new pg.Pool({ connectionString, max: 4 });
  }

  async create(job: AuditJob): Promise<void> {
    await this.pool.query(
      `INSERT INTO regional_audits (id, owner_id, status, mode, previous_audit_id, doc, revision, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, now())`,
      [job.id, job.ownerId, job.status, job.mode, job.previousAuditId, JSON.stringify(job), job.revision, job.createdAt],
    );
  }

  async save(job: AuditJob): Promise<void> {
    const next = job.revision + 1;
    const res = await this.pool.query(
      `UPDATE regional_audits SET status = $2, doc = $3::jsonb, revision = $4, updated_at = now()
       WHERE id = $1 AND revision <= $5`,
      [job.id, job.status, JSON.stringify({ ...job, revision: next }), next, job.revision],
    );
    if (res.rowCount === 0) throw new StaleRevisionError(job.id);
    job.revision = next;
  }

  private parse(row: { doc: unknown } | undefined): AuditJob | null {
    return row ? AuditJob.parse(row.doc) : null;
  }

  async get(id: string): Promise<AuditJob | null> {
    if (!AUDIT_ID_RE.test(id)) return null;
    const res = await this.pool.query("SELECT doc FROM regional_audits WHERE id = $1", [id]);
    return this.parse(res.rows[0]);
  }

  async getOwned(id: string, ownerId: string): Promise<AuditJob | null> {
    if (!AUDIT_ID_RE.test(id)) return null;
    const res = await this.pool.query("SELECT doc FROM regional_audits WHERE id = $1 AND owner_id = $2", [id, ownerId]);
    return this.parse(res.rows[0]);
  }

  async list(ownerId: string, limit: number): Promise<AuditJob[]> {
    const res = await this.pool.query("SELECT doc FROM regional_audits WHERE owner_id = $1 ORDER BY created_at DESC LIMIT $2", [ownerId, limit]);
    return res.rows.map((r) => AuditJob.parse(r.doc));
  }

  async listByStatus(statuses: readonly JobStatus[]): Promise<AuditJob[]> {
    const res = await this.pool.query("SELECT doc FROM regional_audits WHERE status = ANY($1::text[])", [[...statuses]]);
    return res.rows.map((r) => AuditJob.parse(r.doc));
  }

  async countActive(ownerId: string): Promise<number> {
    const active = (["queued", "running"] as const).filter((s) => !TERMINAL_JOB_STATUSES.includes(s));
    const res = await this.pool.query("SELECT count(*)::int AS n FROM regional_audits WHERE owner_id = $1 AND status = ANY($2::text[])", [ownerId, active]);
    return res.rows[0]?.n ?? 0;
  }

  async deleteFinishedBefore(cutoffIso: string): Promise<string[]> {
    const res = await this.pool.query(
      "DELETE FROM regional_audits WHERE created_at < $1 AND status = ANY($2::text[]) RETURNING id",
      [cutoffIso, [...TERMINAL_JOB_STATUSES]],
    );
    return res.rows.map((r) => r.id as string);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
