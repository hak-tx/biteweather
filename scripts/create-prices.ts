import { getUncachableStripeClient } from '../server/stripeClient';

async function createPrices() {
  const stripe = await getUncachableStripeClient();
  
  const productId = 'prod_TU1mTXqH5KgE0z';

  // Check if prices already exist
  const existingPrices = await stripe.prices.list({ product: productId });
  
  if (existingPrices.data.length > 0) {
    console.log('Prices already exist for this product:');
    existingPrices.data.forEach(price => {
      console.log(`  ${price.id} - ${price.recurring?.interval} - $${(price.unit_amount || 0) / 100}`);
    });
    return;
  }

  console.log('Creating prices for product:', productId);

  // Create monthly price ($1/month)
  const monthlyPrice = await stripe.prices.create({
    product: productId,
    unit_amount: 100, // $1.00 in cents
    currency: 'usd',
    recurring: { interval: 'month' },
    nickname: 'Monthly',
  });

  console.log('Created monthly price:', monthlyPrice.id, '$1/month');

  // Create annual price ($10/year)
  const annualPrice = await stripe.prices.create({
    product: productId,
    unit_amount: 1000, // $10.00 in cents
    currency: 'usd',
    recurring: { interval: 'year' },
    nickname: 'Annual',
  });

  console.log('Created annual price:', annualPrice.id, '$10/year');
  console.log('\nPrices created successfully!');
}

createPrices().catch(console.error);
