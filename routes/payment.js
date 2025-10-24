import express from 'express';
import mongoose from 'mongoose';
import { authenticate } from '../middleware/auth.js';
import { sendResponse, asyncHandler } from '../utils/helpers.js';
import { HTTP_STATUS } from '../utils/constants.js';
import { invalidateCacheMiddleware } from '../middleware/cache.js';
import Booking from '../models/Booking.js';
import Train from '../models/Train.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Get payment config for frontend (dummy)
router.get('/config', asyncHandler(async (req, res) => {
  sendResponse(res, HTTP_STATUS.OK, true, 'Payment config fetched', {
    paymentMode: 'dummy',
  });
}));

// Create dummy payment order for booking
router.post('/create-order', asyncHandler(async (req, res) => {
  const { trainId, passengers, classType } = req.body;
  const userId = req.user.id;

  if (!trainId || !passengers || !classType) {
    return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Train ID, passengers, and class type are required');
  }

  if (!Array.isArray(passengers) || passengers.length === 0) {
    return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'At least one passenger is required');
  }

  // Validate trainId is a valid MongoDB ObjectId
  if (!mongoose.Types.ObjectId.isValid(trainId)) {
    return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Invalid Train ID format');
  }

  // Validate train exists
  const train = await Train.findById(trainId);
  if (!train) {
    return sendResponse(res, HTTP_STATUS.NOT_FOUND, false, 'Train not found');
  }

  // Find the selected class and get its price
  const selectedClass = train.classes.find(cls => cls.type === classType);
  if (!selectedClass) {
    return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, `Class type "${classType}" not available for this train`);
  }

  // Check if enough seats are available in the selected class
  if (selectedClass.availableSeats < passengers.length) {
    return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, `Insufficient seats available in ${classType} class`);
  }

  // Calculate total amount based on number of passengers and class price
  const pricePerTicket = selectedClass.price;
  const totalAmount = pricePerTicket * passengers.length;

  // Create temporary booking reference
  const bookingReference = 'TRB' + Date.now().toString(36).toUpperCase() +
                          Math.random().toString(36).substr(2, 5).toUpperCase();

  // Create dummy order ID
  const orderId = 'order_dummy_' + Date.now() + Math.random().toString(36).substr(2, 9);

  // Store order details temporarily (you might want to create a pending booking)
  sendResponse(res, HTTP_STATUS.OK, true, 'Payment order created successfully', {
    orderId: orderId,
    amount: totalAmount, // Total calculated amount in rupees
    pricePerTicket: pricePerTicket,
    classType: classType,
    numberOfPassengers: passengers.length,
    currency: 'INR',
    bookingReference,
  });
}));

