import type { Account } from "../api";

/** First run: pick a folder (or a browser vault where folders aren't supported). */
export function Welcome({ canPickFolder, account, onPickFolder, onBrowserVault }: {
  canPickFolder: boolean;
  account: Account | null | undefined;
  onPickFolder: () => void;
  onBrowserVault: () => void;
}) {
  return (
    <div className="welcome">
      <div className="welcome-card">
        <img src="/icon.svg" alt="" width={48} height={48} />
        <h1>Welcome to Writalin</h1>
        <p className="w-muted">Your notes live as plain Markdown files in a folder you choose. They open in Obsidian too, and nothing leaves your computer unless you turn on sync.</p>
        {canPickFolder ? (
          <>
            <button className="w-btn w-btn-primary" onClick={onPickFolder}>Choose a folder for your notes</button>
            <button className="w-btn w-btn-ghost" onClick={onBrowserVault}>Keep notes in this browser instead</button>
          </>
        ) : (
          <>
            <button className="w-btn w-btn-primary" onClick={onBrowserVault}>Start a vault in this browser</button>
            <p className="w-muted welcome-note">This browser can't open folders, so notes are saved inside it. Use Export → Whole vault to keep a copy, or open Writalin in Chrome or Edge to use a folder.</p>
          </>
        )}
        {account === null && (
          <p className="welcome-note">
            Using Writalin on more than one computer? <a href="/login">Sign in</a> to sync.
          </p>
        )}
        {account && <p className="welcome-note w-muted">Signed in as {account.email}. Open a vault, then turn on sync in Settings.</p>}
      </div>
    </div>
  );
}
