import Fastify, { type FastifyInstance } from "fastify";

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  app.get("/api/v1/health", async () => ({
    status: "ok",
    service: "veyra-server",
    version: "0.1.0",
  }));

  return app;
}
