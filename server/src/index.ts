import { buildApp } from "./app.js";

const host = process.env.VEYRA_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.VEYRA_PORT ?? "8787", 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("VEYRA_PORT must be an integer between 1 and 65535");
}

const app = buildApp();

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error, "Veyra server failed to start");
  process.exitCode = 1;
}

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "Shutting down Veyra server");
  try {
    await app.close();
  } catch (error) {
    app.log.error(error, "Error while closing Veyra server");
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
