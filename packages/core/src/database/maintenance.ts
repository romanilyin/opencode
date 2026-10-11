export * as DatabaseMaintenance from "./maintenance.js"

import { Effect, Exit } from "effect"
import { sql } from "drizzle-orm"
import { lstat, open, realpath, rm, stat } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { sqliteLayer } from "#sqlite"
import { EffectDrizzleSqlite } from "./drizzle.js"

type Connection = Effect.Success<ReturnType<typeof EffectDrizzleSqlite.makeWithDefaults>>

export interface Overview {
  readonly path: string
  readonly databaseBytes: number
  readonly walBytes: number
  readonly shmBytes: number
  readonly totalBytes: number
  readonly pageSize: number
  readonly pageCount: number
  readonly reusablePages: number
  readonly reusableBytes: number
  readonly journalMode: string
}

export interface Analysis {
  readonly overview: Overview
  readonly format: "v1" | "v2" | "mixed" | "unknown"
  readonly events: readonly { readonly type: string; readonly count: number; readonly payloadBytes: number }[]
  readonly eventCompaction: "unsupported"
}

export interface Backup {
  readonly path: string
  readonly bytes: number
  readonly integrity: "ok"
}

export interface Vacuum {
  readonly backup: Backup
  readonly before: Overview
  readonly after: Overview
  readonly bytesReclaimed: number
}

// This separate connection intentionally skips application bootstrap: inspecting an
// old database must never migrate it, import sessions, or change its journal mode.
function withDatabase<A, E>(
  filename: string,
  readonly: boolean,
  run: (db: Connection, path: string) => Effect.Effect<A, E>,
) {
  return Effect.gen(function* () {
    if (filename === ":memory:") return yield* Effect.fail(new Error("Maintenance requires an existing database file"))
    const path = yield* Effect.tryPromise(() => realpath(resolve(filename)))
    const info = yield* Effect.tryPromise(() => stat(path))
    if (!info.isFile()) return yield* Effect.fail(new Error("Maintenance requires an existing database file"))
    return yield* Effect.gen(function* () {
      const db = yield* EffectDrizzleSqlite.makeWithDefaults()
      yield* db.run("PRAGMA busy_timeout = 1000")
      return yield* run(db, path)
    }).pipe(
      Effect.provide(sqliteLayer({ filename: path, readonly, readwrite: !readonly, create: false, disableWAL: true })),
      Effect.scoped,
    )
  })
}

const overviewUnlocked = Effect.fn("DatabaseMaintenance.overviewUnlocked")(function* (db: Connection, path: string) {
  const pages = yield* db.get<{ pageSize: number; pageCount: number; reusablePages: number }>(sql`
    SELECT (SELECT page_size FROM pragma_page_size) AS pageSize,
           (SELECT page_count FROM pragma_page_count) AS pageCount,
           (SELECT freelist_count FROM pragma_freelist_count) AS reusablePages
  `)
  const mode = yield* db.get<{ journal_mode: string }>(sql`PRAGMA journal_mode`)
  const files = yield* Effect.tryPromise(async () => {
    const sizes = await Promise.all(
      ["", "-wal", "-shm"].map(async (suffix) => {
        const info = await stat(path + suffix).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined
          throw error
        })
        return info?.size ?? 0
      }),
    )
    return { databaseBytes: sizes[0], walBytes: sizes[1], shmBytes: sizes[2] }
  })
  return {
    path,
    ...files,
    totalBytes: files.databaseBytes + files.walBytes + files.shmBytes,
    pageSize: pages?.pageSize ?? 0,
    pageCount: pages?.pageCount ?? 0,
    reusablePages: pages?.reusablePages ?? 0,
    reusableBytes: (pages?.pageSize ?? 0) * (pages?.reusablePages ?? 0),
    journalMode: mode?.journal_mode ?? "unknown",
  } satisfies Overview
})

export const overview = Effect.fn("DatabaseMaintenance.overview")((filename: string) =>
  withDatabase(filename, true, overviewUnlocked),
)

export const analyze = Effect.fn("DatabaseMaintenance.analyze")((filename: string) =>
  withDatabase(filename, true, (db, path) =>
    db.transaction(() =>
      Effect.gen(function* () {
        const tables = yield* db.all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table'`)
        const names = new Set(tables.map((table) => table.name))
        const current = names.has("session_v2")
        const legacy = names.has("session") && names.has("message") && names.has("part")
        const events = names.has("event")
          ? yield* db.all<Analysis["events"][number]>(sql`
      SELECT type, count(*) AS count, coalesce(sum(length(CAST(data AS BLOB))), 0) AS payloadBytes
      FROM event GROUP BY type ORDER BY payloadBytes DESC, type
    `)
          : []
        return {
          overview: yield* overviewUnlocked(db, path),
          format: current ? (legacy ? "mixed" : "v2") : legacy ? "v1" : "unknown",
          events,
          // Current events are irreducible facts. Old snapshot replacement markers
          // cannot be decoded or replayed by the current durable event manifest.
          eventCompaction: "unsupported",
        } satisfies Analysis
      }),
    ),
  ),
)

