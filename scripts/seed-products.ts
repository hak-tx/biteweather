import { getUncachableStripeClient } from '../server/stripeClient';

async function createProducts() {
  const stripe = await getUncachableStripeClient();

  // Check if products already exist
  const existingProducts = await stripe.products.search({ 
    query: "name:'BiteWeather Pro'" 
  });

  if (existingProducts.data.length > 0) {
    console.log('Products already exist, skipping creation');
    const product = existingProducts.data[0];
    const prices = await stripe.prices.list({ product: product.id });
    console.log('Existing product:', product.id);
    prices.data.forEach(price => {
      console.log(`  Price: ${price.id} - ${price.recurring?.interval} - $${(price.unit_amount || 0) / 100}`);
    });
    return;
  }

  // Create BiteWeather Pro product
  const product = await stripe.products.create({
    name: 'BiteWeather Pro',
    description: 'Full access to solunar times, extended forecasts, and fishing analytics',
  });

  console.log('Created product:', product.id);

  // Create monthly price ($1/month)
  const monthlyPrice = await stripe.prices.create({
    product: product.id,
    unit_amount: 100, // $1.00 in cents
    currency: 'usd',
    recurring: { interval: 'month' },
    nickname: 'Monthly',
  });

  console.log('Created monthly price:', monthlyPrice.id, '$1/month');

  // Create annual price ($10/year)
  const annualPrice = await stripe.prices.create({
    product: product.id,
    unit_amount: 1000, // $10.00 in cents
    currency: 'usd',
    recurring: { interval: 'year' },
    nickname: 'Annual',
  });

  console.log('Created annual price:', annualPrice.id, '$10/year');
  console.log('\nProducts created successfully! Webhooks will sync them to the database.');
}

createProducts().catch(console.error);
