/**
 * routes/ai.js
 *
 * AI-powered train booking assistant route.
 *
 * POST /api/ai/chat
 *   Body : { "message": string }
 *   Auth : Bearer JWT (authenticate middleware)
 *
 * EXECUTION FLOW:
 *   1. Validate user message
 *   2. Call OpenAI with a strong system prompt + tool definitions
 *   3. If OpenAI returns a tool_call → validate args → run real DB query → return result
 *   4. If no tool_call → return the assistant's natural-language reply
 *
 * INTEGRATION POINTS:
 *   - Train  model  → searchTrains, checkAvailability
 *   - Booking model → bookTicket, cancelTicket
 *   No mock data, no service wrappers — direct Mongoose queries, same as the rest of the codebase.
 */

import express from 'express';
import mongoose from 'mongoose';
import OpenAI from 'openai';
import Train from '../models/Train.js';
import Booking from '../models/Booking.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// All AI endpoints require a valid JWT
router.use(authenticate);

// ---------------------------------------------------------------------------
// OpenAI client — reads key from environment (set OPENAI_API_KEY in .env)
// ---------------------------------------------------------------------------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ---------------------------------------------------------------------------
// System prompt — instructs the model to always use tools for actions and
// never invent IDs or booking references.
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are Tixigo, an expert train booking assistant for an Indian railway platform.

