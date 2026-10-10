import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises"
import { join } from "node:path"
import { Effect } from "effect"
import { DatabaseMaintenance } from "@opencode/core/database/maintenance"
import { tmpdir } from "./fixture/tmpdir"

function fixture(path: string, wal = false) {
  const db = new Database(path)
  if (wal) db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA foreign_keys = ON")
  db.exec(`
    CREATE TABLE session_v2 (id TEXT PRIMARY KEY);
    CREATE TABLE event (id TEXT PRIMARY KEY, aggregate_id TEXT REFERENCES session_v2(id), seq INTEGER, type TEXT, data TEXT);
    CREATE TABLE blob (id TEXT PRIMARY KEY, data BLOB);
    INSERT INTO session_v2 VALUES ('session');
  `)
  db.query("INSERT INTO event VALUES (?, ?, ?, ?, ?)").run(
    "event",
    "session",
    0,
    "session.text.ended.1",
    '{"text":"Привет"}',
  )
  db.query("INSERT INTO blob VALUES (?, ?)").run("blob", new Uint8Array([0, 128, 255]))
  return db
}

function content(path: string) {
  const db = new Database(path, { readonly: true })
  try {
    return {
      schema: db
        .query<
          { name: string; sql: string },
          []
        >("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all(),
      session: db.query("SELECT * FROM session_v2 ORDER BY id").all(),
      event: db.query("SELECT * FROM event ORDER BY id").all(),
      blob: db.query("SELECT id, hex(data) AS data FROM blob ORDER BY id").all(),
      integrity: db.query("PRAGMA quick_check").all(),
      foreignKeys: db.query("PRAGMA foreign_key_check").all(),
    }
  } finally {
    db.close()
  }
}

describe("filesystem database maintenance", () => {
  test("analysis is read-only, skips bootstrap and counts UTF-8 payload bytes", async () => {
    await using tmp = await tmpdir()
    const path = join(tmp.path, "database.db")
    fixture(path).close()
    const before = await readFile(path)
    const result = await Effect.runPromise(DatabaseMaintenance.analyze(path))

    expect(result.format).toBe("v2")
    expect(result.events).toEqual([
      { type: "session.text.ended.1", count: 1, payloadBytes: Buffer.byteLength('{"text":"Привет"}') },
    ])
    expect(result.eventCompaction).toBe("unsupported")
    expect(result.overview.journalMode).toBe("delete")
    expect(await readFile(path)).toEqual(before)
    expect(content(path).schema.map((row) => row.name)).not.toContain("migration")
  })

  test("rejects missing source files instead of creating or bootstrapping them", async () => {
    await using tmp = await tmpdir()
    const path = join(tmp.path, "missing.db")
    await expect(Effect.runPromise(DatabaseMaintenance.overview(path))).rejects.toThrow()
    expect(await Bun.file(path).exists()).toBe(false)
    await expect(Effect.runPromise(DatabaseMaintenance.overview(":memory:"))).rejects.toThrow("existing database file")
  })

  test("verified read-only backup includes committed WAL and preserves every fixture table", async () => {
    await using tmp = await tmpdir()
    const path = join(tmp.path, "database.db")
    const target = join(tmp.path, "backup.db")
    const source = fixture(path, true)
    try {
      expect((await stat(path + "-wal")).size).toBeGreaterThan(0)
      const before = content(path)
      const report = await Effect.runPromise(DatabaseMaintenance.backup(path, target))
      expect(report.integrity).toBe("ok")
      expect(report.bytes).toBeGreaterThan(0)
      expect(content(target)).toEqual(before)
      expect(content(path)).toEqual(before)
      if (process.platform !== "win32") expect((await stat(target)).mode & 0o777).toBe(0o600)
    } finally {
      source.close()
    }
  })

  test("refuses existing backup targets and source sidecars", async () => {
    await using tmp = await tmpdir()
    const path = join(tmp.path, "database.db")
    const target = join(tmp.path, "backup.db")
    fixture(path).close()
    await Bun.write(target, "do not overwrite")
    await expect(Effect.runPromise(DatabaseMaintenance.backup(path, target))).rejects.toThrow()
    await expect(Effect.runPromise(DatabaseMaintenance.backup(path, path))).rejects.toThrow("source database")
    await expect(Effect.runPromise(DatabaseMaintenance.backup(path, path + "-wal"))).rejects.toThrow("source database")
    expect(await Bun.file(target).text()).toBe("do not overwrite")
    expect(await Bun.file(path + "-wal").exists()).toBe(false)
  })

  test.skipIf(process.platform === "win32")("rejects symlink aliases of the source or existing targets", async () => {
    await using tmp = await tmpdir()
    const path = join(tmp.path, "database.db")
    const alias = join(tmp.path, "alias.db")
    fixture(path).close()
    await symlink(path, alias)
    await expect(Effect.runPromise(DatabaseMaintenance.backup(path, alias))).rejects.toThrow()
    const target = join(tmp.path, "backup.db")
    await expect(Effect.runPromise(DatabaseMaintenance.backup(alias, path))).rejects.toThrow("source database")
    await Effect.runPromise(DatabaseMaintenance.backup(alias, target))
    expect(content(target)).toEqual(content(path))
  })

  test("rejects source sidecar aliases using the actual filesystem identity", async () => {
    // Use the checkout filesystem as well as the ordinary tmp fixtures: on WSL
    // an NTFS checkout may be case-insensitive while /tmp is case-sensitive.
    const directory = await mkdtemp(join(import.meta.dir, ".storage-maintenance-"))
    try {
      const path = join(directory, "source.db")
      const alias = join(directory, "SOURCE.DB")
      const target = alias + "-journal"
      fixture(path).close()
      const before = content(path)
      const actual = await stat(alias).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined
        throw error
      })
      if (actual) {
        await expect(Effect.runPromise(DatabaseMaintenance.backup(path, target))).rejects.toThrow("source database")
        await expect(Effect.runPromise(DatabaseMaintenance.vacuum(path, target))).rejects.toThrow("source database")
        expect(await Bun.file(path + "-journal").exists()).toBe(false)
        expect(content(path)).toEqual(before)
        return
      }
      await Effect.runPromise(DatabaseMaintenance.backup(path, target))
      expect(content(target)).toEqual(before)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("refuses existing target sidecars without replacing sentinel data", async () => {
    await using tmp = await tmpdir()
    const path = join(tmp.path, "source.db")
    fixture(path).close()
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      const target = join(tmp.path, `backup${suffix}.db`)
      const sentinel = target + suffix
      await Bun.write(sentinel, "keep sentinel")
      await expect(Effect.runPromise(DatabaseMaintenance.backup(path, target))).rejects.toThrow(
        "sidecars already exist",
      )
      expect(await Bun.file(target).exists()).toBe(false)
      expect(await Bun.file(sentinel).text()).toBe("keep sentinel")
    }
  })

  test.skipIf(process.platform === "win32")("refuses dangling target sidecar symlinks", async () => {
    await using tmp = await tmpdir()
    const path = join(tmp.path, "source.db")
    const target = join(tmp.path, "backup.db")
    fixture(path).close()
    await symlink(join(tmp.path, "missing"), target + "-journal")
    await expect(Effect.runPromise(DatabaseMaintenance.backup(path, target))).rejects.toThrow("sidecars already exist")
    expect(await Bun.file(target).exists()).toBe(false)
  })

  test("vacuum has a verified recovery copy and preserves logical rows while reclaiming pages", async () => {
    await using tmp = await tmpdir()
    const path = join(tmp.path, "database.db")
    const target = join(tmp.path, "backup.db")
    const source = fixture(path, true)
    source.exec(
      "CREATE TABLE deleted (data BLOB); INSERT INTO deleted VALUES (zeroblob(1024 * 1024)); DELETE FROM deleted",
    )
    source.close()
    const before = content(path)
    const report = await Effect.runPromise(DatabaseMaintenance.vacuum(path, target))

    expect(report.backup.integrity).toBe("ok")
    expect(report.before.reusablePages).toBeGreaterThan(0)
    expect(report.after.reusablePages).toBe(0)
    expect(report.bytesReclaimed).toBeGreaterThan(0)
    expect(content(path)).toEqual(before)
    expect(content(target)).toEqual(before)
  })

  test("vacuum refuses an incumbent WAL owner before creating a backup", async () => {
    await using tmp = await tmpdir()
    const path = join(tmp.path, "database.db")
    const target = join(tmp.path, "backup.db")
    fixture(path, true).close()
    const owner = Bun.spawn([process.execPath, join(import.meta.dir, "fixture/storage-owner.ts"), path], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })
    try {
      const reader = owner.stdout.getReader()
      expect(new TextDecoder().decode((await reader.read()).value)).toContain("READY")
      await expect(Effect.runPromise(DatabaseMaintenance.vacuum(path, target))).rejects.toThrow(
        "exclusive database ownership",
      )
      expect(await Bun.file(target).exists()).toBe(false)
      owner.stdin.write("close\n")
      await owner.exited
      const result = await Effect.runPromise(DatabaseMaintenance.vacuum(path, target))
      expect(result.backup.integrity).toBe("ok")
    } finally {
      owner.kill()
      await owner.exited
    }
  })
})
