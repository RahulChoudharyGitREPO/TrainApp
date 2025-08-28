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

    const populatedBooking = await Booking.findById(booking._id)
      .populate({
        path: 'trainId',
        select: 'trainName trainNumber origin destination departureTime arrivalTime',
      })
      .populate({
        path: 'userId',
        select: 'name email mobile',
      });

    try {
      await sendBookingConfirmation(req.user.email, {
        booking: populatedBooking,
        train: populatedBooking.trainId,
        user: req.user,
      });
    } catch (emailError) {
      console.error('Email send error:', emailError);
    }

    const ticketData = generateBookingPDF({
      booking: populatedBooking,
      train: populatedBooking.trainId,
      user: req.user,
    });

    sendResponse(res, HTTP_STATUS.CREATED, true, MESSAGES.BOOKING_SUCCESS, {
      booking: populatedBooking,
      ticket: ticketData,
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('Create booking error:', error);
    sendResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, false, 'Server error');
  } finally {
    session.endSession();
  }
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

    train.availableSeats += booking.totalSeatsBooked;
    await train.save({ session });

    await session.commitTransaction();

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