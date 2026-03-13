import { mkdirSync, existsSync } from "node:fs";
import { CHRONO_DIR, DB_PATH } from "./constants";
import { openDb, addCommand, queryUp, importHistory, getStats, dedup, resetHistory } from "./db";
import { runFzfSearch, collapseCommand } from "./search";
import { shouldIgnore } from "./ignore";

function ensureChronoDir(): void {
  if (!existsSync(CHRONO_DIR)) {
    mkdirSync(CHRONO_DIR, { recursive: true });
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const subcommand = args[0];

  if (!subcommand) {
    console.log("Usage: chrono <add|up|search|import|stats|dedup|reset>");
    process.exit(1);
  }

  ensureChronoDir();
  const db = openDb(DB_PATH);

  try {
    switch (subcommand) {
      case "add": {
        const command = args[1];
        if (!command || shouldIgnore(command)) {
          break;
        }
        addCommand(db, {
          command,
          cwd: process.env.PWD ?? process.cwd(),
          hostname: process.env.HOST ?? process.env.HOSTNAME ?? "",
          timestamp: Math.floor(Date.now() / 1000),
          duration: args[2] ? parseInt(args[2], 10) : undefined,
          exitCode: args[3] ? parseInt(args[3], 10) : undefined,
          session: process.env.CHRONO_SESSION ?? "",
        });
        break;
      }

      case "up": {
        const prefix = args[1] ?? "";
        const offset = parseInt(args[2] ?? "0", 10);
        const result = queryUp(db, {
          prefix,
          cwd: process.env.PWD ?? process.cwd(),
          offset,
        });
        if (result) {
          process.stdout.write(collapseCommand(result));
        } else {
          process.exit(1);
        }
        break;
      }

      case "search": {
        const scope = args[1] ?? "global";
        const result = await runFzfSearch(
          db,
          scope,
          process.env.PWD ?? process.cwd(),
          process.env.CHRONO_SESSION,
        );
        if (result) {
          process.stdout.write(result);
        } else {
          process.exit(1);
        }
        break;
      }

      case "import": {
        const filePath = args[1] ?? `${process.env.HOME}/.zsh_history`;
        const count = importHistory(db, filePath);
        const removed = dedup(db);
        console.log(`Imported ${count} commands from ${filePath} (${removed} duplicates removed)`);
        break;
      }

      case "stats": {
        const stats = getStats(db);
        console.log(`Total commands: ${stats.total}\n`);
        console.log("Top 10:");
        const maxCount = stats.top[0]?.count ?? 0;
        const barWidth = 30;
        for (const { command, count } of stats.top) {
          const bar = "█".repeat(Math.round((count / maxCount) * barWidth));
          console.log(`  ${bar} ${count.toString().padStart(5)}  ${command}`);
        }
        break;
      }

      case "dedup": {
        const removed = dedup(db);
        console.log(`Removed ${removed} duplicate commands`);
        break;
      }

      case "reset": {
        const filePath = args[1] ?? `${process.env.HOME}/.zsh_history`;
        resetHistory(db);
        const count = importHistory(db, filePath);
        const removed = dedup(db);
        console.log(`Reset complete — imported ${count} commands from ${filePath} (${removed} duplicates removed)`);
        break;
      }

      default:
        console.error(`Unknown subcommand: ${subcommand}`);
        process.exit(1);
    }
  } finally {
    db.close();
  }
}

main();