const verify = Effect.fn("DatabaseMaintenance.verify")(function* (db: Connection, backup = false) {
  const rows = yield* db.all<Record<string, string>>(
    sql.raw(`PRAGMA ${backup ? "maintenance_backup." : ""}quick_check`),
  )
  if (rows.length !== 1 || Object.values(rows[0])[0] !== "ok")
    return yield* Effect.fail(new Error(`SQLite integrity check failed: ${JSON.stringify(rows)}`))
  const foreignKeys = yield* db.all(sql.raw(`PRAGMA ${backup ? "maintenance_backup." : ""}foreign_key_check`))
  if (foreignKeys.length > 0) return yield* Effect.fail(new Error("SQLite foreign key check failed"))
})

const backupUnlocked = Effect.fn("DatabaseMaintenance.backupUnlocked")(function* (
  db: Connection,
  source: string,
  target: string,
) {
  const path = join(yield* Effect.tryPromise(() => realpath(dirname(resolve(target)))), basename(resolve(target)))
  const files = [path, `${path}-wal`, `${path}-shm`, `${path}-journal`]
  yield* Effect.tryPromise({
    try: async () => {
      const base = path.replace(/-(wal|shm|journal)$/i, "")
      const sourceInfo = await stat(source)
      const baseInfo = await stat(base).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined
        throw error
      })
      // File identity also covers case-insensitive filesystems mounted in Linux,
      // where process.platform does not describe pathname comparison semantics.
      if (baseInfo?.dev === sourceInfo.dev && baseInfo.ino === sourceInfo.ino)
        throw new Error("Backup must not replace the source database or its sidecars")
      for (const file of files.slice(1)) {
        const info = await lstat(file).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined
          throw error
        })
        if (info) throw new Error("Backup target sidecars already exist")
      }
    },
    catch: (cause) => cause,
  })
  yield* verify(db)
  // Exclusive creation rejects existing files, hardlinks and symlinks, and keeps
  // the recovery copy owner-readable on POSIX. VACUUM INTO accepts an empty file.
  const file = yield* Effect.tryPromise(() => open(path, "wx", 0o600))
  return yield* Effect.gen(function* () {
    yield* Effect.tryPromise(() => file.close())
    yield* db.run(sql`VACUUM INTO ${path}`)
    yield* db.run(sql`ATTACH DATABASE ${path} AS maintenance_backup`)
    yield* verify(db, true).pipe(Effect.ensuring(db.run(sql`DETACH DATABASE maintenance_backup`).pipe(Effect.orDie)))
    return { path, bytes: (yield* Effect.tryPromise(() => stat(path))).size, integrity: "ok" } satisfies Backup
  }).pipe(
    Effect.onExit((exit) =>
      Exit.isFailure(exit)
        ? Effect.tryPromise(() => Promise.all(files.map((file) => rm(file, { force: true })))).pipe(Effect.orDie)
        : Effect.void,
    ),
  )
})

export const backup = Effect.fn("DatabaseMaintenance.backup")((filename: string, target: string) =>
  withDatabase(filename, true, (db, path) => backupUnlocked(db, path, target)),
)

/** Reclaims SQLite free pages without deleting or rewriting any logical rows. */
export const vacuum = Effect.fn("DatabaseMaintenance.vacuum")((filename: string, target: string) =>
  withDatabase(filename, false, (db, path) =>
    Effect.gen(function* () {
      // BEGIN EXCLUSIVE alone allows WAL readers. EXCLUSIVE locking_mode instead
      // requires sole WAL ownership and retains the lock after COMMIT until close,
      // so the verified recovery copy and VACUUM share one exclusive boundary.
      yield* db.run(sql`PRAGMA locking_mode = EXCLUSIVE`)
      yield* db.run(sql`BEGIN EXCLUSIVE`).pipe(
        Effect.mapError(
          (cause) =>
            new Error("Cannot acquire exclusive database ownership; stop all servers using this database and retry", {
              cause,
            }),
        ),
      )
      yield* db.run(sql`COMMIT`)
      const before = yield* overviewUnlocked(db, path)
      const backup = yield* backupUnlocked(db, path, target)
      yield* db.run(sql`VACUUM`)
      yield* verify(db)
      const checkpoint = yield* db.get<{ busy: number }>(sql`PRAGMA wal_checkpoint(TRUNCATE)`)
      if (checkpoint?.busy) return yield* Effect.fail(new Error("SQLite checkpoint is busy"))
      const after = yield* overviewUnlocked(db, path)
      return {
        backup,
        before,
        after,
        bytesReclaimed: Math.max(0, before.totalBytes - after.totalBytes),
      } satisfies Vacuum
    }),
  ),
)
