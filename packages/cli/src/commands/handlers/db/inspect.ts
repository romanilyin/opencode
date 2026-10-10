import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"

export default Runtime.handler(
  Commands.commands.db.commands.inspect,
  Effect.fn("cli.db.inspect")(function* (input) {
    const { DatabaseMaintenance } = yield* Effect.promise(() => import("@opencode/server/storage"))
    process.stdout.write(JSON.stringify(yield* DatabaseMaintenance.analyze(input.path), null, 2) + "\n")
  }),
)
