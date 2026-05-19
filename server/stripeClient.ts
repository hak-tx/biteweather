import Stripe from 'stripe';

let connectionSettings: any;

async function getCredentials() {
  // First, try environment variables (for production deployments or manual configuration)
  const envPublishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
  const envSecretKey = process.env.STRIPE_SECRET_KEY;
  
  if (envPublishableKey && envSecretKey) {
    console.log('Using Stripe keys from environment variables');
    return {
      publishableKey: envPublishableKey,
      secretKey: envSecretKey,
    };
  }

  // Fall back to Replit Connectors (for development)
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? 'depl ' + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken) {
    throw new Error(
      'Stripe credentials not found. Please either:\n' +
      '1. Add STRIPE_PUBLISHABLE_KEY and STRIPE_SECRET_KEY to your production secrets, OR\n' +
      '2. Configure a Stripe connector in the Connectors pane'
    );
  }

  const connectorName = 'stripe';
  const isProduction = process.env.REPLIT_DEPLOYMENT === '1';
  const targetEnvironment = isProduction ? 'production' : 'development';

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set('include_secrets', 'true');
  url.searchParams.set('connector_names', connectorName);
  url.searchParams.set('environment', targetEnvironment);

  const response = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      'X_REPLIT_TOKEN': xReplitToken
    }
  });

  const data = await response.json();
  
  connectionSettings = data.items?.[0];

  if (!connectionSettings || (!connectionSettings.settings.publishable || !connectionSettings.settings.secret)) {
    throw new Error(
      `Stripe ${targetEnvironment} connection not found in Connectors.\n` +
      'For production deployments, add STRIPE_PUBLISHABLE_KEY and STRIPE_SECRET_KEY to your secrets.\n' +
      'Get your live keys from Stripe Dashboard: Developers > API keys'
    );
  }

  console.log(`Using Stripe keys from ${targetEnvironment} connector`);
  return {
    publishableKey: connectionSettings.settings.publishable,
    secretKey: connectionSettings.settings.secret,
  };
}

export async function getUncachableStripeClient() {
  const { secretKey } = await getCredentials();

  return new Stripe(secretKey, {
    apiVersion: '2025-11-17.clover',
  });
}

export async function getStripePublishableKey() {
  const { publishableKey } = await getCredentials();
  return publishableKey;
}

export async function getStripeSecretKey() {
  const { secretKey } = await getCredentials();
  return secretKey;
}

let stripeSync: any = null;

export async function getStripeSync() {
  if (!stripeSync) {
    const { StripeSync } = await import('stripe-replit-sync');
    const secretKey = await getStripeSecretKey();

    stripeSync = new StripeSync({
      poolConfig: {
        connectionString: process.env.DATABASE_URL!,
        max: 2,
      },
      stripeSecretKey: secretKey,
    });
  }
  return stripeSync;
}
