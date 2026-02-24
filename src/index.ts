import { start } from "./server.js";

start().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
