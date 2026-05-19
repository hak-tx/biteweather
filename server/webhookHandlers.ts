import { getStripeSync } from './stripeClient';
import { getUncachableStripeClient } from './stripeClient';
import { storage } from './storage';

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string, uuid: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
        'Received type: ' + typeof payload + '. ' +
        'This usually means express.json() parsed the body before reaching this handler. ' +
        'FIX: Ensure webhook route is registered BEFORE app.use(express.json()).'
      );
    }

    const sync = await getStripeSync();
    const stripe = await getUncachableStripeClient();
    const secret = await sync.getWebhookSecret(uuid);
    const event = stripe.webhooks.constructEvent(payload, signature, secret);

    console.log(`[Webhook] Processing event: ${event.type} (${event.id})`);

    // Process the webhook with Stripe sync, handling expected errors gracefully
    try {
      await sync.processWebhook(payload, signature, uuid);
    } catch (error: any) {
      // Handle expected errors from Stripe sync (e.g., missing customers, resources)
      if (error.type === 'StripeInvalidRequestError' && error.code === 'resource_missing') {
        console.warn(`[Webhook] Stripe sync skipped for ${event.type}: ${error.message}`);
        // Continue processing the event for our own business logic
      } else {
        // Log unexpected errors but don't throw to prevent webhook retries
        console.error(`[Webhook] Stripe sync error for ${event.type}:`, error.message);
      }
    }

    // Handle subscription events to update user tier
    try {
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object as any;
        if (session.mode === 'subscription' && session.subscription) {
          const userId = session.client_reference_id;
          
          if (userId) {
            const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
            await storage.updateUserSubscription(userId, {
              subscriptionTier: 'premium',
              stripeSubscriptionId: subscription.id,
              subscriptionStatus: subscription.status,
              stripeCustomerId: subscription.customer as string
            });
            console.log(`[Webhook] Updated user ${userId} to premium tier`);
          }
        }
      } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
        const subscription = event.data.object as any;
        const userId = subscription.metadata?.userId;

        if (userId) {
          const tier = subscription.status === 'active' ? 'premium' : 'free';
          await storage.updateUserSubscription(userId, {
            subscriptionTier: tier,
            stripeSubscriptionId: subscription.id,
            subscriptionStatus: subscription.status
          });
          console.log(`[Webhook] Updated user ${userId} subscription status: ${subscription.status}, tier: ${tier}`);
        }
      }
    } catch (error: any) {
      // Log business logic errors but don't throw to prevent webhook retries
      console.error(`[Webhook] Business logic error for ${event.type}:`, error.message);
    }

    console.log(`[Webhook] Completed processing: ${event.type}`);
  }
}
