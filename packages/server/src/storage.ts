// Host-local maintenance entrypoint for the CLI. Kept outside the HTTP/runtime
// graph so remote clients and Durable Objects never expose filesystem operations.
export { DatabaseMaintenance } from "@opencode/core/database/maintenance"
