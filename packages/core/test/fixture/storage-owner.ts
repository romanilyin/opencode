import { Database } from "bun:sqlite"

const db = new Database(process.argv[2])
db.query("SELECT * FROM sqlite_master LIMIT 1").get()
process.stdout.write("READY\n")
process.stdin.on("data", () => {
  db.close()
  process.exit(0)
})
