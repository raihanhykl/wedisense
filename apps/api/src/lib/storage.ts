import fs from 'fs';
import path from 'path';

const STORAGE_PATH = process.env['STORAGE_PATH'] ?? './uploads';

// Root for files that must NEVER be reachable without authentication.
// Deliberately a SIBLING of STORAGE_PATH, not a subdirectory: app.ts mounts
// `express.static` over the whole of STORAGE_PATH, so anything nested inside
// it — including a folder named "private" — is served to anonymous callers.
// Keeping this outside that tree makes the isolation structural rather than
// dependent on a path-matching deny rule.
const PRIVATE_STORAGE_PATH = process.env['PRIVATE_STORAGE_PATH'] ?? './private-uploads';

export interface StorageAdapter {
  save(relativePath: string, data: Buffer): Promise<string>;
  delete(relativePath: string): Promise<void>;
  exists(relativePath: string): Promise<boolean>;
  getAbsolutePath(relativePath: string): string;
}

export class LocalStorageAdapter implements StorageAdapter {
  private basePath: string;
  private urlPrefix: string | null;

  /**
   * @param basePath  Directory to store files under. Defaults to STORAGE_PATH.
   * @param urlPrefix Public URL prefix `save()` reports back, or null when the
   *   files are not publicly addressable. Passing null makes `save()` return
   *   the relative path instead, so a caller can't mistake a private file's
   *   location for a working public URL.
   */
  constructor(basePath?: string, urlPrefix: string | null = '/uploads') {
    this.basePath = path.resolve(basePath ?? STORAGE_PATH);
    this.urlPrefix = urlPrefix;
  }

  save(relativePath: string, data: Buffer): Promise<string> {
    const fullPath = path.join(this.basePath, relativePath);
    const dir = path.dirname(fullPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, data);
    return Promise.resolve(this.urlPrefix ? `${this.urlPrefix}/${relativePath}` : relativePath);
  }

  delete(relativePath: string): Promise<void> {
    const fullPath = path.join(this.basePath, relativePath);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
    return Promise.resolve();
  }

  exists(relativePath: string): Promise<boolean> {
    const fullPath = path.join(this.basePath, relativePath);
    return Promise.resolve(fs.existsSync(fullPath));
  }

  getAbsolutePath(relativePath: string): string {
    return path.join(this.basePath, relativePath);
  }
}

/** Default storage adapter instance — files served publicly at /uploads. */
export const storage = new LocalStorageAdapter();

/**
 * Storage for authentication-gated artifacts (signed handover scans).
 * Files here have no public URL; serve them through a route that runs
 * `authenticate` + `authorize` and streams the file itself.
 */
export const privateStorage = new LocalStorageAdapter(PRIVATE_STORAGE_PATH, null);
