import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"

export default Runtime.handler(
  Commands.commands.db.commands.vacuum,
  Effect.fn("cli.db.vacuum")(function* (input) {
    const { DatabaseMaintenance } = yield* Effect.promise(() => import("@opencode/server/storage"))
    if (!input.apply) {
      process.stdout.write(
        JSON.stringify({ dryRun: true, overview: yield* DatabaseMaintenance.overview(input.path) }, null, 2) + "\n",
      )
      return
    }
    process.stdout.write(JSON.stringify(yield* DatabaseMaintenance.vacuum(input.path, input.target), null, 2) + "\n")
  }),
)
