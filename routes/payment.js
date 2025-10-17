import express from 'express';
import mongoose from 'mongoose';
import { authenticate } from '../middleware/auth.js';
import { sendResponse, asyncHandler } from '../utils/helpers.js';
import { HTTP_STATUS } from '../utils/constants.js';
import { createRazorpayOrder, verifyRazorpaySignature, getPaymentDetails, refundPayment } from '../lib/razorpay.js';
import Booking from '../models/Booking.js';
import Train from '../models/Train.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Get Razorpay key for frontend
router.get('/config', asyncHandler(async (req, res) => {
  sendResponse(res, HTTP_STATUS.OK, true, 'Razorpay config fetched', {
    keyId: process.env.RAZORPAY_KEY_ID,
  });
}));

// Create Razorpay order for booking
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

  // Create Razorpay order
  const orderResult = await createRazorpayOrder(totalAmount, 'INR', bookingReference);

  if (!orderResult.success) {
    return sendResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, false, 'Failed to create payment order');
  }

  // Store order details temporarily (you might want to create a pending booking)
  sendResponse(res, HTTP_STATUS.OK, true, 'Payment order created successfully', {
    orderId: orderResult.order.id,
    amount: totalAmount, // Total calculated amount in rupees
    pricePerTicket: pricePerTicket,
    classType: classType,
    numberOfPassengers: passengers.length,
    currency: orderResult.order.currency,
    bookingReference,
    keyId: process.env.RAZORPAY_KEY_ID,
  });
}));

// Verify payment and create booking
router.post('/verify-payment', asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      trainId,
      passengers,
      amount,
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      await session.abortTransaction();
      return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Payment verification details are required');
    }

    // Verify signature
    const isValidSignature = verifyRazorpaySignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    );

    if (!isValidSignature) {
      await session.abortTransaction();
      return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Invalid payment signature');
    }

    // Get payment details from Razorpay
    const paymentDetailsResult = await getPaymentDetails(razorpay_payment_id);

    if (!paymentDetailsResult.success) {
      await session.abortTransaction();
      return sendResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, false, 'Failed to fetch payment details');
    }

    const paymentDetails = paymentDetailsResult.payment;

    // Verify payment status
    if (paymentDetails.status !== 'captured' && paymentDetails.status !== 'authorized') {
      await session.abortTransaction();
      return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Payment not successful');
    }

    // Verify train and seats
    const train = await Train.findById(trainId).session(session);
    if (!train) {
      await session.abortTransaction();
      return sendResponse(res, HTTP_STATUS.NOT_FOUND, false, 'Train not found');
    }

    const totalSeatsBooked = passengers.length;

    if (train.availableSeats < totalSeatsBooked) {
      await session.abortTransaction();
      return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Insufficient seats available');
    }

    if (train.status !== 'active') {
      await session.abortTransaction();
      return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Train is not available for booking');
    }

    if (new Date(train.departureTime) <= new Date()) {
      await session.abortTransaction();
      return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Cannot book past or ongoing trains');
    }

    // Create booking with payment details
    const booking = new Booking({
      userId: req.user.id,
      trainId,
      passengers,
      totalSeatsBooked,
      payment: {
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
        amount: amount,
        currency: paymentDetails.currency,
        status: 'completed',
        method: paymentDetails.method,
        paidAt: new Date(paymentDetails.created_at * 1000),
      },
    });

    await booking.save({ session });

    // Update train seats
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
        user: req.user,
      });

      await sendBookingConfirmation(
        req.user.email,
        {
          booking: populatedBooking,
          train: populatedBooking.trainId,
          user: req.user,
        },
        ticketData
      );
    } catch (emailError) {
      console.error('Email send error:', emailError);
    }

    sendResponse(res, HTTP_STATUS.CREATED, true, 'Payment verified and booking created successfully', {
      booking: populatedBooking,
      payment: {
        id: razorpay_payment_id,
        status: 'completed',
        amount: amount,
        currency: paymentDetails.currency,
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

// Get payment status
router.get('/status/:paymentId', asyncHandler(async (req, res) => {
  const { paymentId } = req.params;

  const paymentResult = await getPaymentDetails(paymentId);

  if (!paymentResult.success) {
    return sendResponse(res, HTTP_STATUS.NOT_FOUND, false, 'Payment not found');
  }

  sendResponse(res, HTTP_STATUS.OK, true, 'Payment details fetched', {
    payment: paymentResult.payment,
  });
}));

// Request refund for cancelled booking
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

  // Process refund
  const refundResult = await refundPayment(booking.payment.paymentId, booking.payment.amount);

  if (!refundResult.success) {
    return sendResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, false, 'Refund processing failed');
  }

  // Update booking payment status
  booking.payment.status = 'refunded';
  await booking.save();

  sendResponse(res, HTTP_STATUS.OK, true, 'Refund processed successfully', {
    refund: refundResult.refund,
    booking: {
      id: booking._id,
      reference: booking.bookingReference,
      paymentStatus: booking.payment.status,
    },
  });
}));

export default router;