// Verify payment and create booking (dummy payment - auto-approved)
router.post('/verify-payment', invalidateCacheMiddleware(['cache:*/api/bookings*', 'cache:*/api/trains*']), asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      orderId,
      paymentId,
      trainId,
      passengers,
      amount,
      classType,
    } = req.body;

    if (!orderId || !trainId || !passengers || !amount) {
      await session.abortTransaction();
      return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Payment verification details are required');
    }

    // Dummy payment - automatically approve all payments

    // Verify train and seats
    const train = await Train.findById(trainId).session(session);
    if (!train) {
      await session.abortTransaction();
      return sendResponse(res, HTTP_STATUS.NOT_FOUND, false, 'Train not found');
    }

    const totalSeatsBooked = passengers.length;

    if (train.status !== 'active') {
      await session.abortTransaction();
      return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Train is not available for booking');
    }

    if (new Date(train.departureTime) <= new Date()) {
      await session.abortTransaction();
      return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Cannot book past or ongoing trains');
    }

    // Validate classType is required
    if (!classType) {
      await session.abortTransaction();
      return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Class type is required');
    }

    // Find the selected class
    const selectedClass = train.classes.find(cls => cls.type === classType);
    if (!selectedClass) {
      await session.abortTransaction();
      return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, `Class type "${classType}" not available for this train`);
    }

    // Check class-specific seat availability
    if (selectedClass.availableSeats < totalSeatsBooked) {
      await session.abortTransaction();
      return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, `Insufficient seats available in ${classType} class`);
    }

    // Create booking with dummy payment details
    const booking = new Booking({
      userId: req.user.id,
      trainId,
      passengers,
      totalSeatsBooked,
      classType,
      payment: {
        orderId: orderId || 'dummy_order_' + Date.now(),
        paymentId: paymentId || 'dummy_payment_' + Date.now(),
        signature: 'dummy_signature',
        amount: amount,
        currency: 'INR',
        status: 'completed',
        method: 'dummy',
        paidAt: new Date(),
      },
    });

    await booking.save({ session });

    // Update class-specific seats
    selectedClass.availableSeats -= totalSeatsBooked;
    // Also update general train seats
    train.availableSeats -= totalSeatsBooked;
    await train.save({ session });

    await session.commitTransaction();

    // Emit WebSocket event
    const io = req.app.get('io');
    if (io) {
      io.to(`train-${trainId}`).emit('seat-update', {
        trainId: train._id,
        availableSeats: train.availableSeats,
        totalSeats: train.totalSeats,
        occupancyPercentage: ((train.totalSeats - train.availableSeats) / train.totalSeats * 100).toFixed(1),
        action: 'booking',
      });
    }

    // Fetch populated booking
    const populatedBooking = await Booking.findById(booking._id)
      .populate({
        path: 'trainId',
        select: 'trainName trainNumber origin destination departureTime arrivalTime',
      })
      .populate({
        path: 'userId',
        select: 'name email mobile',
      });

    // Send confirmation email (import from bookings route logic)
    try {
      const { sendBookingConfirmation } = await import('../lib/email.js');
      const { generateBookingPDF } = await import('../utils/helpers.js');

      const ticketData = await generateBookingPDF({
        booking: populatedBooking,
        train: populatedBooking.trainId,
        user: populatedBooking.userId,
      });

      await sendBookingConfirmation(
        populatedBooking.userId.email,
        {
          booking: populatedBooking,
          train: populatedBooking.trainId,
          user: populatedBooking.userId,
        },
        ticketData
      );
    } catch (emailError) {
      console.error('Email send error:', emailError);
    }

    sendResponse(res, HTTP_STATUS.CREATED, true, 'Payment verified and booking created successfully', {
      booking: populatedBooking,
      payment: {
        id: paymentId || 'dummy_payment_' + Date.now(),
        status: 'completed',
        amount: amount,
        currency: 'INR',
      },
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Payment verification error:', error);
    sendResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, false, 'Payment verification failed');
  } finally {
    session.endSession();
  }
}));

// Get payment status (dummy)
router.get('/status/:paymentId', asyncHandler(async (req, res) => {
  const { paymentId } = req.params;

  sendResponse(res, HTTP_STATUS.OK, true, 'Payment details fetched', {
    payment: {
      id: paymentId,
      status: 'completed',
      method: 'dummy',
      amount: 0,
      currency: 'INR',
    },
  });
}));

// Request refund for cancelled booking (dummy - auto approve)
router.post('/refund/:bookingId', asyncHandler(async (req, res) => {
  const { bookingId } = req.params;
  const userId = req.user.id;

  const booking = await Booking.findOne({ _id: bookingId, userId });

  if (!booking) {
    return sendResponse(res, HTTP_STATUS.NOT_FOUND, false, 'Booking not found');
  }

  if (booking.status !== 'cancelled') {
    return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Only cancelled bookings can be refunded');
  }

  if (booking.payment.status === 'refunded') {
    return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Booking already refunded');
  }

  if (!booking.payment.paymentId) {
    return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'No payment found for this booking');
  }

  // Dummy refund - automatically approve
  booking.payment.status = 'refunded';
  await booking.save();

  sendResponse(res, HTTP_STATUS.OK, true, 'Refund processed successfully', {
    refund: {
      id: 'refund_dummy_' + Date.now(),
      amount: booking.payment.amount,
      currency: 'INR',
      status: 'processed',
    },
    booking: {
      id: booking._id,
      reference: booking.bookingReference,
      paymentStatus: booking.payment.status,
    },
  });
}));

export default router;
