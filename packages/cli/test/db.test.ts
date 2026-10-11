import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { join } from "node:path"
import { tmpdir } from "./fixture/tmpdir"
import { isolatedEnv } from "./fixture/environment"

async function cli(args: string[], root: string) {
  const child = Bun.spawn([process.execPath, "run", join(import.meta.dir, "../src/index.ts"), ...args], {
    cwd: join(import.meta.dir, ".."),
    env: isolatedEnv(root),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, exitCode }
}

test("database help exposes the explicit file and apply boundary", async () => {
  await using tmp = await tmpdir()
  const [help, vacuum] = await Promise.all([cli(["db", "--help"], tmp.path), cli(["db", "vacuum", "--help"], tmp.path)])
  expect(help.exitCode).toBe(0)
  expect(help.stdout).toContain("inspect")
  expect(help.stdout).toContain("backup")
  expect(help.stdout).toContain("vacuum")
  expect(vacuum.exitCode).toBe(0)
  expect(vacuum.stdout).toContain("--apply")
  expect(vacuum.stdout).toContain("stop all servers")
}, 120000)

test("database inspection and default vacuum skip schema migrations and writes", async () => {
  await using tmp = await tmpdir()
  const path = join(tmp.path, "database.db")
  const target = join(tmp.path, "backup.db")
  const database = new Database(path)
  database.exec("CREATE TABLE fixture (data TEXT); INSERT INTO fixture VALUES ('keep')")
  database.close()
  const before = await Bun.file(path).bytes()
  const inspected = await cli(["db", "inspect", path], tmp.path)
  expect({ exitCode: inspected.exitCode, stderr: inspected.stderr }).toEqual({ exitCode: 0, stderr: "" })
  expect(JSON.parse(inspected.stdout)).toMatchObject({ format: "unknown", eventCompaction: "unsupported" })
  const vacuum = await cli(["db", "vacuum", path, target], tmp.path)
  expect({ exitCode: vacuum.exitCode, stderr: vacuum.stderr }).toEqual({ exitCode: 0, stderr: "" })
  expect(JSON.parse(vacuum.stdout).dryRun).toBe(true)
  expect(await Bun.file(path).bytes()).toEqual(before)
  expect(await Bun.file(target).exists()).toBe(false)
}, 120000)

test("database commands refuse omitted or missing paths", async () => {
  await using tmp = await tmpdir()
  const path = join(tmp.path, "missing.db")
  expect((await cli(["db", "inspect"], tmp.path)).exitCode).not.toBe(0)
  expect((await cli(["db", "inspect", path], tmp.path)).exitCode).not.toBe(0)
  expect(await Bun.file(path).exists()).toBe(false)
}, 120000)
