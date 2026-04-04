/**
 * routes/ai.js
 *
 * AI-powered train booking assistant route — WITH SESSION MEMORY.
 *
 * POST /api/ai/chat
 *   Body : { "message": string }
 *   Auth : Bearer JWT (authenticate middleware)
 *
 * KEY FEATURES:
 *   - Per-user session memory (in-memory Map keyed by userId)
 *   - Conversation history sent to OpenAI so AI never re-asks answered questions
 *   - Dynamic system prompt with current booking state
 *   - Auto-tool execution when all required fields are present
 *   - Session TTL of 30 minutes (auto-cleanup)
 *
 * INTEGRATION POINTS:
 *   - Train  model → searchTrains, checkAvailability
 *   - Booking model → bookTicket, cancelTicket
 *   No mock data, no service wrappers — direct Mongoose queries.
 */

import express from 'express';
import mongoose from 'mongoose';
import OpenAI from 'openai';
import Train from '../models/Train.js';
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// All AI endpoints require a valid JWT
router.use(authenticate);

// ---------------------------------------------------------------------------
// OpenAI client
// ---------------------------------------------------------------------------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ---------------------------------------------------------------------------
// SESSION MEMORY STORE — per-user, in-memory
// Key: userId (string)  Value: { bookingState, conversationHistory, lastActive }
// ---------------------------------------------------------------------------
const sessions = new Map();

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * getSession — returns or creates a session for the given user.
 */
function getSession(userId) {
  if (sessions.has(userId)) {
    const s = sessions.get(userId);
    // Check TTL
    if (Date.now() - s.lastActive > SESSION_TTL_MS) {
      sessions.delete(userId);
      return createSession(userId);
    }
    s.lastActive = Date.now();
    return s;
  }
  return createSession(userId);
}

function createSession(userId) {
  const s = {
    bookingState: {
      from: null,
      to: null,
      date: null,
      passengers: null,   // array of {name, age}
      classType: null,
      trainId: null,       // stored after a search result is selected
    },
    conversationHistory: [],  // OpenAI-format messages
    lastActive: Date.now(),
  };
  sessions.set(userId, s);
  return s;
}

/**
 * Periodic cleanup of expired sessions (runs every 10 minutes)
 */
setInterval(() => {
  const now = Date.now();
  for (const [uid, s] of sessions) {
    if (now - s.lastActive > SESSION_TTL_MS) sessions.delete(uid);
  }
}, 10 * 60 * 1000);

// ---------------------------------------------------------------------------
// Helper: extract structured fields from a user message (heuristic parsing)
// This supplements OpenAI — catches common patterns before the LLM round-trip.
// ---------------------------------------------------------------------------
function extractFieldsFromMessage(text) {
  const extracted = {};
  const lower = text.toLowerCase();

  // "from X to Y" pattern
  const fromToMatch = text.match(/from\s+([A-Za-z\s]+?)\s+to\s+([A-Za-z\s]+?)(?:\s|$|,|\.)/i);
  if (fromToMatch) {
    extracted.from = fromToMatch[1].trim();
    extracted.to = fromToMatch[2].trim();
  }

  // "X to Y" pattern (without "from")
  if (!extracted.from) {
    const simpleRoute = text.match(/^([A-Za-z]+)\s+to\s+([A-Za-z]+)/i);
    if (simpleRoute) {
      extracted.from = simpleRoute[1].trim();
      extracted.to = simpleRoute[2].trim();
    }
  }

  // Date patterns: "tomorrow", "today", YYYY-MM-DD, DD/MM/YYYY
  if (lower.includes('tomorrow')) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    extracted.date = d.toISOString().split('T')[0];
  } else if (lower.includes('today')) {
    extracted.date = new Date().toISOString().split('T')[0];
  } else if (lower.includes('day after tomorrow')) {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    extracted.date = d.toISOString().split('T')[0];
  } else {
    const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) extracted.date = dateMatch[1];
  }

  // Class type detection
  const validClasses = ['AC', 'Non-AC', 'Sleeper', 'Seater', 'First Class', 'Second Class', 'AC Chair Car', 'Executive Class', 'General'];
  for (const cls of validClasses) {
    if (lower.includes(cls.toLowerCase())) {
      extracted.classType = cls;
      break;
    }
  }

  // Simple passenger extraction: "Name Age" patterns like "Rahul 32" or "Rahul age 32"
  const passengerPattern = /([A-Za-z]{2,})\s+(?:age\s+)?(\d{1,3})/ig;
  const passengers = [];
  let pMatch;
  while ((pMatch = passengerPattern.exec(text)) !== null) {
    // Capitalize the first letter for the name
    const nameStr = pMatch[1];
    const name = nameStr.charAt(0).toUpperCase() + nameStr.slice(1).toLowerCase();
    const age = parseInt(pMatch[2], 10);
    // Filter out common mis-matches
    const stops = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'train', 'flight', 'bus', 'seat', 'class'];
    if (age >= 1 && age <= 120 && !stops.includes(name.toLowerCase())) {
      passengers.push({ name, age });
    }
  }
  if (passengers.length > 0) extracted.passengers = passengers;

  return extracted;
}

