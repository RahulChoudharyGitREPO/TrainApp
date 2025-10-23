// routes/trains.js
import express from "express";
import Train from "../models/Train.js";
import { HTTP_STATUS } from "../utils/constants.js";
import { sendResponse, asyncHandler } from "../utils/helpers.js";
import { cacheMiddleware } from "../middleware/cache.js";

const router = express.Router();

router.get("/all", cacheMiddleware(300), asyncHandler(async (req, res) => {
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
    //test comment

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

router.get("/", cacheMiddleware(180), async (req, res) => {
  try {
    const origin = req.query.origin || req.query.from;
    const destination = req.query.destination || req.query.to;
    const date = req.query.date;
    const classType = req.query.class;
    const minPrice = req.query.minPrice ? parseFloat(req.query.minPrice) : null;
    const maxPrice = req.query.maxPrice ? parseFloat(req.query.maxPrice) : null;
    const sortBy = req.query.sortBy || 'departureTime'; // departureTime, price, duration
    const sortOrder = req.query.sortOrder === 'desc' ? -1 : 1;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    if (!origin || !destination) {
      return res.status(400).json({
        success: false,
        message: "origin and destination are required",
      });
    }

    // Build query
    const query = {
      origin,
      destination,
      status: "active",
    };

    // Date range filter
    if (date) {
      const searchDate = new Date(date);
      const nextDay = new Date(searchDate);
      nextDay.setDate(nextDay.getDate() + 1);

      query.departureTime = {
        $gte: searchDate,
        $lt: nextDay,
      };
    } else {
      // Only show future trains by default
      query.departureTime = { $gte: new Date() };
    }

    // Class filter
    if (classType) {
      query['classes.type'] = classType;
      query['classes.availableSeats'] = { $gt: 0 };
    }

    // Fetch trains
    let trains = await Train.find(query);

    // Calculate details and apply price filters
    const trainsWithDetails = trains.map(train => {
      const duration = new Date(train.arrivalTime) - new Date(train.departureTime);
      const hours = Math.floor(duration / (1000 * 60 * 60));
      const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
      const price = calculatePrice(train, hours);

      return {
        ...train.toObject(),
        duration: `${hours}h ${minutes}m`,
        durationInMinutes: Math.floor(duration / (1000 * 60)),
        price,
        occupancyPercentage: (
          ((train.totalSeats - train.availableSeats) / train.totalSeats) * 100
        ).toFixed(1),
      };
    }).filter(train => {
      // Apply price range filter after calculation
      if (minPrice !== null && train.price < minPrice) return false;
      if (maxPrice !== null && train.price > maxPrice) return false;
      return true;
    });

    // Sort trains
    trainsWithDetails.sort((a, b) => {
      if (sortBy === 'price') {
        return sortOrder === 1 ? a.price - b.price : b.price - a.price;
      } else if (sortBy === 'duration') {
        return sortOrder === 1
          ? a.durationInMinutes - b.durationInMinutes
          : b.durationInMinutes - a.durationInMinutes;
      } else {
        // departureTime
        const dateA = new Date(a.departureTime);
        const dateB = new Date(b.departureTime);
        return sortOrder === 1 ? dateA - dateB : dateB - dateA;
      }
    });

    // Pagination
    const total = trainsWithDetails.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedTrains = trainsWithDetails.slice(startIndex, endIndex);

    res.json({
      success: true,
      message: "Trains fetched successfully",
      data: {
        trains: paginatedTrains,
        pagination: {
          totalPages: Math.ceil(total / limit),
          currentPage: page,
          totalTrains: total,
          hasNext: endIndex < total,
          hasPrev: page > 1,
        },
        filters: {
          origin,
          destination,
          date,
          class: classType,
          minPrice,
          maxPrice,
          sortBy,
          sortOrder: sortOrder === 1 ? 'asc' : 'desc'
        },
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