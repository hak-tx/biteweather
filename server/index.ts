import { createApp, initStripeSchema } from "./app.js";
import { setupVite, serveStatic, log } from "./vite.js";

(async () => {
  const { app, server } = await createApp();

  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
    initStripeSchema();
  });
})();
