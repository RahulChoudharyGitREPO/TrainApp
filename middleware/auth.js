// middleware/authenticate.js
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { HTTP_STATUS } from "../utils/constants.js";

const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        message: "Access denied. No token provided.",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.userId).select("-password -otp");

    if (!user) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        message: "Invalid token. User not found.",
      });
    }

    if (!user.verified) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        message: "Account not verified. Please verify your mobile number.",
      });
    }

    req.user = {
      id: user._id,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      role: user.role,
      verified: user.verified,
    };

    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        message: "Invalid token format.",
      });
    }

    if (error.name === "TokenExpiredError") {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        message: "Token has expired.",
      });
    }

    console.error("Authentication error:", error);
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      message: "Authentication failed.",
    });
  }
};

export { authenticate };
