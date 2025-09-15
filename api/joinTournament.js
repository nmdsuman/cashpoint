// /api/joinTournament.js
// Vercel serverless function - joins a user into a tournament with a transaction that deducts entryFee
import admin from "firebase-admin";

if (!admin.apps.length) {
  // Use applicationDefault() on Vercel; alternatively you can use a service account JSON via env var
  admin.initializeApp();
}
const db = admin.firestore();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { userId, tournamentId, entryFee } = req.body;

    if (!userId || !tournamentId || typeof entryFee !== "number") {
      return res.status(400).json({ error: "Invalid input" });
    }

    const usersRoot = "artifacts/cashpoint/users";
    const postsBase = `artifacts/cashpoint/public/default/data/posts`;

    const userRef = db.doc(`${usersRoot}/${userId}`);
    const participantRef = db.doc(`${postsBase}/${tournamentId}/participants/${userId}`);

    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) throw new Error("User not found");

      const currentWallet = Number(userSnap.get("wallet") || 0);
      if (currentWallet < entryFee) throw new Error("Insufficient balance");

      // update wallet
      tx.update(userRef, {
        wallet: currentWallet - entryFee,
        updatedAt: new Date().toISOString(),
      });

      // create participant doc (id = userId)
      tx.set(participantRef, {
        userId,
        joinedAt: new Date().toISOString(),
        status: "joined",
      });
    });

    return res.status(200).json({ success: true, message: "Joined tournament successfully" });
  } catch (err) {
    console.error("joinTournament error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
}