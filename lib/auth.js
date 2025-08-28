import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const JWT_SECRET = "gdteyhjuwrtyharyhdcfbrritshfyry"



export const hashPassword = async (password) => {
  return await bcrypt.hash(password, 12);
};

export const comparePassword = async (password, hashedPassword) => {
  return await bcrypt.compare(password, hashedPassword);
};

export const generateToken = (payload) => {

 if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not defined in .env");
  }


  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
};

export const verifyToken = (token) => {
  console.log(token);
  try {
    return jwt.verify(token, JWT_SECRET);
   
  } catch (error) {
    throw new Error('Invalid token');
  }
};

export const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};
