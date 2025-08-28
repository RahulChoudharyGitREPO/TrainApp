// routes/trains.js
import express from "express";
import Train from "../models/Train.js";
import { HTTP_STATUS } from "../utils/constants.js";
import { sendResponse, asyncHandler } from "../utils/helpers.js";

const router = express.Router();

router.get("/all", asyncHandler(async (req, res) => {
  try {
    const trains = await Train.find({ status: "active" })
      .sort({ departureTime: 1 })
      .limit(50); 

    const trainsWithDetails = trains.map(train => {
      const duration = new Date(train.arrivalTime) - new Date(train.departureTime);
      const hours = Math.floor(duration / (1000 * 60 * 60));
      const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));

      return {
        ...train.toObject(),
        duration: `${hours}h ${minutes}m`,
        durationInMinutes: Math.floor(duration / (1000 * 60)),
        price: calculatePrice(train, hours),
        occupancyPercentage: (
          ((train.totalSeats - train.availableSeats) / train.totalSeats) * 100
        ).toFixed(1),
      };
    });

    sendResponse(
      res,
      HTTP_STATUS.OK,
      true,
      "All trains fetched successfully",
      {
        trains: trainsWithDetails,
        totalCount: trainsWithDetails.length,
      }
    );
  } catch (error) {
    console.error("Error fetching all trains:", error);
    sendResponse(
      res,
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      false,
      "Failed to fetch trains"
    );
  }
}));

router.get("/", async (req, res) => {
  try {
    const origin = req.query.origin || req.query.from;
    const destination = req.query.destination || req.query.to;
    // const date = req.query.date; 

    if (!origin || !destination) {
      return res.status(400).json({
        success: false,
        message: "origin and destination are required",
      });
    }

    const trains = await Train.find({
      origin,
      destination,
      status: "active",
    }).sort({ departureTime: 1 });

    res.json({
      success: true,
      message: "Trains fetched successfully",
      data: {
        trains,
        pagination: {
          totalPages: 1,
          currentPage: 1,
          totalTrains: trains.length,
          hasNext: false,
          hasPrev: false,
        },
        filters: { origin, destination },
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get(
  "/:trainId",
  asyncHandler(async (req, res) => {
    const { trainId } = req.params;

    const train = await Train.findById(trainId);

    if (!train) {
      return sendResponse(res, HTTP_STATUS.NOT_FOUND, false, "Train not found");
    }

    const duration = new Date(train.arrivalTime) - new Date(train.departureTime);
    const hours = Math.floor(duration / (1000 * 60 * 60));
    const minutes = Math.floor(
      (duration % (1000 * 60 * 60)) / (1000 * 60)
    );

    const trainWithDetails = {
      ...train.toObject(),
      duration: `${hours}h ${minutes}m`,
      durationInMinutes: Math.floor(duration / (1000 * 60)),
      price: calculatePrice(train, hours),
      occupancyPercentage: (
        ((train.totalSeats - train.availableSeats) / train.totalSeats) *
        100
      ).toFixed(1),
    };

    sendResponse(
      res,
      HTTP_STATUS.OK,
      true,
      "Train details fetched successfully",
      trainWithDetails
    );
  })
);

router.get(
  "/search/routes",
  asyncHandler(async (req, res) => {
    const origins = await Train.distinct("origin", { status: "active" });
    const destinations = await Train.distinct("destination", { status: "active" });

    const popularRoutes = await Train.aggregate([
      { $match: { status: "active" } },
      {
        $group: {
          _id: { origin: "$origin", destination: "$destination" },
          count: { $sum: 1 },
          trains: { $addToSet: "$trainName" },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
      {
        $project: {
          _id: 0,
          origin: "$_id.origin",
          destination: "$_id.destination",
          trainCount: "$count",
          availableTrains: "$trains",
        },
      },
    ]);

    sendResponse(res, HTTP_STATUS.OK, true, "Routes fetched successfully", {
      origins: origins.sort(),
      destinations: destinations.sort(),
      popularRoutes,
    });
  })
);

function calculatePrice(train, durationHours) {
  const basePrice = 100;
  const hourlyRate = 50;
  const distanceMultiplier = 1.2;

  let price = basePrice + durationHours * hourlyRate;

  const popularOrigins = ["Mumbai", "Delhi", "Bangalore", "Chennai"];
  const popularDestinations = ["Mumbai", "Delhi", "Bangalore", "Chennai"];

  if (
    popularOrigins.includes(train.origin) ||
    popularDestinations.includes(train.destination)
  ) {
    price *= distanceMultiplier;
  }

  return Math.round(price);
}

export default router;