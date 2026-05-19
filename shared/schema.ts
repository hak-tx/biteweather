import { sql } from 'drizzle-orm';
import { pgTable, text, serial, integer, boolean, doublePrecision, varchar, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  password: varchar("password"), // Hashed password for email/password auth (null for OAuth users)
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  subscriptionTier: varchar("subscription_tier").default('free').notNull(), // 'free' or 'premium'
  stripeCustomerId: varchar("stripe_customer_id"),
  stripeSubscriptionId: varchar("stripe_subscription_id"),
  subscriptionStatus: varchar("subscription_status"), // 'active', 'canceled', 'past_due', etc.
  favoriteLocations: jsonb("favorite_locations").$type<string[]>().default(sql`'[]'::jsonb`).notNull(), // Array of location queries
  premiumAccessUntil: timestamp("premium_access_until"), // For free access promo codes - grants premium until this date
  isAdmin: boolean("is_admin").default(false).notNull(), // Admin flag for promo code management
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

export const locations = pgTable("locations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  lat: doublePrecision("lat").notNull(),
  lon: doublePrecision("lon").notNull(),
  isFavorite: boolean("is_favorite").default(false).notNull(),
  query: text("query").notNull(), // The search term used
});

export const insertLocationSchema = createInsertSchema(locations).omit({ 
  id: true 
});

export type InsertLocation = z.infer<typeof insertLocationSchema>;
export type Location = typeof locations.$inferSelect;

// Promotion codes table - supports both discount codes and free access codes
export const promotionCodes = pgTable("promotion_codes", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).unique().notNull(), // The actual promo code users enter
  type: varchar("type", { length: 20 }).notNull(), // 'discount' or 'free_access'
  discountPercent: integer("discount_percent"), // For discount codes: 10, 20, 50, 100 (percent off)
  freeAccessDays: integer("free_access_days"), // For free_access codes: number of days granted
  maxRedemptions: integer("max_redemptions"), // null = unlimited
  currentRedemptions: integer("current_redemptions").default(0).notNull(),
  stripeCouponId: varchar("stripe_coupon_id"), // For discount codes synced with Stripe
  validFrom: timestamp("valid_from").defaultNow().notNull(),
  validUntil: timestamp("valid_until"), // null = no expiration
  isActive: boolean("is_active").default(true).notNull(),
  description: varchar("description", { length: 255 }), // Internal note about what this code is for
  createdBy: varchar("created_by"), // Admin user ID who created it
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPromotionCodeSchema = createInsertSchema(promotionCodes).omit({
  id: true,
  currentRedemptions: true,
  createdAt: true,
});

export type InsertPromotionCode = z.infer<typeof insertPromotionCodeSchema>;
export type PromotionCode = typeof promotionCodes.$inferSelect;

// Promotion redemptions table - tracks who redeemed what code
export const promotionRedemptions = pgTable("promotion_redemptions", {
  id: serial("id").primaryKey(),
  codeId: integer("code_id").notNull(),
  userId: varchar("user_id").notNull(),
  redeemedAt: timestamp("redeemed_at").defaultNow().notNull(),
});

export type PromotionRedemption = typeof promotionRedemptions.$inferSelect;
