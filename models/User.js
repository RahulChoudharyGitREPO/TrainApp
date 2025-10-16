import mongoose from "mongoose";
const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 50,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    mobile: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
    },
    verified: {
      type: Boolean,
      default: false,
    },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
    otp: {
      code: String,
      expiresAt: Date,
    },
    resetPasswordToken: {
      type: String,
    },
    resetPasswordExpires: {
      type: Date,
    },
    profilePicture: {
      url: String,
      publicId: String,
    },
    savedPassengers: [{
      name: {
        type: String,
        required: true,
        trim: true,
      },
      age: {
        type: Number,
        required: true,
        min: 1,
        max: 120,
      },
      relation: {
        type: String,
        enum: ["Self", "Spouse", "Child", "Parent", "Friend", "Other"],
      }
    }],
    favoriteRoutes: [{
      origin: String,
      destination: String,
      addedAt: {
        type: Date,
        default: Date.now,
      }
    }],
  },
  {
    timestamps: true,
  }
);

const User = mongoose.models.User || mongoose.model("User", UserSchema);

export default User;