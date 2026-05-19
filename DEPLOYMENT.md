# BiteWeather Deployment Guide

## Deploying to Production

### Stripe Configuration

BiteWeather requires Stripe API keys to handle subscription payments. There are two ways to configure Stripe for production:

#### Option 1: Environment Variables (Recommended for Production)

1. **Get your Stripe Live API keys**:
   - Go to [Stripe Dashboard](https://dashboard.stripe.com/)
   - Switch to **Live mode** (toggle in top right)
   - Navigate to **Developers** > **API keys**
   - Copy your **Publishable key** and **Secret key**

2. **Add keys to Replit Secrets**:
   - In your Repl, go to the **Tools** panel
   - Click on **Secrets**
   - Add two secrets:
     - `STRIPE_PUBLISHABLE_KEY`: Your live publishable key (starts with `pk_live_`)
     - `STRIPE_SECRET_KEY`: Your live secret key (starts with `sk_live_`)

3. **Publish your app**:
   - Click the **Publish** button
   - Your app will now use the Stripe keys from secrets

#### Option 2: Replit Connectors (For Development)

The Stripe connector is already configured for development with test keys. This is great for testing but not suitable for production.

### Important Notes

- **Never commit API keys to your repository**
- **Use test keys** (pk_test_*, sk_test_*) for development
- **Use live keys** (pk_live_*, sk_live_*) for production
- The app automatically detects whether it's running in development or production and uses the appropriate keys

### Weather API Configuration

BiteWeather uses Visual Crossing for weather data and geocoding:

1. **Get a Visual Crossing API key**:
   - Go to [Visual Crossing](https://www.visualcrossing.com/)
   - Create a free account (1,000 free requests/day)
   - Copy your API key

2. **Add to Replit Secrets**:
   - Add `VISUAL_CROSSING_API_KEY`: Your Visual Crossing API key

### Database

The PostgreSQL database is automatically provisioned by Replit. No additional configuration needed.

### Authentication

Direct Google OAuth is configured. For production, ensure you have:
- `GOOGLE_CLIENT_ID`: Your Google OAuth client ID
- `GOOGLE_CLIENT_SECRET`: Your Google OAuth client secret

### Webhooks

Stripe webhooks are automatically managed by `stripe-replit-sync` and will work in both environments.

## Troubleshooting

### "Stripe credentials not found" error

**Solution**: Add `STRIPE_PUBLISHABLE_KEY` and `STRIPE_SECRET_KEY` to your production secrets.

### "No Stripe connection in Connectors" error (Development)

**Solution**: The Stripe connector should already be configured. If not, add it from the Connectors pane.

### Application crashes on startup

**Cause**: Missing Stripe credentials  
**Solution**: Follow Option 1 above to add Stripe keys as environment variables.

### Weather data showing "simulated" or mock data

**Cause**: Missing Visual Crossing API key
**Solution**: Add `VISUAL_CROSSING_API_KEY` to your secrets

## Post-Deployment Checklist

- [ ] Add Stripe live API keys to production secrets
- [ ] Add Visual Crossing API key to secrets
- [ ] Test user signup/login flow
- [ ] Test subscription purchase ($1/month or $10/year)
- [ ] Verify webhook events are being processed
- [ ] Test premium features (15-day forecast, multiple metrics)
- [ ] Monitor Stripe dashboard for successful payments
- [ ] Test weather data is loading from real API (not mock)
