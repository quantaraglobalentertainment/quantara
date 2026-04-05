/**
 * ============================================================
 * QUANTARA — Quantum Hybrid AGI Platform
 * Backend Server v1.0.0
 * Node.js + Express + Claude AGI Integration
 * Built for: Auckland, NZ → Global Expansion
 * ============================================================
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Anthropic = require('@anthropic-ai/sdk');
const Stripe = require('stripe');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3001;

// ── CLIENTS ──────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ── MIDDLEWARE ────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// ── IN-MEMORY STORE (Replace with PostgreSQL/MongoDB in prod) ─
const db = {
  users: [],
  events: [],
  tickets: [],
  communities: [
    { id: 'telugu-nz', name: 'Telugu Association NZ', city: 'Auckland', size: 28000, language: 'Telugu' },
    { id: 'malayalam-nz', name: 'Kerala Community NZ', city: 'Auckland', size: 22000, language: 'Malayalam' },
    { id: 'punjabi-nz', name: 'Punjabi Society NZ', city: 'Auckland', size: 35000, language: 'Punjabi' },
    { id: 'gujarati-nz', name: 'Gujarati Association NZ', city: 'Auckland', size: 18000, language: 'Gujarati' },
    { id: 'tamil-nz', name: 'Tamil Cultural Society NZ', city: 'Auckland', size: 15000, language: 'Tamil' },
  ],
  celebrities: [
    { id: 'c1', name: 'Prabhas', language: 'Telugu', tier: 'A', fee_usd: 250000, fanBase: 95 },
    { id: 'c2', name: 'Mohanlal', language: 'Malayalam', tier: 'A', fee_usd: 180000, fanBase: 92 },
    { id: 'c3', name: 'Diljit Dosanjh', language: 'Punjabi', tier: 'A', fee_usd: 200000, fanBase: 90 },
    { id: 'c4', name: 'Allu Arjun', language: 'Telugu', tier: 'A', fee_usd: 300000, fanBase: 98 },
    { id: 'c5', name: 'Mammootty', language: 'Malayalam', tier: 'A', fee_usd: 160000, fanBase: 89 },
    { id: 'c6', name: 'Rashmika Mandanna', language: 'Telugu', tier: 'B', fee_usd: 80000, fanBase: 85 },
    { id: 'c7', name: 'Prithviraj', language: 'Malayalam', tier: 'B', fee_usd: 70000, fanBase: 80 },
    { id: 'c8', name: 'Harrdy Sandhu', language: 'Punjabi', tier: 'B', fee_usd: 50000, fanBase: 75 },
  ],
  markets: [
    { city: 'Auckland', country: 'NZ', indianPop: 175794, avgTicket: 85, currency: 'NZD' },
    { city: 'Sydney', country: 'AU', indianPop: 420000, avgTicket: 95, currency: 'AUD' },
    { city: 'Melbourne', country: 'AU', indianPop: 310000, avgTicket: 90, currency: 'AUD' },
    { city: 'Suva', country: 'FJ', indianPop: 185000, avgTicket: 45, currency: 'FJD' },
    { city: 'Dubai', country: 'UAE', indianPop: 3500000, avgTicket: 150, currency: 'AED' },
    { city: 'London', country: 'UK', indianPop: 800000, avgTicket: 120, currency: 'GBP' },
    { city: 'Toronto', country: 'CA', indianPop: 650000, avgTicket: 110, currency: 'CAD' },
    { city: 'Singapore', country: 'SG', indianPop: 360000, avgTicket: 100, currency: 'SGD' },
  ]
};

// ══════════════════════════════════════════════════════════════
// AUTH ROUTES
// ══════════════════════════════════════════════════════════════

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, company, city } = req.body;
    if (db.users.find(u => u.email === email))
      return res.status(400).json({ error: 'Email already registered' });
    const hashed = await bcrypt.hash(password, 12);
    const user = { id: uuidv4(), name, email, password: hashed, company, city, plan: 'starter', createdAt: new Date() };
    db.users.push(user);
    const token = jwt.sign({ id: user.id, email }, process.env.JWT_SECRET || 'quantara-secret-2026', { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name, email, company, city, plan: user.plan } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = db.users.find(u => u.email === email);
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, email }, process.env.JWT_SECRET || 'quantara-secret-2026', { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email, company: user.company, plan: user.plan } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auth Middleware
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'quantara-secret-2026');
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ══════════════════════════════════════════════════════════════
// AGI INTELLIGENCE ROUTES (Claude-powered)
// ══════════════════════════════════════════════════════════════

/**
 * CELEBRITY ORACLE
 * Predicts which celebrity will sell best in a given city/community
 */
