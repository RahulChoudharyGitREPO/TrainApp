import Joi from 'joi';

export const validateSignup = (data) => {
  const schema = Joi.object({
    name: Joi.string().min(2).max(50).required(),
    email: Joi.string().email().required(),
    mobile: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).required(),
    password: Joi.string().min(6).required(),
  });
  return schema.validate(data);
};

export const validateLogin = (data) => {
  const schema = Joi.object({
    mobile: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).required(),
    password: Joi.string().required(),
  });
  return schema.validate(data);
};

export const validateOTP = (data) => {
  const schema = Joi.object({
    mobile: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).required(),
    otp: Joi.string().length(6).required(),
  });
  return schema.validate(data);
};

export const validateTrain = (data) => {
  const schema = Joi.object({
    trainName: Joi.string().min(2).max(100).required(),
    trainNumber: Joi.string().min(2).max(20).required(),
    origin: Joi.string().min(2).max(50).required(),
    destination: Joi.string().min(2).max(50).required(),
    departureTime: Joi.date().iso().required(),
    arrivalTime: Joi.date().iso().greater(Joi.ref('departureTime')).required(),
    seats: Joi.number().integer().min(1).max(1000).required(),
  });
  return schema.validate(data);
};

export const validateBooking = (data) => {
  const schema = Joi.object({
    trainId: Joi.string().hex().length(24).required(),
    passengers: Joi.array().items(
      Joi.object({
        name: Joi.string().min(2).max(50).required(),
        age: Joi.number().integer().min(1).max(120).required(),
      })
    ).min(1).max(10).required(),
  });
  return schema.validate(data);
};

export const validateForgotPassword = (data) => {
  const schema = Joi.object({
    email: Joi.string().email().required(),
  });
  return schema.validate(data);
};

export const validateResetPassword = (data) => {
  const schema = Joi.object({
    token: Joi.string().required(),
    newPassword: Joi.string().min(6).required(),
  });
  return schema.validate(data);
};