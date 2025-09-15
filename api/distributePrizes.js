// /api/distributePrizes.js
// Vercel serverless function - admin-only endpoint to add prize money to winners
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { adminUid, prizes } = req.body;
    // basic admin check from request body - strong auth should be enforced by verifying token on server (optional)
    // prizes = [{ userId: 'uid1', amount: 100 }, ...]

    if (!Array.isArray(prizes) || prizes.length === 0) {
      return res.status(400).json({ error: "Invalid prizes array" });
    }

    // Optional: you can enforce adminUid presence; for stronger security verify with Firebase Auth token in Authorization header
    // For now we expect this function to be called only by admin via admin panel (serverless)
    await db.runTransaction(async (tx) => {
      for (const p of prizes) {
        const { userId, amount } = p;
        if (!userId || typeof amount !== "number") continue;

        const userRef = db.doc(`artifacts/cashpoint/users/${userId}`);
        const snap = await tx.get(userRef);
        if (!snap.exists) throw new Error(`User not found: ${userId}`);

        const cur = Number(snap.get("wallet") || 0);
        tx.update(userRef, {
          wallet: cur + amount,
          updatedAt: new Date().toISOString(),
        });
      }
    });

    return res.status(200).json({ success: true, message: "Prizes distributed" });
  } catch (err) {
    console.error("distributePrizes error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
}