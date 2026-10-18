// Pieces of the File System Access API that TypeScript's DOM lib doesn't ship yet.
export type PermissionMode = "read" | "readwrite";

export interface DirHandle extends FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemFileHandle | DirHandle>;
  queryPermission?(desc: { mode: PermissionMode }): Promise<PermissionState>;
  requestPermission?(desc: { mode: PermissionMode }): Promise<PermissionState>;
}

declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { id?: string; mode?: PermissionMode; startIn?: string }) => Promise<FileSystemDirectoryHandle>;
  }
}

export function supportsFolderAccess(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}