app.post('/api/agi/celebrity-oracle', auth, async (req, res) => {
  try {
    const { city, community, budget_nzd, eventDate, venueSizeSeats } = req.body;
    const market = db.markets.find(m => m.city === city) || db.markets[0];
    const availableCelebs = db.celebrities.filter(c => c.fee_usd * 1.65 <= budget_nzd);

    const prompt = `You are QUANTARA's Celebrity Oracle — an AI specialized in the Indian diaspora entertainment industry.

Context:
- City: ${city}, ${market.country}
- Indian population: ${market.indianPop.toLocaleString()}
- Target community: ${community}
- Event budget: NZD $${budget_nzd.toLocaleString()}
- Venue capacity: ${venueSizeSeats} seats
- Event date: ${eventDate}
- Average ticket price in this market: ${market.currency} $${market.avgTicket}
- Available celebrities within budget: ${JSON.stringify(availableCelebs.map(c => ({ name: c.name, language: c.language, tier: c.tier, fee_usd: c.fee_usd, fanBase: c.fanBase })))}

Analyze and respond ONLY with a JSON object:
{
  "topPick": { "name": "...", "reason": "...", "predictedSellThrough": 85, "projectedRevenue": 150000, "projectedProfit": 45000, "riskLevel": "Medium" },
  "alternatives": [{ "name": "...", "reason": "...", "predictedSellThrough": 70 }],
  "marketInsight": "...",
  "bestMonth": "...",
  "sponsorTip": "...",
  "warningFlags": ["..."]
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0].text.replace(/```json|```/g, '').trim();
    const analysis = JSON.parse(text);
    res.json({ success: true, analysis, market, availableCelebs: availableCelebs.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * EVENT PROFIT PREDICTOR
 * Full P&L forecast before committing to an event
 */
app.post('/api/agi/profit-predictor', auth, async (req, res) => {
  try {
    const { city, celebrity, venueCapacity, ticketPrice, celebrityFee, venueCost, marketingBudget } = req.body;
    const market = db.markets.find(m => m.city === city) || db.markets[0];

    const prompt = `You are QUANTARA's Revenue Cortex — an expert event financial analyst for Indian diaspora events.

Event Parameters:
- City: ${city}
- Celebrity: ${celebrity}
- Venue capacity: ${venueCapacity} seats
- Average ticket price: ${market.currency} $${ticketPrice}
- Celebrity fee: NZD $${celebrityFee}
- Venue cost: NZD $${venueCost}
- Marketing budget: NZD $${marketingBudget}
- Local Indian population: ${market.indianPop.toLocaleString()}
- Historical sell-through for this market: 65-85%

Provide a detailed financial forecast. Respond ONLY with JSON:
{
  "scenarios": {
    "conservative": { "sellThrough": 60, "ticketRevenue": 0, "vipRevenue": 0, "sponsorRevenue": 0, "totalRevenue": 0, "totalCosts": 0, "netProfit": 0, "roi": 0 },
    "realistic": { "sellThrough": 75, "ticketRevenue": 0, "vipRevenue": 0, "sponsorRevenue": 0, "totalRevenue": 0, "totalCosts": 0, "netProfit": 0, "roi": 0 },
    "optimistic": { "sellThrough": 90, "ticketRevenue": 0, "vipRevenue": 0, "sponsorRevenue": 0, "totalRevenue": 0, "totalCosts": 0, "netProfit": 0, "roi": 0 }
  },
  "breakEvenTickets": 0,
  "breakEvenPercent": 0,
  "costBreakdown": { "celebrity": ${celebrityFee}, "venue": ${venueCost}, "marketing": ${marketingBudget}, "production": 0, "logistics": 0, "staffing": 0, "contingency": 0 },
  "pricingRecommendation": "...",
  "topRevenueBooster": "...",
  "cashFlowWarning": "...",
  "verdict": "GO" or "NO-GO" or "CONDITIONAL"
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0].text.replace(/```json|```/g, '').trim();
    res.json({ success: true, forecast: JSON.parse(text), currency: market.currency });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * TOUR OPTIMIZER
 * Quantum routing for multi-city celebrity tours
 */
app.post('/api/agi/tour-optimizer', auth, async (req, res) => {
  try {
    const { celebrity, cities, startDate, budget } = req.body;
    const celebData = db.celebrities.find(c => c.name === celebrity);
    const marketData = cities.map(c => db.markets.find(m => m.city === c)).filter(Boolean);

    const prompt = `You are QUANTARA's Tour Optimizer — a quantum routing intelligence for Indian celebrity tours.

Tour Brief:
- Celebrity: ${celebrity} (Fee: USD $${celebData?.fee_usd || 80000}, Fan base score: ${celebData?.fanBase || 75}/100)
- Cities requested: ${cities.join(', ')}
- Start date: ${startDate}
- Total budget: NZD $${budget.toLocaleString()}
- Market data: ${JSON.stringify(marketData)}

Design the optimal tour. Respond ONLY with JSON:
{
  "optimalRoute": ["City1", "City2", "..."],
  "totalDays": 0,
  "legs": [
    { "from": "...", "to": "...", "flightHours": 0, "estimatedFlightCost": 0, "eventDate": "...", "projectedAttendance": 0, "projectedRevenue": 0 }
  ],
  "sharedCosts": { "totalFlights": 0, "accommodation": 0, "security": 0, "management": 0 },
  "perCityBreakdown": [{ "city": "...", "revenue": 0, "costs": 0, "profit": 0 }],
  "totalTourRevenue": 0,
  "totalTourCosts": 0,
  "totalTourProfit": 0,
  "savingsVsSeparateBookings": 0,
  "topTip": "...",
  "riskFactors": ["..."]
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0].text.replace(/```json|```/g, '').trim();
    res.json({ success: true, tourPlan: JSON.parse(text) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * SPONSOR MATCHER
 * AI finds perfect sponsors for each event
 */
app.post('/api/agi/sponsor-match', auth, async (req, res) => {
  try {
    const { city, community, eventType, expectedAttendance, ticketPrice } = req.body;

    const prompt = `You are QUANTARA's Sponsor Matrix — an AI that matches Indian diaspora events with ideal sponsors.

Event Profile:
- City: ${city}
- Target community: ${community}
- Event type: ${eventType}
- Expected attendance: ${expectedAttendance}
- Average ticket price: $${ticketPrice}
- Audience: Indian diaspora professionals and families

Generate specific, realistic sponsor matches. Respond ONLY with JSON:
{
  "sponsorCategories": [
    {
      "category": "...",
      "whyPerfect": "...",
      "exampleBrands": ["...", "..."],
      "proposedPackageValue": 0,
      "packageName": "...",
      "whatTheyGet": ["...", "..."],
      "approachScript": "..."
    }
  ],
  "totalSponsorRevenuePotential": 0,
  "topTarget": "...",
  "pitchTiming": "...",
  "negotiationTip": "..."
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0].text.replace(/```json|```/g, '').trim();
    res.json({ success: true, sponsorPlan: JSON.parse(text) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * QUANTARA MIND — General AGI Chat
 * Full conversational intelligence for event planning
 */
app.post('/api/agi/mind', auth, async (req, res) => {
  try {
    const { message, context } = req.body;

    const systemPrompt = `You are QUANTARA MIND — the world's most advanced AGI for the Indian diaspora event industry.

Your expertise covers:
- Indian diaspora communities globally (Telugu, Malayalam, Punjabi, Gujarati, Tamil, Hindi)
- Celebrity booking and negotiation in Bollywood, Tollywood, Mollywood, Kollywood
- Event management in Auckland NZ, Australia, Fiji, Dubai, UK, Canada, USA, Singapore
- Ticket pricing, dynamic revenue strategies, VIP package design
- Community organization partnerships and fan club activations
- Sponsorship acquisition from Indian businesses globally
- Multi-city tour routing and cost optimization
- Cultural calendars (Diwali, Onam, Ugadi, Sankranti, Navratri, etc.)
- New Zealand business regulations and event permits

The user is building QUANTARA Global Entertainment from Auckland, NZ with ambitions to expand across the Pacific, Asia, Middle East, UK and USA.

Be specific, actionable, and data-driven. Reference real market dynamics.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: systemPrompt,
      messages: [
        ...(context || []),
        { role: 'user', content: message }
      ]
    });

    res.json({ success: true, response: response.content[0].text, tokensUsed: response.usage.input_tokens + response.usage.output_tokens });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// EVENT MANAGEMENT ROUTES
// ══════════════════════════════════════════════════════════════

// Create Event
app.post('/api/events', auth, async (req, res) => {
  try {
    const event = {
      id: uuidv4(),
      userId: req.user.id,
      ...req.body,
      status: 'draft',
      ticketsSold: 0,
      revenue: 0,
      createdAt: new Date()
    };
    db.events.push(event);
    res.json({ success: true, event });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get User Events
app.get('/api/events', auth, (req, res) => {
  const events = db.events.filter(e => e.userId === req.user.id);
  res.json({ success: true, events });
});

// Get Event by ID
app.get('/api/events/:id', auth, (req, res) => {
  const event = db.events.find(e => e.id === req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  res.json({ success: true, event });
});

// ══════════════════════════════════════════════════════════════
// TICKETING ROUTES
// ══════════════════════════════════════════════════════════════

// Issue Ticket
app.post('/api/tickets/issue', auth, async (req, res) => {
  try {
    const { eventId, tierName, price, buyerEmail, buyerName } = req.body;
    const ticket = {
      id: uuidv4(),
      ticketCode: 'QTR-' + Math.random().toString(36).substr(2, 8).toUpperCase(),
      eventId, tierName, price, buyerEmail, buyerName,
      issuedAt: new Date(),
      status: 'valid',
      checkedIn: false
    };
    db.tickets.push(ticket);

    // Update event revenue
    const event = db.events.find(e => e.id === eventId);
    if (event) { event.ticketsSold++; event.revenue += price; }

    res.json({ success: true, ticket });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Validate Ticket (for door scanners)
app.post('/api/tickets/validate', (req, res) => {
  const { ticketCode } = req.body;
  const ticket = db.tickets.find(t => t.ticketCode === ticketCode);
  if (!ticket) return res.json({ valid: false, message: 'Ticket not found' });
  if (ticket.checkedIn) return res.json({ valid: false, message: 'Already checked in', checkedInAt: ticket.checkedInAt });
  ticket.checkedIn = true;
  ticket.checkedInAt = new Date();
  res.json({ valid: true, ticket, message: 'Welcome! Enjoy the show 🎭' });
});

// ══════════════════════════════════════════════════════════════
// PAYMENT ROUTES (Stripe)
// ══════════════════════════════════════════════════════════════

app.post('/api/payments/create-intent', auth, async (req, res) => {
  try {
    const { amount, currency = 'nzd', eventId, tierName } = req.body;
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // cents
      currency,
      metadata: { eventId, tierName, userId: req.user.id }
    });
    res.json({ success: true, clientSecret: intent.client_secret });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// COMMUNITY & MARKET DATA
// ══════════════════════════════════════════════════════════════

app.get('/api/communities', auth, (req, res) => res.json({ success: true, communities: db.communities }));
app.get('/api/markets', auth, (req, res) => res.json({ success: true, markets: db.markets }));
app.get('/api/celebrities', auth, (req, res) => res.json({ success: true, celebrities: db.celebrities }));

// ══════════════════════════════════════════════════════════════
// DASHBOARD ANALYTICS
// ══════════════════════════════════════════════════════════════

app.get('/api/dashboard', auth, (req, res) => {
  const userEvents = db.events.filter(e => e.userId === req.user.id);
  const totalRevenue = userEvents.reduce((s, e) => s + (e.revenue || 0), 0);
  const totalTickets = userEvents.reduce((s, e) => s + (e.ticketsSold || 0), 0);
  res.json({
    success: true,
    stats: {
      totalEvents: userEvents.length,
      liveEvents: userEvents.filter(e => e.status === 'live').length,
      totalRevenue,
      totalTickets,
      avgTicketValue: totalTickets ? totalRevenue / totalTickets : 0,
      topMarket: 'Auckland, NZ',
      nextEvent: userEvents.filter(e => e.status !== 'completed')[0] || null
    }
  });
});

// ══════════════════════════════════════════════════════════════
// HEALTH & SYSTEM
// ══════════════════════════════════════════════════════════════

app.get('/health', (req, res) => res.json({
  status: 'QUANTUM ONLINE',
  version: '1.0.0',
  platform: 'QUANTARA AGI',
  timestamp: new Date().toISOString(),
  modules: ['MIND', 'ORACLE', 'NEXUS', 'QUANTUM', 'PULSE', 'MATRIX', 'OPTIMIZER', 'VAULT', 'CORTEX'],
  uptime: process.uptime()
}));

app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║   QUANTARA AGI BACKEND — PORT ${PORT}      ║
  ║   Quantum Hybrid Intelligence Online     ║
  ║   Auckland HQ → Global Deployment       ║
  ╚══════════════════════════════════════════╝
  `);
});

module.exports = app;
