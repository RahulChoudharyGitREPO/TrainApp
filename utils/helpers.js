
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export const sendResponse = (res, statusCode, success, message, data = null) => {
  return res.status(statusCode).json({
    success,
    message,
    data,
  });
};

export const generateBookingPDF = (bookingDetails) => {
  return {
    bookingId: bookingDetails.booking._id,
    reference: bookingDetails.booking.bookingReference,
    train: bookingDetails.train,
    passengers: bookingDetails.booking.passengers,
    timestamp: new Date().toISOString(),
  };
};