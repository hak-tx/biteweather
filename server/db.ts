import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../shared/schema.js";

const databaseUrl = process.env.DATABASE_URL;

export const pool = databaseUrl
  ? new pg.Pool({ connectionString: databaseUrl })
  : (null as unknown as pg.Pool);

export const db = databaseUrl
  ? drizzle(pool, { schema })
  : (null as unknown as ReturnType<typeof drizzle>);
