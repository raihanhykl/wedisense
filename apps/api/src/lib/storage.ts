import fs from 'fs';
import path from 'path';

const STORAGE_PATH = process.env['STORAGE_PATH'] ?? './uploads';

export interface StorageAdapter {
  save(relativePath: string, data: Buffer): Promise<string>;
  delete(relativePath: string): Promise<void>;
  exists(relativePath: string): Promise<boolean>;
  getAbsolutePath(relativePath: string): string;
}

export class LocalStorageAdapter implements StorageAdapter {
  private basePath: string;

  constructor(basePath?: string) {
    this.basePath = path.resolve(basePath ?? STORAGE_PATH);
  }

  save(relativePath: string, data: Buffer): Promise<string> {
    const fullPath = path.join(this.basePath, relativePath);
    const dir = path.dirname(fullPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, data);
    return Promise.resolve(`/uploads/${relativePath}`);
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

/** Default storage adapter instance */
export const storage = new LocalStorageAdapter();
