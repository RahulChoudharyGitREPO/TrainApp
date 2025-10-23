import express from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Train from '../models/Train.js';
import Booking from '../models/Booking.js';
import { authenticate } from '../middleware/auth.js';
import { validateBooking } from '../lib/validation.js';
import { sendBookingConfirmation } from '../lib/email.js';
import { generateBookingPDF, sendResponse, asyncHandler } from '../utils/helpers.js';
import { HTTP_STATUS, MESSAGES } from '../utils/constants.js';

const router = express.Router();

router.use(authenticate);

router.get('/', asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status } = req.query;
  const userId = req.user.id;

  const query = { userId };
  if (status) query.status = status;

  const bookings = await Booking.find(query)
    .populate({
      path: 'trainId',
      select: 'trainName trainNumber origin destination departureTime arrivalTime',
    })
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await Booking.countDocuments(query);

  const bookingsWithDetails = bookings.map(booking => {
    const bookingObj = booking.toObject();
    const train = bookingObj.trainId;
    
    if (train) {
      const duration = new Date(train.arrivalTime) - new Date(train.departureTime);
      const hours = Math.floor(duration / (1000 * 60 * 60));
      const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
      
      bookingObj.trainId = {
        ...train,
        duration: `${hours}h ${minutes}m`,
      };
    }
    
    return bookingObj;
  });

  sendResponse(res, HTTP_STATUS.OK, true, 'Bookings fetched successfully', {
    bookings: bookingsWithDetails,
    pagination: {
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      totalBookings: total,
      hasNext: page < Math.ceil(total / limit),
      hasPrev: page > 1,
    },
  });
}));

router.get('/:bookingId', asyncHandler(async (req, res) => {
  const { bookingId } = req.params;
  const userId = req.user.id;

  const booking = await Booking.findOne({ _id: bookingId, userId })
    .populate({
      path: 'trainId',
      select: 'trainName trainNumber origin destination departureTime arrivalTime totalSeats',
    })
    .populate({
      path: 'userId',
      select: 'name email mobile',
    });

  if (!booking) {
    return sendResponse(res, HTTP_STATUS.NOT_FOUND, false, 'Booking not found');
  }

  const bookingObj = booking.toObject();
  const train = bookingObj.trainId;
  
  if (train) {
    const duration = new Date(train.arrivalTime) - new Date(train.departureTime);
    const hours = Math.floor(duration / (1000 * 60 * 60));
    const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
    
    bookingObj.trainId = {
      ...train,
      duration: `${hours}h ${minutes}m`,
    };
  }

  sendResponse(res, HTTP_STATUS.OK, true, 'Booking details fetched successfully', bookingObj);
}));

router.post('/', asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { error } = validateBooking(req.body);
    if (error) {
      await session.abortTransaction();
      return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, error.details[0].message);
    }

    const { trainId, passengers } = req.body;
    const userId = req.user.id;
    const totalSeatsBooked = passengers.length;

    const train = await Train.findById(trainId).session(session);
    if (!train) {
      await session.abortTransaction();
      return sendResponse(res, HTTP_STATUS.NOT_FOUND, false, MESSAGES.TRAIN_NOT_FOUND);
    }

    if (train.availableSeats < totalSeatsBooked) {
      await session.abortTransaction();
      return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, MESSAGES.INSUFFICIENT_SEATS);
    }

    if (train.status !== 'active') {
      await session.abortTransaction();
      return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Train is not available for booking');
    }

    if (new Date(train.departureTime) <= new Date()) {
      await session.abortTransaction();
      return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Cannot book past or ongoing trains');
    }

    const booking = new Booking({
      userId,
      trainId,
      passengers,
      totalSeatsBooked,
    });

    await booking.save({ session });

    train.availableSeats -= totalSeatsBooked;
    await train.save({ session });

    await session.commitTransaction();

    // Emit real-time seat update via WebSocket
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

    const populatedBooking = await Booking.findById(booking._id)
      .populate({
        path: 'trainId',
        select: 'trainName trainNumber origin destination departureTime arrivalTime',
      })
      .populate({
        path: 'userId',
        select: 'name email mobile',
      });

    // Generate PDF ticket
    const ticketData = await generateBookingPDF({
      booking: populatedBooking,
      train: populatedBooking.trainId,
      user: req.user,
    });

    // Send confirmation email with PDF attachment
    try {
      await sendBookingConfirmation(req.user.email, {
        booking: populatedBooking,
        train: populatedBooking.trainId,
        user: req.user,
      }, ticketData);
    } catch (emailError) {
      console.error('Email send error:', emailError);
    }

    sendResponse(res, HTTP_STATUS.CREATED, true, MESSAGES.BOOKING_SUCCESS, {
      booking: populatedBooking,
      ticket: {
        reference: ticketData.reference,
        bookingId: ticketData.bookingId,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Create booking error:', error);
    sendResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, false, 'Server error');
  } finally {
    session.endSession();
  }
}));

