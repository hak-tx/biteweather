import type { Request, Response } from "express";
import { createApp, initStripeSchema } from "../server/app";

const appPromise = createApp().then(({ app }) => {
  initStripeSchema();
  return app;
});

export default async function handler(req: Request, res: Response) {
  const app = await appPromise;
  return app(req, res);
}
