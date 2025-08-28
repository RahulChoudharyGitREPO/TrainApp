// routes/admin/trains.js
import express from "express";
import Train from "../models/Train.js";
import { authenticate } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";
import { validateTrain } from "../lib/validation.js";
import { HTTP_STATUS, MESSAGES } from "../utils/constants.js";
import { sendResponse, asyncHandler } from "../utils/helpers.js";

const router = express.Router();

router.use(authenticate);
router.use(requireAdmin);

router.get(
  "/trains",
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 10, search, origin, destination, status } =
      req.query;

    const query = {};
    if (search) {
      query.$or = [
        { trainName: { $regex: search, $options: "i" } },
        { trainNumber: { $regex: search, $options: "i" } },
      ];
    }
    if (origin) query.origin = { $regex: origin, $options: "i" };
    if (destination) query.destination = { $regex: destination, $options: "i" };
    if (status) query.status = status;

    const trains = await Train.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Train.countDocuments(query);

    sendResponse(res, HTTP_STATUS.OK, true, "Trains fetched successfully", {
      trains,
      pagination: {
        totalPages: Math.ceil(total / limit),
        currentPage: parseInt(page),
        totalTrains: total,
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
    });
  })
);

router.post(
  "/trains",
  asyncHandler(async (req, res) => {
    const { error } = validateTrain(req.body);
    if (error) {
      return sendResponse(
        res,
        HTTP_STATUS.BAD_REQUEST,
        false,
        error.details[0].message
      );
    }

    const {
      trainName,
      trainNumber,
      origin,
      destination,
      departureTime,
      arrivalTime,
      seats,
    } = req.body;

    const existingTrain = await Train.findOne({
      trainNumber: trainNumber.toUpperCase(),
    });
    if (existingTrain) {
      return sendResponse(
        res,
        HTTP_STATUS.CONFLICT,
        false,
        "Train number already exists"
      );
    }

    const train = new Train({
      trainName,
      trainNumber: trainNumber.toUpperCase(),
      origin,
      destination,
      departureTime: new Date(departureTime),
      arrivalTime: new Date(arrivalTime),
      totalSeats: seats,
      availableSeats: seats,
    });

    await train.save();
    sendResponse(res, HTTP_STATUS.CREATED, true, "Train created successfully", train);
  })
);

router.put(
  "/trains/:trainId",
  asyncHandler(async (req, res) => {
    const { trainId } = req.params;

    const { error } = validateTrain(req.body);
    if (error) {
      return sendResponse(
        res,
        HTTP_STATUS.BAD_REQUEST,
        false,
        error.details[0].message
      );
    }

    const train = await Train.findById(trainId);
    if (!train) {
      return sendResponse(
        res,
        HTTP_STATUS.NOT_FOUND,
        false,
        MESSAGES.TRAIN_NOT_FOUND
      );
    }

    const {
      trainName,
      trainNumber,
      origin,
      destination,
      departureTime,
      arrivalTime,
      seats,
    } = req.body;

    if (trainNumber.toUpperCase() !== train.trainNumber) {
      const existingTrain = await Train.findOne({
        trainNumber: trainNumber.toUpperCase(),
      });
      if (existingTrain) {
        return sendResponse(
          res,
          HTTP_STATUS.CONFLICT,
          false,
          "Train number already exists"
        );
      }
    }

    // Update available seats if total seats changed
    const seatDifference = seats - train.totalSeats;
    const newAvailableSeats = train.availableSeats + seatDifference;

    if (newAvailableSeats < 0) {
      return sendResponse(
        res,
        HTTP_STATUS.BAD_REQUEST,
        false,
        "Cannot reduce seats below booked seats"
      );
    }

    const updatedTrain = await Train.findByIdAndUpdate(
      trainId,
      {
        trainName,
        trainNumber: trainNumber.toUpperCase(),
        origin,
        destination,
        departureTime: new Date(departureTime),
        arrivalTime: new Date(arrivalTime),
        totalSeats: seats,
        availableSeats: newAvailableSeats,
      },
      { new: true }
    );

    sendResponse(res, HTTP_STATUS.OK, true, "Train updated successfully", updatedTrain);
  })
);

router.delete(
  "/trains/:trainId",
  asyncHandler(async (req, res) => {
    const { trainId } = req.params;

    const train = await Train.findById(trainId);
    if (!train) {
      return sendResponse(
        res,
        HTTP_STATUS.NOT_FOUND,
        false,
        MESSAGES.TRAIN_NOT_FOUND
      );
    }

    await Train.findByIdAndDelete(trainId);
    sendResponse(res, HTTP_STATUS.OK, true, "Train deleted successfully");
  })
);

router.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const totalTrains = await Train.countDocuments();
    const activeTrains = await Train.countDocuments({ status: "active" });
    const inactiveTrains = await Train.countDocuments({ status: "inactive" });
    const cancelledTrains = await Train.countDocuments({ status: "cancelled" });

    const totalSeats = await Train.aggregate([
      { $group: { _id: null, total: { $sum: "$totalSeats" } } },
    ]);

    const availableSeats = await Train.aggregate([
      { $group: { _id: null, total: { $sum: "$availableSeats" } } },
    ]);

    sendResponse(res, HTTP_STATUS.OK, true, "Dashboard stats fetched successfully", {
      trains: {
        total: totalTrains,
        active: activeTrains,
        inactive: inactiveTrains,
        cancelled: cancelledTrains,
      },
      seats: {
        total: totalSeats[0]?.total || 0,
        available: availableSeats[0]?.total || 0,
        booked:
          (totalSeats[0]?.total || 0) - (availableSeats[0]?.total || 0),
      },
    });
  })
);

export default router;