router.post('/verify-ticket', asyncHandler(async (req, res) => {
  const { bookingReference, qrData } = req.body;

  if (!bookingReference && !qrData) {
    return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Booking reference or QR data required');
  }

  let searchQuery = {};

  if (qrData) {
    try {
      const parsedData = JSON.parse(qrData);
      searchQuery = { bookingReference: parsedData.reference };
    } catch (error) {
      return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Invalid QR data');
    }
  } else {
    searchQuery = { bookingReference };
  }

  const booking = await Booking.findOne(searchQuery)
    .populate({
      path: 'trainId',
      select: 'trainName trainNumber origin destination departureTime arrivalTime',
    })
    .populate({
      path: 'userId',
      select: 'name email mobile',
    });

  if (!booking) {
    return sendResponse(res, HTTP_STATUS.NOT_FOUND, false, 'Ticket not found');
  }

  const isValid = booking.status === 'confirmed';
  const train = booking.trainId;
  const departureTime = new Date(train.departureTime);
  const now = new Date();
  const hasExpired = departureTime < now;

  sendResponse(res, HTTP_STATUS.OK, true, 'Ticket verified', {
    valid: isValid && !hasExpired,
    booking: {
      reference: booking.bookingReference,
      status: booking.status,
      passengers: booking.totalSeatsBooked,
      bookingTime: booking.createdAt,
    },
    train: {
      name: train.trainName,
      number: train.trainNumber,
      route: `${train.origin} → ${train.destination}`,
      departure: train.departureTime,
      arrival: train.arrivalTime,
    },
    passenger: {
      name: booking.userId.name,
      email: booking.userId.email,
    },
    expired: hasExpired,
  });
}));

router.get('/:bookingId/download-ticket', asyncHandler(async (req, res) => {
  const { bookingId } = req.params;
  const userId = req.user.id;

  const booking = await Booking.findOne({ _id: bookingId, userId })
    .populate({
      path: 'trainId',
      select: 'trainName trainNumber origin destination departureTime arrivalTime',
    })
    .populate({
      path: 'userId',
      select: 'name email mobile',
    });

  if (!booking) {
    return sendResponse(res, HTTP_STATUS.NOT_FOUND, false, 'Booking not found');
  }

  if (!booking.trainId) {
    return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Train information not found for this booking');
  }

  // Generate PDF ticket
  const ticketData = await generateBookingPDF({
    booking: booking,
    train: booking.trainId,
    user: booking.userId,
  });

  // Set headers for PDF download
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="ticket-${booking.bookingReference}.pdf"`);

  // Send the PDF buffer
  res.send(ticketData.buffer);
}));

router.put('/:bookingId/cancel', asyncHandler(async (req, res) => {
  const { bookingId } = req.params;
  const userId = req.user.id;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const booking = await Booking.findOne({ _id: bookingId, userId }).session(session);

    if (!booking) {
      await session.abortTransaction();
      return sendResponse(res, HTTP_STATUS.NOT_FOUND, false, 'Booking not found');
    }

    if (booking.status === 'cancelled') {
      await session.abortTransaction();
      return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Booking is already cancelled');
    }

    if (booking.status === 'completed') {
      await session.abortTransaction();
      return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Cannot cancel completed booking');
    }

    // Find associated train
    const train = await Train.findById(booking.trainId).session(session);
    if (!train) {
      await session.abortTransaction();
      return sendResponse(res, HTTP_STATUS.NOT_FOUND, false, 'Associated train not found');
    }

    const departureTime = new Date(train.departureTime);
    const now = new Date();
    const timeDifference = departureTime.getTime() - now.getTime();
    const hoursDifference = timeDifference / (1000 * 3600);

    if (hoursDifference < 2) {
      await session.abortTransaction();
      return sendResponse(res, HTTP_STATUS.BAD_REQUEST, false, 'Cannot cancel booking within 2 hours of departure');
    }

    booking.status = 'cancelled';
    await booking.save({ session });

    // Restore class-specific seats if classType exists
    if (booking.classType) {
      const bookedClass = train.classes.find(cls => cls.type === booking.classType);
      if (bookedClass) {
        bookedClass.availableSeats += booking.totalSeatsBooked;
      }
    }

    // Restore general train seats
    train.availableSeats += booking.totalSeatsBooked;
    await train.save({ session });

    await session.commitTransaction();

    // Emit real-time seat update via WebSocket
    const io = req.app.get('io');
    if (io) {
      io.to(`train-${booking.trainId}`).emit('seat-update', {
        trainId: train._id,
        availableSeats: train.availableSeats,
        totalSeats: train.totalSeats,
        occupancyPercentage: ((train.totalSeats - train.availableSeats) / train.totalSeats * 100).toFixed(1),
        action: 'cancellation',
      });
    }

    sendResponse(res, HTTP_STATUS.OK, true, 'Booking cancelled successfully');
  } catch (error) {
    await session.abortTransaction();
    console.error('Cancel booking error:', error);
    sendResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, false, 'Server error');
  } finally {
    session.endSession();
  }
}));

export default router;