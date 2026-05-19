import express, { type Request, Response, NextFunction } from "express";
import { runMigrations } from "stripe-replit-sync";
import { createServer, type Server } from "http";
import { registerRoutes } from "./routes.js";

function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export function initStripeSchema() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.warn("DATABASE_URL not set - skipping Stripe schema init");
    return;
  }

  runMigrations({ databaseUrl })
    .then(() => {
      console.log("Stripe schema ready");
    })
    .catch((error: any) => {
      console.warn("Stripe schema init failed (non-fatal):", error?.message);
    });
}

export async function createApp(): Promise<{ app: express.Express; server: Server }> {
  const app = express();

  // Prevent any unhandled promise rejections (e.g. from Stripe library internals) from crashing the process
  process.on("unhandledRejection", (reason: any) => {
    console.warn("[unhandledRejection] Caught and suppressed:", reason?.message || reason);
  });

  // Register Stripe webhook route BEFORE express.json()
  app.post(
    "/api/stripe/webhook/:uuid",
    express.raw({ type: "application/json" }),
    async (req, res) => {
      const signature = req.headers["stripe-signature"];

      if (!signature) {
        console.error("[Webhook] Missing stripe-signature header");
        return res.status(200).json({ received: false, error: "Missing signature" });
      }

      try {
        const sig = Array.isArray(signature) ? signature[0] : signature;

        if (!Buffer.isBuffer(req.body)) {
          console.error("[Webhook] req.body is not a Buffer - check middleware order");
          return res.status(200).json({ received: false, error: "Invalid payload format" });
        }

        const { WebhookHandlers } = await import("./webhookHandlers.js");
        const { uuid } = req.params;
        await WebhookHandlers.processWebhook(req.body as Buffer, sig, uuid);

        res.status(200).json({ received: true });
      } catch (error: any) {
        console.error("[Webhook] Error processing webhook:", error.message);
        res.status(200).json({ received: false, error: "Processing error logged" });
      }
    },
  );

  app.use(express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }));
  app.use(express.urlencoded({ extended: false }));

  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, any> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (path.startsWith("/api")) {
        let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
        if (capturedJsonResponse) {
          logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
        }

        if (logLine.length > 80) {
          logLine = logLine.slice(0, 79) + "...";
        }

        log(logLine);
      }
    });

    next();
  });

  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });

  return { app, server: server || createServer(app) };
}

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}
