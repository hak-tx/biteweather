import { storage } from './storage';
import { getUncachableStripeClient } from './stripeClient';

export class StripeService {
  async createCustomer(email: string, userId: string) {
    const stripe = await getUncachableStripeClient();
    return await stripe.customers.create({
      email,
      metadata: { userId },
    });
  }

  async createCheckoutSession(customerId: string, priceId: string, userId: string, successUrl: string, cancelUrl: string) {
    const stripe = await getUncachableStripeClient();
    return await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: userId,
      subscription_data: {
        metadata: {
          userId: userId
        }
      }
    });
  }

  async createCustomerPortalSession(customerId: string, returnUrl: string) {
    const stripe = await getUncachableStripeClient();
    return await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
  }

  async getProduct(productId: string) {
    return await storage.getStripeProduct(productId);
  }

  async getSubscription(subscriptionId: string) {
    return await storage.getStripeSubscription(subscriptionId);
  }

  async createCoupon(percentOff: number, code: string) {
    const stripe = await getUncachableStripeClient();
    const coupon = await stripe.coupons.create({
      percent_off: percentOff,
      duration: 'once',
      name: `${percentOff}% off - ${code}`,
    });
    
    // Create a promotion code linked to this coupon so users can enter the code at checkout
    // The 'coupon' parameter is the coupon ID string
    const promoCode = await stripe.promotionCodes.create({
      coupon: coupon.id,
      code: code,
    } as any); // Type assertion needed due to Stripe types version mismatch
    
    return coupon;
  }
}

export const stripeService = new StripeService();
