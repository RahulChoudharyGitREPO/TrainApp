import mongoose from "mongoose";

const TrainSchema = new mongoose.Schema(
  {
    trainName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    trainNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    origin: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 50,
    },
    destination: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 50,
    },
    departureTime: {
      type: Date,
      required: true,
    },
    arrivalTime: {
      type: Date,
      required: true,
    },
    totalSeats: {
      type: Number,
      required: true,
      min: 1,
      max: 1000,
    },
    availableSeats: {
      type: Number,
      required: true,
      min: 0,
    },
    image: {
      type: String,
      default: 'https://images.unsplash.com/photo-1474487548417-781cb71495f3?w=800',
    },
    classes: [{
      type: {
        type: String,
        enum: ["AC", "Non-AC", "Sleeper", "Seater", "First Class", "Second Class", "AC Chair Car", "Executive Class"],
      },
      price: {
        type: Number,
        required: true,
        min: 0,
      },
      totalSeats: {
        type: Number,
        min: 0,
      },
      availableSeats: {
        type: Number,
        min: 0,
      },
      priceMultiplier: {
        type: Number,
        default: 1,
      }
    }],
    amenities: [{
      type: String,
      enum: ["WiFi", "Food", "Charging", "Entertainment", "Blanket", "Pillow"]
    }],
    status: {
      type: String,
      enum: ["active", "inactive", "cancelled"],
      default: "active",
    },
  },
  { timestamps: true }
);



TrainSchema.pre("save", function (next) {
  if (this.isNew) {
    this.availableSeats = this.totalSeats;
  }
  next();
});

export default mongoose.models.Train || mongoose.model("Train", TrainSchema);
