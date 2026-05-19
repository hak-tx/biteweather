import { getUncachableStripeClient } from '../server/stripeClient';

async function updatePrices() {
  const stripe = await getUncachableStripeClient();

  // Find the BiteWeather Pro product
  const products = await stripe.products.search({ 
    query: "name:'BiteWeather Pro'" 
  });

  if (products.data.length === 0) {
    console.log('BiteWeather Pro product not found, creating new one...');
    
    const product = await stripe.products.create({
      name: 'BiteWeather Pro',
      description: 'Full access to solunar times, extended forecasts, and fishing analytics',
    });

    // Create new prices
    const monthlyPrice = await stripe.prices.create({
      product: product.id,
      unit_amount: 500, // $5.00 in cents
      currency: 'usd',
      recurring: { interval: 'month' },
      nickname: 'Monthly $5',
    });

    const annualPrice = await stripe.prices.create({
      product: product.id,
      unit_amount: 5000, // $50.00 in cents
      currency: 'usd',
      recurring: { interval: 'year' },
      nickname: 'Annual $50',
    });

    console.log('Created product:', product.id);
    console.log('Created monthly price:', monthlyPrice.id, '$5/month');
    console.log('Created annual price:', annualPrice.id, '$50/year');
    return;
  }

  const product = products.data[0];
  console.log('Found product:', product.id, product.name);

  // List existing prices
  const existingPrices = await stripe.prices.list({ product: product.id, active: true });
  console.log('\nExisting prices:');
  existingPrices.data.forEach(price => {
    console.log(`  ${price.id} - ${price.recurring?.interval} - $${(price.unit_amount || 0) / 100}`);
  });

  // Archive old prices
  console.log('\nArchiving old prices...');
  for (const price of existingPrices.data) {
    await stripe.prices.update(price.id, { active: false });
    console.log(`  Archived: ${price.id}`);
  }

  // Create new prices at $5/month and $50/year
  console.log('\nCreating new prices...');
  
  const monthlyPrice = await stripe.prices.create({
    product: product.id,
    unit_amount: 500, // $5.00 in cents
    currency: 'usd',
    recurring: { interval: 'month' },
    nickname: 'Monthly $5',
  });

  console.log('Created monthly price:', monthlyPrice.id, '$5/month');

  const annualPrice = await stripe.prices.create({
    product: product.id,
    unit_amount: 5000, // $50.00 in cents
    currency: 'usd',
    recurring: { interval: 'year' },
    nickname: 'Annual $50',
  });

  console.log('Created annual price:', annualPrice.id, '$50/year');
  console.log('\nPrices updated successfully! Webhooks will sync them to the database.');
}

updatePrices().catch(console.error);
