import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function withChronoZshTest(
  chronoBinScript: string,
  driver: string,
  prompt: string = "% ",
): { exitCode: number; stdout: string; stderr: string; logPath: string; cleanup: () => void } {
  const tempDir = mkdtempSync(join(tmpdir(), "chrono-zsh-test-"));
  const logPath = join(tempDir, "chrono.log");
  const chronoBinPath = join(tempDir, "chrono-bin");
  const zshrcPath = join(tempDir, ".zshrc");
  const chronoPluginPath = resolve(process.cwd(), "chrono.zsh");

  writeFileSync(
    chronoBinPath,
    chronoBinScript.replaceAll("__LOG_PATH__", JSON.stringify(logPath)),
  );
  chmodSync(chronoBinPath, 0o755);

  writeFileSync(zshrcPath, `export CHRONO_BIN=${JSON.stringify(chronoBinPath)}
source ${JSON.stringify(chronoPluginPath)}
PROMPT=${JSON.stringify(prompt)}
`);

  const result = Bun.spawnSync(["python3", "-c", driver, tempDir], {
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stdout: Buffer.from(result.stdout).toString("utf8"),
    stderr: Buffer.from(result.stderr).toString("utf8"),
    logPath,
    cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
  };
}

describe("chrono zsh integration", () => {
  test("detaches add process from terminal stdio", () => {
    const run = withChronoZshTest(
      `#!/usr/bin/env zsh
{
  print -r -- "cmd:$*"
  [[ -t 0 ]] && print -r -- "stdin_tty:yes" || print -r -- "stdin_tty:no"
  [[ -t 1 ]] && print -r -- "stdout_tty:yes" || print -r -- "stdout_tty:no"
  [[ -t 2 ]] && print -r -- "stderr_tty:yes" || print -r -- "stderr_tty:no"
} >> __LOG_PATH__
sleep 0.2
`,
      `
import os
import pty
import select
import sys
import time

zdotdir = sys.argv[1]

pid, fd = pty.fork()
if pid == 0:
    os.environ["ZDOTDIR"] = zdotdir
    os.execvp("zsh", ["zsh", "-i"])

def read_for(seconds):
    end = time.time() + seconds
    while time.time() < end:
        readable, _, _ = select.select([fd], [], [], 0.1)
        if fd in readable:
            try:
                os.read(fd, 4096)
            except OSError:
                break

read_for(1.5)
os.write(fd, b"echo trigger\\n")
read_for(1.0)
os.write(fd, b"exit\\n")
read_for(0.5)
`,
    );

    try {
      expect(run.exitCode).toBe(0);
      const log = readFileSync(run.logPath, "utf8");
      expect(log).toContain("cmd:add echo trigger");
      expect(log).toContain("stdin_tty:no");
      expect(log).toContain("stdout_tty:no");
      expect(log).toContain("stderr_tty:no");
    } finally {
      run.cleanup();
    }
  });

  test("records the command before the next prompt returns", () => {
    const run = withChronoZshTest(
      `#!/usr/bin/env zsh
sleep 0.25
print -r -- "cmd:$*" >> __LOG_PATH__
`,
      `
import os
import pty
import select
import sys
import time

zdotdir = sys.argv[1]
log_path = os.path.join(zdotdir, "chrono.log")
prompt = b"CHRONO_PROMPT> "

pid, fd = pty.fork()
if pid == 0:
    os.environ["ZDOTDIR"] = zdotdir
    os.execvp("zsh", ["zsh", "-i"])

def read_until_prompt(timeout):
    end = time.time() + timeout
    output = b""
    while time.time() < end:
        readable, _, _ = select.select([fd], [], [], 0.05)
        if fd not in readable:
            continue
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            break
        if not chunk:
            break
        output += chunk
        if prompt in output:
            return output
    return output

read_until_prompt(2.0)
os.write(fd, b"echo trigger\\n")
read_until_prompt(2.0)

logged = False
if os.path.exists(log_path):
    with open(log_path, "r", encoding="utf8") as fh:
        logged = "cmd:add echo trigger" in fh.read()

print("LOGGED_AT_PROMPT:" + ("yes" if logged else "no"))
sys.stdout.flush()
os.write(fd, b"exit\\n")
time.sleep(0.1)
`,
      "CHRONO_PROMPT> ",
    );

    try {
      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain("LOGGED_AT_PROMPT:yes");
    } finally {
      run.cleanup();
    }
  });
});