/**
 * updateSession — merges extracted fields into the session's bookingState.
 * ONLY overwrites null/empty values unless the user explicitly provides new data.
 */
function updateSession(session, extracted) {
  const state = session.bookingState;
  if (extracted.from)       state.from       = extracted.from;
  if (extracted.to)         state.to         = extracted.to;
  if (extracted.date)       state.date       = extracted.date;
  if (extracted.passengers) state.passengers = extracted.passengers;
  if (extracted.classType)  state.classType  = extracted.classType;
  if (extracted.trainId)    state.trainId    = extracted.trainId;
}

/**
 * isBookingReady — checks if all required fields for booking are present.
 */
function isBookingReady(state) {
  return !!(state.trainId && state.passengers && state.passengers.length > 0 && state.classType);
}

/**
 * getMissingFields — returns a list of field names still needed.
 */
function getMissingFields(state) {
  const missing = [];
  if (!state.from)       missing.push('origin city');
  if (!state.to)         missing.push('destination city');
  if (!state.trainId)    missing.push('train selection (search first, then pick a train)');
  if (!state.passengers || state.passengers.length === 0) missing.push('passenger details (name and age)');
  if (!state.classType)  missing.push('class type (AC, Sleeper, General, etc.)');
  return missing;
}

// ---------------------------------------------------------------------------
// DYNAMIC SYSTEM PROMPT — includes current booking state so AI never re-asks
// ---------------------------------------------------------------------------
function buildSystemPrompt(bookingState, userInfo) {
  const stateJSON = JSON.stringify(bookingState, null, 2);
  const userJSON = JSON.stringify(userInfo, null, 2);
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  
  const missing = getMissingFields(bookingState);
  const missingStr = missing.length > 0 ? missing.join(', ') : 'ALL FIELDS PRESENT — READY TO BOOK';

  return `You are Tixigo, a witty, helpful, and highly efficient travel concierge for an Indian railway platform.

CURRENT SYSTEM TIME: ${dateStr}, ${timeStr}

USER CONTEXT (Who you are talking to):
${userJSON}

PERSONALITY & TONE:
- Be professional yet friendly. Use emojis sparingly to maintain a premium feel.
- Address the user by their name ("${userInfo?.name || 'there'}") naturally in conversation.
- If the user asks general travel questions (e.g., "What should I eat in Jaipur?" or "Tips for night travel"), provide smart, helpful answers based on your knowledge, but keep it concise and relevant to their journey.

CORE RULES:
- Help users search trains, book tickets, cancel bookings, and check seat availability.
- Answer questions about the app's administration, statistics, and users using the provided tools.
- PROACTIVE SUGGESTIONS: Use savedPassengers and favoriteRoutes to anticipate needs. (e.g., "I see you frequently travel to ${userInfo?.favoriteRoutes?.[0]?.destination || 'Delhi'}—shall I check for trains there?")
- ALWAYS call the appropriate tool for any action. Never invent data (train IDs, booking references, etc.).
- If information is missing, ask for all missing fields in one polite message.
- If the user selects a train from search results, suggest checking availability or booking immediately.

CRITICAL MEMORY & LOGIC:
- CURRENT BOOKING STATE (below) shows what is already known. Do NOT re-ask for these.
- If origin and destination are the same, politely ask for a valid route.
- PARTIAL QUERIES:
  - If ONLY [Origin] is provided: "All trains from Delhi", call searchTrains(from="Delhi").
  - If ONLY [Destination] is provided: "I want to go to Mumbai", call searchTrains(to="Mumbai").
  - If NO [From/To] but [Date] is provided: "What is running today?", call searchTrains(date="YYYY-MM-DD").
  - If NO data is provided but user wants to "travel" or "book": Check favoriteRoutes and proactively suggest: "I see you often travel to Mumbai, shall I check trains from Delhi to Mumbai for tomorrow?"
- For "shortest", "cheapest", or "fastest" queries, search first then analyze the results for the user.
- toolUsed === "searchTrains" returns a list; your follow-up should help the user pick the best option.

CURRENT BOOKING STATE:
${stateJSON}

MISSING FIELDS: ${missingStr}`;
}

