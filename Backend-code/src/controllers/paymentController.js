import axios from "axios";
import prisma from "../config/prismaClient.js";
import sendEmail from "../utils/sendEmail.js";

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

// 1️⃣ Initialize Payment
// Initialize Payment
export const initializePayment = async (req, res) => {
  try {
    const { email, amount, bookingId } = req.body;

    // Validate input
    if (!email || !amount || !bookingId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email,
        amount: amount * 100, // pesewas
        callback_url: `${process.env.CLIENT_URL}/payment-success`,
        metadata: { bookingId },
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET}`,
          "Content-Type": "application/json",
        },
      },
    );

    res.json({
      ok: true,
      // authorizationUrl: response.data.data.authorization_url,
      // accessCode: response.data.data.access_code,
      reference: response.data.data.reference,
    });
  } catch (err) {
    console.error("Payment init error:", err.response?.data || err.message);
    console.log(err);
    res.status(500).json({ error: "Payment initialization failed" });
  }
};

// Verify Payment - Fixed to match frontend call
export const verifyPayment = async (req, res) => {
  try {
    const { reference } = req.params; // Getting from URL params

    if (!reference) {
      console.error("Missing required fields");
      return res.status(400).json({ error: "Reference is required" });
    }

    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
      },
    );

    const data = response.data;
    if (data.status && data.data.status === "success") {
      // Update booking status to confirm
      const bookingId = data.data.metadata.bookingId;

      if (bookingId) {
        try {
          await prisma.booking.update({
            where: { id: parseInt(bookingId) },
            data: { status: "CONFIRMED" },
          });
        } catch (updateError) {
          console.log(updateError);
          console.error("Error updating booking status:", updateError);
        }
      }

      return res.json({ status: "success" });
    } else {
      // await prisma.booking.delete(
      //     {where:{id: parseInt(bookingId)}}
      // );
      return res.json({ status: "failed" });
    }
  } catch (err) {
    console.error(
      "Payment verification error:",
      err.response?.data || err.message,
    );
    console.log(err);
    res.status(500).json({ error: "Payment verification failed" });
  }
};

// 3️⃣ Paystack Webhook (secure place to trigger transfer)
export const paystackWebhook = async (req, res) => {
  const hash = crypto
    .createHmac("sha512", PAYSTACK_SECRET)
    .update(JSON.stringify(req.body))
    .digest("hex");

  if (hash !== req.headers["x-paystack-signature"]) {
    return res.status(401).send("Invalid signature");
  }

  try {
    const event = req.body;

    if (event.event === "charge.success") {
      const bookingId = event.data.metadata.bookingId;
      const amount = event.data.amount / 100;

      // Step 1: Mark booking as paid
      const booking = await prisma.booking.update({
        where: { id: bookingId },
        data: { status: "PAID" },
        include: {
          user: true,
          pickupLocation: true,
          dropoffLocation: true,
          shuttle: { select: { name: true } },
        },
      });


      // make changes here and in the other part to to reflect actual business logic

      // Step 2: Send confirmation email
      if (booking.user?.email) {
        const html = `
          <div style="max-width:600px;margin:auto;padding:20px;background:#f9f9f9;border-radius:8px;font-family:Arial,sans-serif">
            <h2>Booking Successful ✅</h2>
            <p>Hello ${booking.user.name},</p>
            <p>Your booking for shuttle <strong>${booking.shuttle?.name}</strong> is confirmed.</p>
            <ul>
              <li>Pickup: ${booking.pickupLocation?.location_name}</li>
              <li>Dropoff: ${booking.dropoffLocation?.location_name}</li>
              <li>Amount Paid: GHS ${amount}</li>
              <li>Booking Time: ${booking.bookingTime}</li>
            </ul>
            <p>Thank you for booking with us!</p>
          </div>`;
        sendEmail(booking.user.email, "Booking Confirmation", html).catch(
          (err) => console.error("Failed to send email:", err),
        );
      }

      // Step 3: Trigger transfer to shuttle manager
      const managerMoMoNumber = process.env.MANAGER_MO_MO_NUMBER;
      const secret = process.env.PAYSTACK_SECRET_KEY;

      const recipientRes = await axios.post(
        "https://api.paystack.co/transferrecipient",
        {
          type: "mobile_money",
          name: "Booking Manager",
          account_number: managerMoMoNumber,
          bank_code: "MTN",
          currency: "GHS",
        },
        { headers: { Authorization: `Bearer ${secret}` } },
      );

      const recipientCode = recipientRes.data.data.recipient_code;

      await axios.post(
        "https://api.paystack.co/transfer",
        {
          source: "balance",
          reason: `Shuttle booking payout`,
          amount: amount * 100,
          recipient: recipientCode,
        },
        { headers: { Authorization: `Bearer ${secret}` } },
      );

      console.log(
        `✅ Transferred GHS ${amount} to manager ${managerMoMoNumber}`,
      );
    }

    res.sendStatus(200);
  } catch (err) {
    await prisma.booking.update({
      where: { id: bookingId },
      data: { status: "CANCELLED" },
    });
    console.error(err.response?.data || err.message);
    res.sendStatus(500);
  }
};
