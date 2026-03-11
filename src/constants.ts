import { homedir } from "node:os";
import { join } from "node:path";

export const CHRONO_DIR = join(homedir(), ".chrono");
export const DB_PATH = join(CHRONO_DIR, "history.db");
export const BIN_DIR = join(CHRONO_DIR, "bin");
export const ZSH_PLUGIN_PATH = join(CHRONO_DIR, "chrono.zsh");

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS history (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  command   TEXT    NOT NULL,
  cwd       TEXT    NOT NULL DEFAULT '',
  hostname  TEXT    NOT NULL DEFAULT '',
  timestamp INTEGER NOT NULL,
  duration  INTEGER,
  exit_code INTEGER,
  session   TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_history_command   ON history(command);
CREATE INDEX IF NOT EXISTS idx_history_cwd       ON history(cwd);
CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history(timestamp);
CREATE INDEX IF NOT EXISTS idx_history_session   ON history(session);
`;
