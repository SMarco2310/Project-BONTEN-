import express from "express";
import {
  initializePayment,
  verifyPayment,
  paystackWebhook,
} from "./paymentController.js";

const router = express.Router();

router.post("/initialize", initializePayment);
router.get("/verify/:reference", verifyPayment);
router.post("/webhook", express.json({ type: "*/*" }), paystackWebhook);

export default router;
