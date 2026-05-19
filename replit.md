# BiteWeather - Fishing Weather Forecast

## Overview

BiteWeather is a freemium fishing weather forecast application designed to assist anglers in planning optimal fishing trips. It provides essential data such as solunar feeding times, tide predictions, moon phases, and detailed weather forecasts. The application features interactive charts, hourly and multi-day predictions, and is optimized for fishing-specific insights. The project aims to offer a robust tool for anglers, combining comprehensive meteorological and astronomical data with a user-friendly interface.

**Freemium Model:**
- Free users: Access to a 5-day forecast and single metric views.
- Premium users: Full 15-day forecasts, multiple metric overlays, and unlimited favorite locations for a monthly or annual subscription fee.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

The frontend is a React single-page application built with TypeScript and Vite. It uses Wouter for routing, shadcn/ui (Radix UI primitives) for UI components, and Tailwind CSS for styling. State management is handled by TanStack Query (React Query). Key design principles include a component-based structure, path aliases for organized imports, and custom hooks for common functionalities.

### Backend Architecture

The backend is an Express.js REST API. It features middleware for request processing, JSON handling, and custom logging. It integrates with Vite for development. Routing is centralized, handling data fetching from external weather APIs and normalizing weather conditions using an icon mapping system. Canonical weather data structures are defined for consistent API responses.

**Server-Side Caching:** NodeCache is used to prevent API rate limiting. Cache keys include normalized location names and rounded coordinates (2 decimal places for ~1km precision) to prevent cross-location data contamination. Fishing forecast data is cached for 1 hour, moon phases for 24 hours. All caching uses a single NodeCache instance with structured hit/miss/set logging for monitoring and debugging.

### Database Layer

The application uses PostgreSQL with Drizzle ORM, adopting a schema-first approach with TypeScript type generation. Neon Database provides serverless PostgreSQL with WebSocket support. The schema includes tables for `users` (with subscription and favorite location data), `sessions` (for authentication), `locations` (for search analytics), and Stripe-related tables managed by `stripe-replit-sync`. A repository pattern (`IStorage` interface with `DatabaseStorage` implementation) abstracts database operations.

### Key Architectural Patterns

- **Repository Pattern:** For data access abstraction.
- **Adapter Pattern:** For integrating multiple weather APIs.
- **Component Composition:** Utilizing shadcn/ui.
- **Custom Hooks:** For cross-cutting concerns like authentication, mobile detection, and debouncing.
- **Type-Safe API Contracts:** Using shared TypeScript types.
- **Webhook Processing:** For Stripe subscription events.
- **Freemium Gating:** With visual upgrade prompts.

### Authentication Flow

Authentication supports direct Google OAuth (via `passport-google-oauth20`) and email/password sign-up/login (using bcrypt for password hashing). Session management uses PostgreSQL storage. Protected routes are secured with `isAuthenticated` middleware, and user context is accessible via a frontend `useAuth()` hook.

### Subscription Flow

Stripe is integrated for subscription management, with products defined via the Stripe API. Checkout sessions redirect to Stripe, and webhooks automatically sync subscription statuses to the database. `stripe-replit-sync` manages Stripe data within PostgreSQL, and customers can manage subscriptions via a customer portal.

## External Dependencies

-   **Weather Data Providers:** Visual Crossing API (for forecasts and geocoding), NOAA NWS API (for US weather data).
-   **Mapping Services:** Leaflet (for interactive maps), Radar tile layers (from RainViewer and/or Tomorrow.io), CartoDB (for base map tiles).
-   **Database Service:** Neon Database (serverless PostgreSQL).
-   **UI Component Library:** Radix UI primitives, Lucide React (for icons), Tailwind CSS.
-   **Fonts:** Google Fonts (Outfit, JetBrains Mono).
-   **Authentication:** `passport-google-oauth20`, `bcrypt`.
-   **Payments:** Stripe.
-   **Astronomical Data:** `suncalc3` library for precise astronomical calculations.
-   **Tide Data:** NOAA Tides & Currents API for tide predictions and station datums. Tidal coefficients are calculated using actual local tide amplitudes (high - low) normalized against the station's reference range (MSR or MN × 1.60), matching European systems like Nautide.