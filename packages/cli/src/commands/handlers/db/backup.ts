import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"

export default Runtime.handler(
  Commands.commands.db.commands.backup,
  Effect.fn("cli.db.backup")(function* (input) {
    const { DatabaseMaintenance } = yield* Effect.promise(() => import("@opencode/server/storage"))
    process.stdout.write(JSON.stringify(yield* DatabaseMaintenance.backup(input.path, input.target), null, 2) + "\n")
  }),
)
