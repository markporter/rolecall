// Shared file helpers for connection-based built-in modules (Todo 27).
//
// Mirrors the `file` example module: reads via `cat` and writes through a quoted
// heredoc (verbatim, no shell expansion) over the target `Connection`. A random
// delimiter avoids collisions with file contents. These helpers operate ON the
// target host exactly like the existing example modules.

import { randomUUID } from "node:crypto";
import type { Connection } from "../../transport/connection";

/** POSIX single-quote a string for safe use inside a shell command. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Read a file from the target host. Returns `null` when the path is absent.
 * @param conn Active connection (Local or Ssh).
 * @param path Absolute path on the target.
 * @param become When true, run `cat` under `sudo` so root-owned files can be read.
 */
export async function readRemoteFile(
  conn: Connection,
  path: string,
  become = false,
): Promise<string | null> {
  const cmd = become
    ? `sudo cat ${shQuote(path)} 2>/dev/null`
    : `cat ${shQuote(path)} 2>/dev/null`;
  const res = await conn.exec(cmd);
  return res.exitCode === 0 ? res.stdout : null;
}

/**
 * Write `content` to `path` on the target host via a heredoc. Throws on failure.
 * With `become`, the temp file is written by the connecting user and atomically
 * `mv`'d into place under `sudo` so root-owned destinations are supported.
 * @param conn Active connection (Local or Ssh).
 * @param path Destination path on the target.
 * @param content Desired file contents (written verbatim).
 * @param become When true, escalate the write with sudo.
 */
export async function writeRemoteFile(
  conn: Connection,
  path: string,
  content: string,
  become = false,
): Promise<void> {
  const delim = `ROLECALL_EOF_${randomUUID()}`;
  if (become) {
    const tmp = `/tmp/rolecall_write_${randomUUID()}.tmp`;
    const w1 = await conn.exec(`cat > ${shQuote(tmp)} <<'${delim}'\n${content}\n${delim}`);
    if (w1.exitCode !== 0) {
      throw new Error(`write (temp) failed: ${w1.stderr || `exit ${w1.exitCode}`}`);
    }
    const w2 = await conn.exec(`sudo mv ${shQuote(tmp)} ${shQuote(path)}`);
    if (w2.exitCode !== 0) {
      throw new Error(`write (mv) failed: ${w2.stderr || `exit ${w2.exitCode}`}`);
    }
    return;
  }
  const cmd = `cat > ${shQuote(path)} <<'${delim}'\n${content}\n${delim}`;
  const w = await conn.exec(cmd);
  if (w.exitCode !== 0) {
    throw new Error(`write failed: ${w.stderr || `exit ${w.exitCode}`}`);
  }
}

/**
 * Write `content` to `path` ending with exactly one trailing newline. Unlike
 * {@link writeRemoteFile}, which appends a newline to `content` (so content that
 * already ends in `\n` gains a blank line), this trims one trailing newline
 * first so the written file equals `content` verbatim. Used by modules that
 * compare full file contents for idempotency.
 * @param conn Active connection (Local or Ssh).
 * @param path Destination path on the target.
 * @param content Desired file contents (written verbatim, one trailing newline).
 * @param become When true, escalate the write with sudo.
 */
export async function writeRemoteFileExact(
  conn: Connection,
  path: string,
  content: string,
  become = false,
): Promise<void> {
  const body = content.endsWith("\n") ? content.slice(0, -1) : content;
  await writeRemoteFile(conn, path, body, become);
}

/**
 * Write `newContent` to `path`, optionally rotating a timestamped `.bak` backup
 * first (via `cp -p`, attributes preserved) and running a `validate` command
 * against the written file (`%s` → path). Returns failure detail and any backup
 * path when the write or validation does not succeed. Used by file-editing
 * builtin modules (lineinfile, blockinfile, …) for Ansible-parity backup/validate.
 * @param conn Active connection (Local or Ssh).
 * @param path Destination path on the target.
 * @param newContent Desired file contents (written verbatim).
 * @param opts backup/validate/become flags plus the existing content used to decide whether a backup is taken.
 */
export async function writeWithBackupValidate(
  conn: Connection,
  path: string,
  newContent: string,
  opts: { backup: boolean; validate: string; become: boolean; existing: string | null },
): Promise<{ backupFile?: string; failed?: string }> {
  const sudo = opts.become ? "sudo " : "";
  let backupFile: string | undefined;
  if (opts.backup && opts.existing !== null) {
    backupFile = `${path}.${Date.now()}.bak`;
    const r = await conn.exec(`${sudo}cp -p ${shQuote(path)} ${shQuote(backupFile)}`);
    if (r.exitCode !== 0) return { failed: `backup failed: ${r.stderr || `exit ${r.exitCode}`}` };
  }
  try {
    await writeRemoteFile(conn, path, newContent, opts.become);
  } catch (e) {
    return { failed: e instanceof Error ? e.message : String(e), backupFile };
  }
  if (opts.validate) {
    const vcmd = opts.validate.replace(/%s/g, path);
    const vr = await conn.exec(`${sudo}bash -c ${shQuote(vcmd)}`);
    if (vr.exitCode !== 0) {
      return { failed: `validate failed: ${vr.stderr || `exit ${vr.exitCode}`}`, backupFile };
    }
  }
  return { backupFile };
}

/**
 * Build the on-target command string for a module, applying (in order) the
 * task-level `environment` exports, then privilege escalation (`become` /
 * `become_user` → `sudo [-u <user>] sh -c '<cmd>'`). Shared by builtin modules
 * so task-level directives are honoured consistently.
 * @param cmd The raw command to run on the target.
 * @param opts become/ becomeUser/ environment from ModuleContext.
 * @returns The fully-wrapped command string.
 */
export function wrapCommand(
  cmd: string,
  opts: { become: boolean; becomeUser?: string; environment?: Record<string, string> },
): string {
  const withEnv =
    opts.environment && Object.keys(opts.environment).length > 0
      ? `${Object.entries(opts.environment)
          .map(([k, v]) => `export ${k}=${shQuote(v)}`)
          .join("; ")}; ${cmd}`
      : cmd;
  if (!opts.become && !opts.becomeUser) return withEnv;
  const sudo = opts.becomeUser ? `sudo -u ${shQuote(opts.becomeUser)}` : "sudo";
  return `${sudo} sh -c ${shQuote(withEnv)}`;
}