RULES:
- You help users search trains, book tickets, cancel bookings, and check seat availability.
- ALWAYS call the appropriate tool when any action is requested. Never answer a booking/search/cancel/availability question from memory.
- NEVER invent, guess, or hallucinate train IDs, booking IDs, or reference numbers. Only use IDs the user explicitly provides or that were returned by a previous tool result.
- If the user's request is ambiguous (e.g., missing date or destination), ask one clarifying question before calling a tool.
- Respond in a friendly, concise manner. Format train details clearly.
- classType must be one of: AC, Non-AC, Sleeper, Seater, First Class, Second Class, AC Chair Car, Executive Class, General.
- passengers must be an array of objects with "name" (string) and "age" (number).`;

// ---------------------------------------------------------------------------
// Tool definitions — these are sent to OpenAI as function schemas.
// OpenAI decides which (if any) to invoke based on the user message.
// ---------------------------------------------------------------------------
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'searchTrains',
      description: 'Search for available trains between two cities on a given date.',
      parameters: {
        type: 'object',
        properties: {
          from: {
            type: 'string',
            description: 'Origin city/station name, e.g. "Mumbai"',
          },
          to: {
            type: 'string',
            description: 'Destination city/station name, e.g. "Delhi"',
          },
          date: {
            type: 'string',
            description: 'Travel date in YYYY-MM-DD format. If not specified by user, omit this field.',
          },
        },
        required: ['from', 'to'],
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
          trainId: {
            type: 'string',
            description: 'MongoDB ObjectId of the train to book.',
          },
          passengers: {
            type: 'array',
            description: 'List of passengers. Each must have name and age.',
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
          bookingId: {
            type: 'string',
            description: 'MongoDB ObjectId of the booking to cancel.',
          },
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
          trainId: {
            type: 'string',
            description: 'MongoDB ObjectId of the train to check.',
          },
        },
        required: ['trainId'],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool executor functions — each calls real Mongoose models.
// All return plain objects serialisable as JSON.
// ---------------------------------------------------------------------------

/**
 * searchTrains — Integration point: Train model
 * Queries active trains matching origin/destination, optionally filtered by date.
 */
async function searchTrains({ from, to, date }) {
  // Validation
  if (!from || typeof from !== 'string' || !from.trim()) {
    throw new Error('Validation: "from" (origin) is required and must be a non-empty string.');
  }
  if (!to || typeof to !== 'string' || !to.trim()) {
    throw new Error('Validation: "to" (destination) is required and must be a non-empty string.');
  }

  const query = {
    origin:      from.trim(),
    destination: to.trim(),
    status:      'active',
  };

  if (date) {
    const searchDate = new Date(date);
    if (isNaN(searchDate.getTime())) {
      throw new Error('Validation: "date" must be a valid date string (YYYY-MM-DD).');
    }
    const nextDay = new Date(searchDate);
    nextDay.setDate(nextDay.getDate() + 1);
    query.departureTime = { $gte: searchDate, $lt: nextDay };
  } else {
    // Default: only future trains
    query.departureTime = { $gte: new Date() };
  }

  const trains = await Train.find(query)
    .select('trainName trainNumber origin destination departureTime arrivalTime availableSeats totalSeats classes status')
    .sort({ departureTime: 1 })
    .limit(10)
    .lean();

  return { found: trains.length, trains };
}

/**
 * checkAvailability — Integration point: Train model
 * Returns seat counts and class breakdown for a given train.
 */
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
    available:         train.availableSeats > 0,
    trainId:           train._id,
    trainName:         train.trainName,
    trainNumber:       train.trainNumber,
    route:             `${train.origin} → ${train.destination}`,
    departureTime:     train.departureTime,
    arrivalTime:       train.arrivalTime,
    availableSeats:    train.availableSeats,
    totalSeats:        train.totalSeats,
    occupancyPercent:  occupancyPct,
    classes:           train.classes,
  };
}

/**
 * bookTicket — Integration point: Booking + Train models
 * Creates a booking document inside a Mongoose transaction, decrements train seats,
 * and returns the booking reference.
 */
async function bookTicket({ trainId, passengers, classType }, userId) {
  // --- Argument validation ---
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
    if (!train) {
      await session.abortTransaction();
      return { success: false, message: 'Train not found.' };
    }
    if (train.status !== 'active') {
      await session.abortTransaction();
      return { success: false, message: 'Train is not available for booking.' };
    }
    if (new Date(train.departureTime) <= new Date()) {
      await session.abortTransaction();
      return { success: false, message: 'Cannot book past or ongoing trains.' };
    }
    if (train.availableSeats < totalSeatsBooked) {
      await session.abortTransaction();
      return { success: false, message: `Only ${train.availableSeats} seat(s) available.` };
    }

    // Check class-level availability if the train has explicit class data
    const requestedClass = train.classes.find(c => c.type === classType);
    if (requestedClass && requestedClass.availableSeats < totalSeatsBooked) {
      await session.abortTransaction();
      return {
        success: false,
        message: `Only ${requestedClass.availableSeats} seat(s) available in ${classType}.`,
      };
    }

    const booking = new Booking({
      userId,
      trainId,
      passengers,
      totalSeatsBooked,
      classType,
      payment: { amount: requestedClass ? requestedClass.price * totalSeatsBooked : 0 },
    });
    await booking.save({ session });

    // Decrement seats
    train.availableSeats -= totalSeatsBooked;
    if (requestedClass) requestedClass.availableSeats -= totalSeatsBooked;
    await train.save({ session });

    await session.commitTransaction();

    return {
      success:          true,
      bookingId:        booking._id,
      bookingReference: booking.bookingReference,
      trainName:        train.trainName,
      route:            `${train.origin} → ${train.destination}`,
      departureTime:    train.departureTime,
      classType,
      passengers,
      totalSeatsBooked,
      status:           booking.status,
    };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

/**
 * cancelTicket — Integration point: Booking + Train models
 * Marks the booking as cancelled and restores the train's seat count.
 */
async function cancelTicket({ bookingId }, userId) {
  if (!bookingId || !mongoose.Types.ObjectId.isValid(bookingId)) {
    throw new Error('Validation: "bookingId" must be a valid MongoDB ObjectId.');
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const booking = await Booking.findOne({ _id: bookingId, userId }).session(session);
    if (!booking) {
      await session.abortTransaction();
      return { success: false, message: 'Booking not found or does not belong to you.' };
    }
    if (booking.status === 'cancelled') {
      await session.abortTransaction();
      return { success: false, message: 'Booking is already cancelled.' };
    }
    if (booking.status === 'completed') {
      await session.abortTransaction();
      return { success: false, message: 'Cannot cancel a completed booking.' };
    }

    const train = await Train.findById(booking.trainId).session(session);
    if (train) {
      const departureTime = new Date(train.departureTime);
      const hoursDiff = (departureTime.getTime() - Date.now()) / (1000 * 3600);
      if (hoursDiff < 2) {
        await session.abortTransaction();
        return { success: false, message: 'Cannot cancel within 2 hours of departure.' };
      }

      // Restore seats
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
      success:          true,
      bookingId:        booking._id,
      bookingReference: booking.bookingReference,
      message:          'Booking cancelled successfully.',
    };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

// ---------------------------------------------------------------------------
// Tool dispatcher — maps OpenAI function name → executor function
// ---------------------------------------------------------------------------
async function executeTool(name, args, userId) {
  switch (name) {
    case 'searchTrains':       return searchTrains(args);
    case 'checkAvailability':  return checkAvailability(args);
    case 'bookTicket':         return bookTicket(args, userId);
    case 'cancelTicket':       return cancelTicket(args, userId);
    default:
      throw new Error(`Unknown tool requested by model: "${name}"`);
  }
}

// Alias so it reads naturally inside the handler
const tools = TOOLS;

// ---------------------------------------------------------------------------
// POST /api/ai/chat
// ---------------------------------------------------------------------------
router.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;

    // Input validation
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: '"message" is required and must be a non-empty string.',
      });
    }

    const userId = req.user.id;

    // ---- Step 1: Initial OpenAI call with tools ----
    const initialResponse = await openai.chat.completions.create({
      model:       'gpt-4o',
      temperature: 0.3,
      messages: [
        { role: 'system',  content: SYSTEM_PROMPT },
        { role: 'user',    content: message.trim() },
      ],
      tools,              // function schemas defined above
      tool_choice: 'auto', // let the model decide whether to call a tool
    });

    const assistantMessage = initialResponse.choices[0].message;

    // ---- Step 2: Check if OpenAI wants to call a tool ----
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      const toolCall   = assistantMessage.tool_calls[0]; // handle first tool call
      const toolName   = toolCall.function.name;

      let toolArgs;
      try {
        toolArgs = JSON.parse(toolCall.function.arguments);
      } catch {
        return res.status(500).json({
          success: false,
          message: 'Failed to parse tool arguments returned by AI.',
        });
      }

      // ---- Step 3: Execute the real service ----
      let toolResult;
      try {
        toolResult = await executeTool(toolName, toolArgs, userId);
      } catch (toolError) {
        // Validation errors from our executors → 400; unexpected DB errors → 500
        const isValidationError = toolError.message.startsWith('Validation:');
        return res.status(isValidationError ? 400 : 500).json({
          success: false,
          message: toolError.message,
        });
      }

      // ---- Step 4: Return structured result to client ----
      // (Optionally you can do a second OpenAI round-trip for a natural-language
      //  summary, but returning the raw structured result is more predictable
      //  and faster for a production mobile client.)
      return res.status(200).json({
        success:  true,
        toolUsed: toolName,
        result:   toolResult,
        message:  `Action "${toolName}" completed successfully.`,
      });
    }

    // ---- No tool call — plain AI reply ----
    return res.status(200).json({
      success: true,
      message: assistantMessage.content,
    });

  } catch (error) {
    // OpenAI SDK errors have a status property; everything else is a 500
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

export default router;