// ---------------------------------------------------------------------------
// Tool definitions (unchanged — same schemas)
// ---------------------------------------------------------------------------
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'searchTrains',
      description: 'Search for trains between two cities. If the user says "when is it available" or is flexible, OMIT the date to find all upcoming options.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Origin city/station name' },
          to:   { type: 'string', description: 'Destination city/station name' },
          date: { type: 'string', description: 'Travel date (YYYY-MM-DD). OMIT if user asks "when", "whenever", or is flexible.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bookTicket',
      description: 'Book train tickets for one or more passengers.',
      parameters: {
        type: 'object',
        properties: {
          trainId: { type: 'string', description: 'MongoDB ObjectId of the train to book.' },
          passengers: {
            type: 'array',
            description: 'List of passengers with name and age.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                age:  { type: 'number' },
              },
              required: ['name', 'age'],
            },
          },
          classType: {
            type: 'string',
            description: 'Class of travel.',
            enum: ['AC', 'Non-AC', 'Sleeper', 'Seater', 'First Class', 'Second Class', 'AC Chair Car', 'Executive Class', 'General'],
          },
        },
        required: ['trainId', 'passengers', 'classType'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancelTicket',
      description: 'Cancel an existing booking by its booking ID.',
      parameters: {
        type: 'object',
        properties: {
          bookingId: { type: 'string', description: 'MongoDB ObjectId of the booking to cancel.' },
        },
        required: ['bookingId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'checkAvailability',
      description: 'Check seat availability and class details for a specific train.',
      parameters: {
        type: 'object',
        properties: {
          trainId: { type: 'string', description: 'MongoDB ObjectId of the train to check.' },
        },
        required: ['trainId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getAdminInfo',
      description: 'Get information about the application administrators (name, email, profile picture).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getAppSummary',
      description: 'Get a high-level summary of the application (total users, trains, and bookings).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getUserBookings',
      description: 'List current and past bookings for the logged-in user.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getSavedPassengers',
      description: 'Retrieve the user\'s saved list of passengers (family/friends) for quick booking.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getFavoriteRoutes',
      description: 'Retrieve the user\'s favorite or frequently searched train routes.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getHelpFAQs',
      description: 'Get answers to frequently asked questions about the app features, booking policies, seat classes, and cancellation rules.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool executor functions — each calls real Mongoose models (unchanged)
// ---------------------------------------------------------------------------

async function getHelpFAQs() {
  return {
    faqs: [
      { q: "How to book?", a: "Search for a train, select your preferred class, add passenger details, and click Book. You can also ask me to do it for you!" },
      { q: "Cancellation policy", a: "You can cancel any 'confirmed' booking up to 2 hours before departure for a full refund. Cancellations are not allowed within 2 hours." },
      { q: "What are the seat classes?", a: "We offer AC (Premium), Sleeper (Budget), First Class (Luxury), and General. Prices vary based on class and distance." },
      { q: "Is food included?", a: "Most AC and First Class trains include meals. You can check the 'amenities' section of a train for details." },
      { q: "Support contact", a: "For urgent issues, you can contact our administrators: Rahul (rahul@tixigo.com) or the support team at support@tixigo.com." }
    ]
  };
}

// ---------------------------------------------------------------------------
// SEMANTIC SEARCH HELPERS: Maps general city names to specific station variations.
// This mimics how LLMs use "semantic understanding" to handle broad queries.
// ---------------------------------------------------------------------------
const CITY_MAPPING = {
  'delhi': ['New Delhi', 'Old Delhi', 'Hazrat Nizamuddin', 'Delhi Cantt', 'Anand Vihar'],
  'mumbai': ['Mumbai Central', 'Chhatrapati Shivaji Maharaj Terminus', 'Dadar', 'Bandra Terminus', 'Kurla', 'Panvel'],
  'bangalore': ['KSR Bengaluru', 'Yesvantpur', 'Bangalore Cantt', 'Krishnarajapuram'],
  'kolkata': ['Howrah', 'Sealdah', 'Kolkata Station', 'Shalimar'],
  'chennai': ['Chennai Central', 'Chennai Egmore', 'Tambaram'],
  'hyderabad': ['Secunderabad', 'Hyderabad Deccan', 'Kacheguda'],
  'pune': ['Pune Junction', 'Shivajinagar'],
  'jaipur': ['Jaipur Junction', 'Gandhinagar Jaipur'],
  'ahmedabad': ['Ahmedabad Junction', 'Sabarmati', 'Kalupur'],
  'lucknow': ['Lucknow Charbagh', 'Lucknow Junction', 'Aishbagh'],
  'patna': ['Patna Junction', 'Patliputra', 'Rajendra Nagar'],
  'surat': ['Surat Station', 'Udhna Junction']
};

/**
 * getStationQuery — Returns a Mongoose query object for a city/station input.
 * Handles exact matches, regex, and city-to-station semantic mappings.
 */
function getStationQuery(input) {
  if (!input || !input.trim()) return null;
  const clean = input.trim().toLowerCase();
  
  // 1. Check if it's a known city with multiple stations
  if (CITY_MAPPING[clean]) {
      return { $in: CITY_MAPPING[clean].map(s => new RegExp(s, 'i')) };
  }
  
  // 2. Default to fuzzy regex match
  return { $regex: new RegExp(clean, 'i') };
}

async function searchTrains({ from, to, date }) {
  const query = { status: 'active' };
  
  const fromQuery = getStationQuery(from);
  if (fromQuery) query.origin = fromQuery;
  
  const toQuery = getStationQuery(to);
  if (toQuery) query.destination = toQuery;

  let finalDate = date;
  let isFallback = false;

  if (date) {
    const searchDate = new Date(date);
    if (isNaN(searchDate.getTime())) {
      throw new Error('Validation: "date" must be a valid date string (YYYY-MM-DD).');
    }
    const nextDay = new Date(searchDate);
    nextDay.setDate(nextDay.getDate() + 1);
    query.departureTime = { $gte: searchDate, $lt: nextDay };
  } else {
    query.departureTime = { $gte: new Date() };
  }

  let trains = await Train.find(query)
    .select('trainName trainNumber origin destination departureTime arrivalTime availableSeats totalSeats classes status')
    .sort({ departureTime: 1 })
    .limit(10)
    .lean();

  // SMART FALLBACK: If a specific date was requested but no trains found, 
  // search for the NEXT available trains for this route.
  if (date && trains.length === 0) {
    isFallback = true;
    const fallbackQuery = { ...query };
    delete fallbackQuery.departureTime;
    fallbackQuery.departureTime = { $gte: new Date(date) };
    
    trains = await Train.find(fallbackQuery)
      .select('trainName trainNumber origin destination departureTime arrivalTime availableSeats totalSeats classes status')
      .sort({ departureTime: 1 })
      .limit(10)
      .lean();
    
    if (trains.length > 0) {
      finalDate = trains[0].departureTime.toISOString().split('T')[0];
    }
  }

  return { 
    found: trains.length, 
    trains, 
    requestedDate: date,
    actualDate: finalDate,
    isFallbackSearch: isFallback,
    message: isFallback && trains.length > 0 
      ? `No trains found on ${date}, but I found options starting from ${finalDate}.`
      : null
  };
}

async function checkAvailability({ trainId }) {
  if (!trainId || !mongoose.Types.ObjectId.isValid(trainId)) {
    throw new Error('Validation: "trainId" must be a valid MongoDB ObjectId.');
  }

  const train = await Train.findById(trainId)
    .select('trainName trainNumber origin destination departureTime arrivalTime availableSeats totalSeats classes status')
    .lean();

  if (!train) {
    return { available: false, message: 'Train not found.' };
  }
  if (train.status !== 'active') {
    return { available: false, trainId, trainName: train.trainName, status: train.status };
  }

  const occupancyPct = (((train.totalSeats - train.availableSeats) / train.totalSeats) * 100).toFixed(1);

  return {
    available:        train.availableSeats > 0,
    trainId:          train._id,
    trainName:        train.trainName,
    trainNumber:      train.trainNumber,
    route:            `${train.origin} → ${train.destination}`,
    departureTime:    train.departureTime,
    arrivalTime:      train.arrivalTime,
    availableSeats:   train.availableSeats,
    totalSeats:       train.totalSeats,
    occupancyPercent: occupancyPct,
    classes:          train.classes,
  };
}

async function bookTicket({ trainId, passengers, classType }, userId) {
  if (!trainId || !mongoose.Types.ObjectId.isValid(trainId)) {
    throw new Error('Validation: "trainId" must be a valid MongoDB ObjectId.');
  }
  if (!Array.isArray(passengers) || passengers.length === 0) {
    throw new Error('Validation: "passengers" must be a non-empty array.');
  }
  for (const p of passengers) {
    if (!p.name || typeof p.name !== 'string' || p.name.trim().length < 2) {
      throw new Error('Validation: each passenger must have a "name" with at least 2 characters.');
    }
    if (typeof p.age !== 'number' || p.age < 1 || p.age > 120) {
      throw new Error('Validation: each passenger must have a valid "age" (1–120).');
    }
  }
  const validClasses = ['AC', 'Non-AC', 'Sleeper', 'Seater', 'First Class', 'Second Class', 'AC Chair Car', 'Executive Class', 'General'];
  if (!classType || !validClasses.includes(classType)) {
    throw new Error(`Validation: "classType" must be one of: ${validClasses.join(', ')}.`);
  }

  const totalSeatsBooked = passengers.length;
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const train = await Train.findById(trainId).session(session);
    if (!train) { await session.abortTransaction(); return { success: false, message: 'Train not found.' }; }
    if (train.status !== 'active') { await session.abortTransaction(); return { success: false, message: 'Train is not available for booking.' }; }
    if (new Date(train.departureTime) <= new Date()) { await session.abortTransaction(); return { success: false, message: 'Cannot book past or ongoing trains.' }; }
    if (train.availableSeats < totalSeatsBooked) { await session.abortTransaction(); return { success: false, message: `Only ${train.availableSeats} seat(s) available.` }; }

    const requestedClass = train.classes.find(c => c.type === classType);
    if (requestedClass && requestedClass.availableSeats < totalSeatsBooked) {
      await session.abortTransaction();
      return { success: false, message: `Only ${requestedClass.availableSeats} seat(s) available in ${classType}.` };
    }

    const booking = new Booking({
      userId, trainId, passengers, totalSeatsBooked, classType,
      payment: { amount: requestedClass ? requestedClass.price * totalSeatsBooked : 0 },
    });
    await booking.save({ session });

    train.availableSeats -= totalSeatsBooked;
    if (requestedClass) requestedClass.availableSeats -= totalSeatsBooked;
    await train.save({ session });
    await session.commitTransaction();

    return {
      success: true,
      bookingId: booking._id,
      bookingReference: booking.bookingReference,
      trainName: train.trainName,
      route: `${train.origin} → ${train.destination}`,
      departureTime: train.departureTime,
      classType, passengers, totalSeatsBooked,
      status: booking.status,
    };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

async function getAdminInfo() {
  const admins = await User.find({ role: 'admin' })
    .select('name email mobile profilePicture')
    .lean();
  return { count: admins.length, admins };
}

async function getAppSummary() {
  const [userCount, trainCount, bookingCount] = await Promise.all([
    User.countDocuments(),
    Train.countDocuments(),
    Booking.countDocuments(),
  ]);
  return {
    totalUsers: userCount,
    totalTrains: trainCount,
    totalBookings: bookingCount,
    platformName: 'Tixigo',
    version: '1.0.0',
  };
}

async function getUserBookings(_, userId) {
  const userBookings = await Booking.find({ userId })
    .populate('trainId', 'trainName trainNumber origin destination departureTime')
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();
  return { count: userBookings.length, bookings: userBookings };
}

async function getSavedPassengers(_, userId) {
  const user = await User.findById(userId).select('savedPassengers').lean();
  return { savedPassengers: user?.savedPassengers || [] };
}

async function getFavoriteRoutes(_, userId) {
  const user = await User.findById(userId).select('favoriteRoutes').lean();
  return { favoriteRoutes: user?.favoriteRoutes || [] };
}

async function cancelTicket({ bookingId }, userId) {
  if (!bookingId || !mongoose.Types.ObjectId.isValid(bookingId)) {
    throw new Error('Validation: "bookingId" must be a valid MongoDB ObjectId.');
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const booking = await Booking.findOne({ _id: bookingId, userId }).session(session);
    if (!booking) { await session.abortTransaction(); return { success: false, message: 'Booking not found or does not belong to you.' }; }
    if (booking.status === 'cancelled') { await session.abortTransaction(); return { success: false, message: 'Booking is already cancelled.' }; }
    if (booking.status === 'completed') { await session.abortTransaction(); return { success: false, message: 'Cannot cancel a completed booking.' }; }

    const train = await Train.findById(booking.trainId).session(session);
    if (train) {
      const hoursDiff = (new Date(train.departureTime).getTime() - Date.now()) / (1000 * 3600);
      if (hoursDiff < 2) { await session.abortTransaction(); return { success: false, message: 'Cannot cancel within 2 hours of departure.' }; }
      train.availableSeats += booking.totalSeatsBooked;
      if (booking.classType) {
        const cls = train.classes.find(c => c.type === booking.classType);
        if (cls) cls.availableSeats += booking.totalSeatsBooked;
      }
      await train.save({ session });
    }

    booking.status = 'cancelled';
    await booking.save({ session });
    await session.commitTransaction();

    return {
      success: true,
      bookingId: booking._id,
      bookingReference: booking.bookingReference,
      message: 'Booking cancelled successfully.',
    };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

// ---------------------------------------------------------------------------
// Tool dispatcher
// ---------------------------------------------------------------------------
async function executeTool(name, args, userId) {
  switch (name) {
    case 'searchTrains':      return searchTrains(args);
    case 'checkAvailability': return checkAvailability(args);
    case 'bookTicket':        return bookTicket(args, userId);
    case 'cancelTicket':      return cancelTicket(args, userId);
    case 'getAdminInfo':      return getAdminInfo();
    case 'getAppSummary':     return getAppSummary();
    case 'getUserBookings':   return getUserBookings(args, userId);
    case 'getSavedPassengers': return getSavedPassengers(args, userId);
    case 'getFavoriteRoutes':  return getFavoriteRoutes(args, userId);
    case 'getHelpFAQs':        return getHelpFAQs();
    default: throw new Error(`Unknown tool: "${name}"`);
  }
}

// ---------------------------------------------------------------------------
// POST /api/ai/chat  — WITH SESSION MEMORY
// ---------------------------------------------------------------------------
router.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: '"message" is required and must be a non-empty string.',
      });
    }

    const userId = req.user.id.toString();
    const userMessage = message.trim();

    // ---- Step 1: Get user profile for extra context ----
    const userProfile = await User.findById(userId).select('name email savedPassengers favoriteRoutes').lean();

    // ---- Step 2: Get or create user session ----
    const session = getSession(userId);

    // ---- Step 3: Extract fields from message & merge into session ----
    const extracted = extractFieldsFromMessage(userMessage);
    updateSession(session, extracted);

    // ---- Step 4: Add user message to conversation history ----
    session.conversationHistory.push({ role: 'user', content: userMessage });

    // Keep conversation history manageable (last 20 messages)
    if (session.conversationHistory.length > 20) {
      session.conversationHistory = session.conversationHistory.slice(-20);
    }

    // ---- Step 5: Build dynamic system prompt with current state ----
    const systemPrompt = buildSystemPrompt(session.bookingState, userProfile);

    // ---- Step 5: Call OpenAI with full conversation history ----
    const openaiMessages = [
      { role: 'system', content: systemPrompt },
      ...session.conversationHistory,
    ];

    const aiResponse = await openai.chat.completions.create({
      model:       'gpt-4o',
      temperature: 0.2,
      messages:    openaiMessages,
      tools:       TOOLS,
      tool_choice: 'auto',
    });

    const assistantMessage = aiResponse.choices[0].message;

    // ---- Step 6: Handle tool calls ----
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      const toolCall = assistantMessage.tool_calls[0];
      const toolName = toolCall.function.name;

      let toolArgs;
      try {
        toolArgs = JSON.parse(toolCall.function.arguments);
      } catch {
        return res.status(500).json({ success: false, message: 'Failed to parse tool arguments.' });
      }

      // Execute the tool
      let toolResult;
      try {
        toolResult = await executeTool(toolName, toolArgs, userId);
        
        // ---- Step 6.1: Update session state from tool result & args ----
        if (toolName === 'searchTrains') {
          if (toolArgs.from) session.bookingState.from = toolArgs.from;
          if (toolArgs.to)   session.bookingState.to = toolArgs.to;
          
          // Optimization: Use actualDate from toolResult if tool returned a fallback
          if (toolResult?.actualDate) {
            session.bookingState.date = toolResult.actualDate;
          } else if (toolArgs.date) {
            session.bookingState.date = toolArgs.date;
          }
        }
        if (toolName === 'bookTicket') {
          if (toolArgs.trainId)    session.bookingState.trainId = toolArgs.trainId;
          if (toolArgs.passengers) session.bookingState.passengers = toolArgs.passengers;
          if (toolArgs.classType)  session.bookingState.classType = toolArgs.classType;
        }
      } catch (toolError) {
        const isValidationError = toolError.message.startsWith('Validation:');
        // Store error in conversation so AI knows what went wrong
        session.conversationHistory.push(
          { role: 'assistant', content: null, tool_calls: [toolCall] },
          { role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ error: toolError.message }) }
        );
        return res.status(isValidationError ? 400 : 500).json({
          success: false,
          message: toolError.message,
        });
      }

      // If searchTrains returned results, store the first train ID as a default
      if (toolName === 'searchTrains' && toolResult.trains && toolResult.trains.length > 0) {
        // Don't auto-select — let user choose, but store the results context
        session.lastSearchResults = toolResult.trains;
      }

      // After a successful booking, clear the booking state for a fresh start
      if (toolName === 'bookTicket' && toolResult.success) {
        session.bookingState = {
          from: null, to: null, date: null,
          passengers: null, classType: null, trainId: null,
        };
      }

      // Store tool interaction in conversation history
      session.conversationHistory.push(
        { role: 'assistant', content: null, tool_calls: [toolCall] },
        { role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(toolResult) }
      );

      // ---- Step 7: Call OpenAI again to get a natural language response based on tool result ----
      const secondCallMessages = [
        { role: 'system', content: systemPrompt },
        ...session.conversationHistory,
      ];

      const secondAiResponse = await openai.chat.completions.create({
        model:       'gpt-4o',
        temperature: 0.2,
        messages:    secondCallMessages,
      });

      const finalAssistantMessage = secondAiResponse.choices[0].message;
      const finalReplyText = finalAssistantMessage.content || '';

      // Add final verbal reply to history
      session.conversationHistory.push({ role: 'assistant', content: finalReplyText });

      return res.status(200).json({
        success:  true,
        toolUsed: toolName,
        result:   toolResult,
        message:  finalReplyText,
        bookingState: session.bookingState,
      });
    }

    // ---- No tool call — plain AI reply ----
    const replyText = assistantMessage.content || '';

    // Store assistant reply in conversation history
    session.conversationHistory.push({ role: 'assistant', content: replyText });

    return res.status(200).json({
      success: true,
      message: replyText,
      bookingState: session.bookingState,
    });

  } catch (error) {
    console.error('AI chat error:', error);

    if (error?.status === 401) {
      return res.status(500).json({ success: false, message: 'OpenAI authentication failed. Check OPENAI_API_KEY.' });
    }
    if (error?.status === 429) {
      return res.status(429).json({ success: false, message: 'AI service rate limit reached. Please try again shortly.' });
    }
    if (error?.status === 503 || error?.code === 'ECONNREFUSED') {
      return res.status(503).json({ success: false, message: 'AI service temporarily unavailable.' });
    }

    return res.status(500).json({
      success: false,
      message: 'An unexpected error occurred while processing your request.',
      ...(process.env.NODE_ENV === 'development' && { error: error.message }),
    });
  }
});

// ---------------------------------------------------------------------------
// POST /api/ai/clear  — Clear session for current user (optional utility)
// ---------------------------------------------------------------------------
router.post('/clear', (req, res) => {
  sessions.delete(req.user.id.toString());
  res.json({ success: true, message: 'Session cleared.' });
});

export default router;
