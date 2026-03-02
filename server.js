const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

const app = express();

// TODO: move these into environment variables in real code
const GOOGLE_CLIENT_ID = ${{ secrets.googleid }};
const GOOGLE_CLIENT_SECRET = ${{ secrets.google }};

passport.use(
  new GoogleStrategy(
    {
      clientID: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      callbackURL: '/auth/google/callback', // must match redirect URI path
    },
    (accessToken, refreshToken, profile, done) => {
      // Here you would find-or-create the user in your DB
      // For demo, just pass profile along
      return done(null, profile);
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user);
});
passport.deserializeUser((obj, done) => {
  done(null, obj);
});

app.use(
  session({
    secret: ${{ secrets.google }},
    resave: false,
    saveUninitialized: false,
  })
);
app.use(passport.initialize());
app.use(passport.session());

// Step 1: user clicks "Continue with Google" → redirect to Google
app.get(
  '/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

// Step 2: Google redirects back here
app.get(
  '/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login.html' }),
  (req, res) => {
    // Successful auth; redirect to your app's main page or dashboard
    res.redirect('/dashboard');
  }
);

app.get('/dashboard', (req, res) => {
  if (!req.user) return res.redirect('/login.html');
  res.send(`Hello, ${req.user.displayName}`);
});

// Serve static files (login.html, epslogo.svg, etc.) from the current folder
const path = require('path');
app.use(express.static(path.join(__dirname)));

app.listen(3000, () => console.log('Server running on http://localhost:3000'));