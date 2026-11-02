// Filesystem-backed stores for local development and tests. Documents are
// written atomically (temp file + rename) so a crash never leaves a torn job,
// and everything lives under a gitignored data directory, never a public
// static folder.

import { promises as fs } from "node:fs";
import path from "node:path";
import { AuditJob, TERMINAL_JOB_STATUSES, type JobStatus } from "../contracts.ts";
import { AUDIT_ID_RE } from "../util.ts";
import { ARTIFACT_ID_RE, StaleRevisionError, type ArtifactStore, type JobStore } from "./types.ts";

export class FileJobStore implements JobStore {
  private readonly dir: string;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, "jobs");
  }

  private file(id: string): string {
    if (!AUDIT_ID_RE.test(id)) throw new Error("invalid audit id");
    return path.join(this.dir, `${id}.json`);
  }

  private async serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(id, next.catch(() => undefined));
    return next;
  }

  private async read(id: string): Promise<AuditJob | null> {
    try {
      const text = await fs.readFile(this.file(id), "utf8");
      return AuditJob.parse(JSON.parse(text));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async write(job: AuditJob): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const target = this.file(job.id);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(job), "utf8");
    await fs.rename(tmp, target);
  }

  async create(job: AuditJob): Promise<void> {
    await this.serial(job.id, async () => {
      if (await this.read(job.id)) throw new Error("audit already exists");
      await this.write(job);
    });
  }

  async save(job: AuditJob): Promise<void> {
    await this.serial(job.id, async () => {
      const existing = await this.read(job.id);
      if (existing && existing.revision > job.revision) throw new StaleRevisionError(job.id);
      await this.write({ ...job, revision: job.revision + 1 });
      job.revision += 1;
    });
  }

  get(id: string): Promise<AuditJob | null> {
    return AUDIT_ID_RE.test(id) ? this.read(id) : Promise.resolve(null);
  }

  async getOwned(id: string, ownerId: string): Promise<AuditJob | null> {
    const job = await this.get(id);
    return job && job.ownerId === ownerId ? job : null;
  }

  private async all(): Promise<AuditJob[]> {
    let names: string[] = [];
    try {
      names = await fs.readdir(this.dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const jobs: AuditJob[] = [];
    for (const name of names) {
      const match = /^(aud_[0-9a-f]{12})\.json$/.exec(name);
      if (!match) continue;
      const job = await this.read(match[1]!).catch(() => null);
      if (job) jobs.push(job);
    }
    return jobs;
  }

  async list(ownerId: string, limit: number): Promise<AuditJob[]> {
    return (await this.all())
      .filter((j) => j.ownerId === ownerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async listByStatus(statuses: readonly JobStatus[]): Promise<AuditJob[]> {
    return (await this.all()).filter((j) => statuses.includes(j.status));
  }

  async countActive(ownerId: string): Promise<number> {
    return (await this.all()).filter((j) => j.ownerId === ownerId && !TERMINAL_JOB_STATUSES.includes(j.status)).length;
  }

  async deleteFinishedBefore(cutoffIso: string): Promise<string[]> {
    const deleted: string[] = [];
    for (const job of await this.all()) {
      if (!TERMINAL_JOB_STATUSES.includes(job.status) || job.createdAt >= cutoffIso) continue;
      await this.serial(job.id, () => fs.rm(this.file(job.id), { force: true }));
      deleted.push(job.id);
    }
    return deleted;
  }
}

export class FileArtifactStore implements ArtifactStore {
  private readonly root: string;

  constructor(dataDir: string) {
    this.root = path.resolve(dataDir, "artifacts");
  }

  private resolve(auditId: string, artifactId: string): string {
    if (!AUDIT_ID_RE.test(auditId) || !ARTIFACT_ID_RE.test(artifactId)) throw new Error("invalid artifact reference");
    const full = path.resolve(this.root, auditId, artifactId);
    // Defence in depth on top of the id patterns.
    if (!full.startsWith(path.join(this.root, auditId) + path.sep)) throw new Error("invalid artifact path");
    return full;
  }

  async put(auditId: string, artifactId: string, bytes: Buffer): Promise<void> {
    const full = this.resolve(auditId, artifactId);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, bytes);
  }

  async get(auditId: string, artifactId: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.resolve(auditId, artifactId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async deleteAudit(auditId: string): Promise<void> {
    if (!AUDIT_ID_RE.test(auditId)) throw new Error("invalid audit id");
    await fs.rm(path.join(this.root, auditId), { recursive: true, force: true });
  }

  async copy(fromAuditId: string, toAuditId: string, artifactId: string): Promise<boolean> {
    const bytes = await this.get(fromAuditId, artifactId);
    if (!bytes) return false;
    await this.put(toAuditId, artifactId, bytes);
    return true;
  }
}
