/** Minimal promise wrapper around one IndexedDB object store per database name. */
export class KeyValueDB<V = unknown> {
  private dbp: Promise<IDBDatabase> | null = null;

  constructor(private dbName: string, private storeName = "kv") {}

  private db(): Promise<IDBDatabase> {
    if (!this.dbp) {
      this.dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(this.dbName, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(this.storeName);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbp;
  }

  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
    const db = await this.db();
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(this.storeName, mode);
      const req = fn(t.objectStore(this.storeName));
      t.oncomplete = () => resolve(req ? req.result : (undefined as T));
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  get(key: string): Promise<V | undefined> {
    return this.tx("readonly", (s) => s.get(key) as IDBRequest<V | undefined>);
  }
  set(key: string, value: V): Promise<void> {
    return this.tx("readwrite", (s) => void s.put(value, key));
  }
  delete(key: string): Promise<void> {
    return this.tx("readwrite", (s) => void s.delete(key));
  }
  keys(): Promise<string[]> {
    return this.tx("readonly", (s) => s.getAllKeys() as IDBRequest<string[]>);
  }
  async entries(): Promise<[string, V][]> {
    const keys = await this.keys();
    const values = await this.tx("readonly", (s) => s.getAll() as IDBRequest<V[]>);
    return keys.map((k, i) => [k, values[i]!]);
  }
  clear(): Promise<void> {
    return this.tx("readwrite", (s) => void s.clear());
  }
}
