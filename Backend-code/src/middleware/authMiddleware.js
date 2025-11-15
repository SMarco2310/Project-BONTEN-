import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

// General auth check
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.sendStatus(401);

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // contains id & role
    next();
  } catch (err) {
    return res.sendStatus(403);
  }
};

// // Admin-only check
// const authorizeAdmin = (req, res, next) => {
//   if (req.user.role !== "ADMIN") return res.sendStatus(403);
//   next();
// };

export default authenticate;