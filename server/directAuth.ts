import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as LocalStrategy } from "passport-local";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import bcrypt from "bcrypt";
import { storage } from "./storage.js";

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  
  const isProduction = process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1';
  const customDomain = process.env.CUSTOM_DOMAIN;
  
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: sessionTtl,
      // Set domain for custom domains to ensure cookies work
      ...(customDomain && isProduction ? { domain: customDomain } : {}),
    },
  });
}

async function upsertUser(profile: any, provider: string) {
  const email = profile.emails?.[0]?.value || profile.email;
  const firstName = profile.name?.givenName || profile.first_name || profile.name?.firstName;
  const lastName = profile.name?.familyName || profile.last_name || profile.name?.lastName;
  const profileImageUrl = profile.photos?.[0]?.value || profile.profile_image_url;

  await storage.upsertUser({
    id: `${provider}:${profile.id}`,
    email: email,
    firstName: firstName,
    lastName: lastName,
    profileImageUrl: profileImageUrl,
  });

  return {
    id: `${provider}:${profile.id}`,
    email,
    firstName,
    lastName,
    profileImageUrl,
  };
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  // Use custom domain if set, otherwise fall back to Replit domain
  const baseUrl = process.env.CUSTOM_DOMAIN
    ? `https://${process.env.CUSTOM_DOMAIN}`
    : process.env.REPLIT_DOMAINS
      ? `https://${process.env.REPLIT_DOMAINS.split(',')[0]}`
      : `http://localhost:${process.env.PORT || 5000}`;

  // Google OAuth Strategy
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          callbackURL: `${baseUrl}/api/auth/google/callback`,
          scope: ['profile', 'email'],
        },
        async (accessToken, refreshToken, profile, done) => {
          try {
            const user = await upsertUser(profile, 'google');
            done(null, user);
          } catch (error) {
            done(error);
          }
        }
      )
    );
  }

  // Local (Email/Password) Strategy
  passport.use(
    new LocalStrategy(
      { usernameField: 'email', passwordField: 'password' },
      async (email, password, done) => {
        try {
          const user = await storage.getUserByEmail(email);
          if (!user) {
            return done(null, false, { message: 'Invalid email or password' });
          }
          if (!user.password) {
            return done(null, false, { message: 'This account uses Google login. Please sign in with Google.' });
          }
          const isValid = await bcrypt.compare(password, user.password);
          if (!isValid) {
            return done(null, false, { message: 'Invalid email or password' });
          }
          return done(null, {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            profileImageUrl: user.profileImageUrl,
          });
        } catch (error) {
          return done(error);
        }
      }
    )
  );


  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  const hasGoogleAuth = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

  // Google auth routes - only register if credentials are available
  if (hasGoogleAuth) {
    app.get('/api/auth/google',
      passport.authenticate('google', { scope: ['profile', 'email'] })
    );

    app.get('/api/auth/google/callback',
      passport.authenticate('google', {
        successRedirect: '/',
        failureRedirect: '/login',
      })
    );
  }

  // Legacy login route that redirects based on provider
  app.get("/api/login", (req, res) => {
    const provider = req.query.provider as string;
    
    if (provider === 'google') {
      if (!hasGoogleAuth) {
        return res.status(500).json({ 
          error: 'Google authentication is not configured. Please add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your secrets.' 
        });
      }
      return res.redirect('/api/auth/google');
    } else {
      return res.redirect('/login');
    }
  });

  // Email/Password Registration
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { email, password, firstName, lastName } = req.body;
      
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }
      
      if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
      }
      
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ error: 'An account with this email already exists' });
      }
      
      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await storage.createUserWithPassword(email, hashedPassword, firstName, lastName);
      
      const sessionUser = {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl,
      };
      
      req.login(sessionUser, (err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to create session' });
        }
        return res.json({ success: true, user: sessionUser });
      });
    } catch (error: any) {
      console.error('Registration error:', error);
      return res.status(500).json({ error: 'Failed to create account' });
    }
  });

  // Email/Password Login
  app.post("/api/auth/login", (req, res, next) => {
    passport.authenticate('local', (err: any, user: any, info: any) => {
      if (err) {
        return res.status(500).json({ error: 'Authentication failed' });
      }
      if (!user) {
        return res.status(401).json({ error: info?.message || 'Invalid email or password' });
      }
      req.login(user, (err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to create session' });
        }
        return res.json({ success: true, user });
      });
    })(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect('/');
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  return next();
};

export const optionalAuth: RequestHandler = async (req, res, next) => {
  return next();
};
