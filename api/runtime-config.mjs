// Effective Vercel root-function entrypoint (project Root Directory: ./).
// Keeps public /config.js dynamic without rebuilding the Go executable.
// Only allowlisted public values are emitted by the shared implementation.
import handler from "../client/htmls/vercel/api/runtime-config.js";
export default handler;
