import { locations, users, promotionCodes, promotionRedemptions, type Location, type InsertLocation, type User, type UpsertUser, type PromotionCode, type InsertPromotionCode, type PromotionRedemption } from "@shared/schema";
import { db } from "./db";
import { eq, desc, sql, and, gte, lte, or, isNull } from "drizzle-orm";

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  createUserWithPassword(email: string, hashedPassword: string, firstName?: string, lastName?: string): Promise<User>;
  updateUserSubscription(userId: string, subscription: {
    subscriptionTier: string;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    subscriptionStatus?: string;
  }): Promise<User>;
  updateUserStripeInfo(userId: string, stripeInfo: {
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
  }): Promise<User>;
  addFavoriteLocation(userId: string, locationQuery: string): Promise<User>;
  removeFavoriteLocation(userId: string, locationQuery: string): Promise<User>;

  // Stripe data queries (from stripe schema tables)
  getStripeProduct(productId: string): Promise<any>;
  listStripeProducts(active?: boolean, limit?: number, offset?: number): Promise<any[]>;
  listStripeProductsWithPrices(active?: boolean, limit?: number, offset?: number): Promise<any[]>;
  getStripePrice(priceId: string): Promise<any>;
  listStripePrices(active?: boolean, limit?: number, offset?: number): Promise<any[]>;
  getStripePricesForProduct(productId: string): Promise<any[]>;
  getStripeSubscription(subscriptionId: string): Promise<any>;

  // Locations - kept for future use or analytics, but not currently used by frontend
  getLocations(): Promise<Location[]>;
  createLocation(location: InsertLocation): Promise<Location>;
  searchLocations(query: string): Promise<Location[]>;

  // Promotion codes
  createPromotionCode(code: InsertPromotionCode): Promise<PromotionCode>;
  getPromotionCodeByCode(code: string): Promise<PromotionCode | undefined>;
  getPromotionCode(id: number): Promise<PromotionCode | undefined>;
  listPromotionCodes(): Promise<PromotionCode[]>;
  updatePromotionCode(id: number, updates: Partial<InsertPromotionCode>): Promise<PromotionCode>;
  deactivatePromotionCode(id: number): Promise<PromotionCode>;
  incrementCodeRedemptions(id: number): Promise<PromotionCode>;
  
  // Promotion redemptions
  createRedemption(codeId: number, userId: string): Promise<PromotionRedemption>;
  getUserRedemptionForCode(userId: string, codeId: number): Promise<PromotionRedemption | undefined>;
  getRedemptionsForCode(codeId: number): Promise<PromotionRedemption[]>;
  
  // User premium access
  grantPremiumAccess(userId: string, untilDate: Date): Promise<User>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUserWithPassword(email: string, hashedPassword: string, firstName?: string, lastName?: string): Promise<User> {
    const [user] = await db
      .insert(users)
      .values({
        id: `email:${email}`,
        email,
        password: hashedPassword,
        firstName: firstName || null,
        lastName: lastName || null,
      })
      .returning();
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    // First try to find existing user by email (handles OAuth linking to existing accounts)
    const existingUser = userData.email ? await this.getUserByEmail(userData.email) : null;
    
    if (existingUser) {
      // Update existing user, preserving their original ID but updating other info
      const [user] = await db
        .update(users)
        .set({
          firstName: userData.firstName || existingUser.firstName,
          lastName: userData.lastName || existingUser.lastName,
          profileImageUrl: userData.profileImageUrl || existingUser.profileImageUrl,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existingUser.id))
        .returning();
      return user;
    } else {
      // Create new user
      const [user] = await db
        .insert(users)
        .values(userData)
        .onConflictDoUpdate({
          target: users.id,
          set: {
            ...userData,
            updatedAt: new Date(),
          },
        })
        .returning();
      return user;
    }
  }

  async updateUserSubscription(userId: string, subscription: {
    subscriptionTier: string;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    subscriptionStatus?: string;
  }): Promise<User> {
    const [user] = await db
      .update(users)
      .set({
        ...subscription,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  async addFavoriteLocation(userId: string, locationQuery: string): Promise<User> {
    const user = await this.getUser(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const favorites = user.favoriteLocations || [];
    if (favorites.includes(locationQuery)) {
      return user; // Already a favorite
    }

    const [updatedUser] = await db
      .update(users)
      .set({
        favoriteLocations: [...favorites, locationQuery],
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return updatedUser;
  }

  async removeFavoriteLocation(userId: string, locationQuery: string): Promise<User> {
    const user = await this.getUser(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const favorites = user.favoriteLocations || [];
    const [updatedUser] = await db
      .update(users)
      .set({
        favoriteLocations: favorites.filter((fav: string) => fav !== locationQuery),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return updatedUser;
  }

  async updateUserStripeInfo(userId: string, stripeInfo: {
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
  }): Promise<User> {
    const [user] = await db
      .update(users)
      .set({
        ...stripeInfo,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  // Stripe data queries - query from stripe schema tables
  async getStripeProduct(productId: string) {
    const result = await db.execute(
      sql`SELECT * FROM stripe.products WHERE id = ${productId}`
    );
    return result.rows[0] || null;
  }

  async listStripeProducts(active = true, limit = 20, offset = 0) {
    const result = await db.execute(
      sql`SELECT * FROM stripe.products WHERE active = ${active} LIMIT ${limit} OFFSET ${offset}`
    );
    return result.rows;
  }

  async listStripeProductsWithPrices(active = true, limit = 20, offset = 0) {
    const result = await db.execute(
      sql`
        WITH paginated_products AS (
          SELECT id, name, description, metadata, active
          FROM stripe.products
          WHERE active = ${active}
            AND name LIKE 'RainVi%'
          ORDER BY id DESC
          LIMIT 1
        )
        SELECT 
          p.id as product_id,
          p.name as product_name,
          p.description as product_description,
          p.active as product_active,
          p.metadata as product_metadata,
          pr.id as price_id,
          pr.unit_amount,
          pr.currency,
          pr.recurring,
          pr.active as price_active,
          pr.metadata as price_metadata
        FROM paginated_products p
        LEFT JOIN stripe.prices pr ON pr.product = p.id AND pr.active = true
        ORDER BY p.id, pr.unit_amount
      `
    );
    return result.rows;
  }

  async getStripePrice(priceId: string) {
    const result = await db.execute(
      sql`SELECT * FROM stripe.prices WHERE id = ${priceId}`
    );
    return result.rows[0] || null;
  }

  async listStripePrices(active = true, limit = 20, offset = 0) {
    const result = await db.execute(
      sql`SELECT * FROM stripe.prices WHERE active = ${active} LIMIT ${limit} OFFSET ${offset}`
    );
    return result.rows;
  }

  async getStripePricesForProduct(productId: string) {
    const result = await db.execute(
      sql`SELECT * FROM stripe.prices WHERE product = ${productId} AND active = true`
    );
    return result.rows;
  }

  async getStripeSubscription(subscriptionId: string) {
    const result = await db.execute(
      sql`SELECT * FROM stripe.subscriptions WHERE id = ${subscriptionId}`
    );
    return result.rows[0] || null;
  }

  async getLocations(): Promise<Location[]> {
    return await db.select().from(locations).orderBy(desc(locations.id));
  }

  async createLocation(insertLocation: InsertLocation): Promise<Location> {
    // Check if exists first to avoid duplicates
    const [existing] = await db
      .select()
      .from(locations)
      .where(eq(locations.query, insertLocation.query))
      .limit(1);

    if (existing) {
      return existing;
    }

    const [location] = await db
      .insert(locations)
      .values(insertLocation)
      .returning();
    return location;
  }

  async searchLocations(query: string): Promise<Location[]> {
    // Simple search for now
    return await db
      .select()
      .from(locations)
      .where(eq(locations.query, query));
  }

  // Promotion code methods
  async createPromotionCode(codeData: InsertPromotionCode): Promise<PromotionCode> {
    const [code] = await db
      .insert(promotionCodes)
      .values(codeData)
      .returning();
    return code;
  }

  async getPromotionCodeByCode(code: string): Promise<PromotionCode | undefined> {
    const [promoCode] = await db
      .select()
      .from(promotionCodes)
      .where(eq(promotionCodes.code, code.toUpperCase()));
    return promoCode;
  }

  async getPromotionCode(id: number): Promise<PromotionCode | undefined> {
    const [code] = await db
      .select()
      .from(promotionCodes)
      .where(eq(promotionCodes.id, id));
    return code;
  }

  async listPromotionCodes(): Promise<PromotionCode[]> {
    return await db
      .select()
      .from(promotionCodes)
      .orderBy(desc(promotionCodes.createdAt));
  }

  async updatePromotionCode(id: number, updates: Partial<InsertPromotionCode>): Promise<PromotionCode> {
    const [code] = await db
      .update(promotionCodes)
      .set(updates)
      .where(eq(promotionCodes.id, id))
      .returning();
    return code;
  }

  async deactivatePromotionCode(id: number): Promise<PromotionCode> {
    const [code] = await db
      .update(promotionCodes)
      .set({ isActive: false })
      .where(eq(promotionCodes.id, id))
      .returning();
    return code;
  }

  async incrementCodeRedemptions(id: number): Promise<PromotionCode> {
    const [code] = await db
      .update(promotionCodes)
      .set({ 
        currentRedemptions: sql`${promotionCodes.currentRedemptions} + 1` 
      })
      .where(eq(promotionCodes.id, id))
      .returning();
    return code;
  }

  // Redemption methods
  async createRedemption(codeId: number, userId: string): Promise<PromotionRedemption> {
    const [redemption] = await db
      .insert(promotionRedemptions)
      .values({ codeId, userId })
      .returning();
    return redemption;
  }

  async getUserRedemptionForCode(userId: string, codeId: number): Promise<PromotionRedemption | undefined> {
    const [redemption] = await db
      .select()
      .from(promotionRedemptions)
      .where(and(
        eq(promotionRedemptions.userId, userId),
        eq(promotionRedemptions.codeId, codeId)
      ));
    return redemption;
  }

  async getRedemptionsForCode(codeId: number): Promise<PromotionRedemption[]> {
    return await db
      .select()
      .from(promotionRedemptions)
      .where(eq(promotionRedemptions.codeId, codeId));
  }

  // Grant premium access
  async grantPremiumAccess(userId: string, untilDate: Date): Promise<User> {
    const [user] = await db
      .update(users)
      .set({
        premiumAccessUntil: untilDate,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }
}

export const storage = new DatabaseStorage();
