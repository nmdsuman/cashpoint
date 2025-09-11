// ফাইল: api/sendMoney.js

import admin from 'firebase-admin';

// Firebase Admin SDK শুরু করা
// process.env.FIREBASE_SERVICE_ACCOUNT থেকে গোপন তথ্য নিয়ে এটি কাজ করবে
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
  });
}

const db = admin.firestore();

// মূল ফাংশন, যা টাকা পাঠানোর কাজটি নিরাপদে করবে
export default async function handler(req, res) {
  // শুধুমাত্র POST অনুরোধ গ্রহণ করা হবে
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // ১. ব্যবহারকারীর পরিচয় যাচাই করা
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) {
      return res.status(401).json({ error: 'Authentication token not found.' });
    }
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const senderId = decodedToken.uid;

    // ২. ক্লায়েন্ট থেকে পাঠানো তথ্য গ্রহণ করা
    const { recipientId, amount, pin } = req.body;
    const appId = "default-app-id"; // আপনার অ্যাপ আইডি

    // ৩. সার্ভারে সমস্ত তথ্য পুনরায় যাচাই করা (সবচেয়ে গুরুত্বপূর্ণ ধাপ)
    if (!recipientId || !amount || !pin || amount <= 0) {
      return res.status(400).json({ error: 'Invalid input data.' });
    }

    const senderRef = db.doc(`artifacts/${appId}/users/${senderId}`);
    const recipientRef = db.doc(`artifacts/${appId}/users/${recipientId}`);

    // ৪. Firestore Transaction ব্যবহার করে ব্যালেন্স আপডেট করা
    const resultMessage = await db.runTransaction(async (transaction) => {
      const senderDoc = await transaction.get(senderRef);
      const recipientDoc = await transaction.get(recipientRef);

      if (!senderDoc.exists || !recipientDoc.exists) {
        throw new Error("Sender or recipient not found.");
      }

      const senderData = senderDoc.data();
      const recipientData = recipientDoc.data();
      
      // পিন যাচাই
      // ক্লায়েন্ট-সাইডের hashPin ফাংশনটি এখানেও থাকতে হবে
      function hashPin(p) {
        let hash = 0;
        for (let i = 0; i < p.length; i++) {
          const char = p.charCodeAt(i);
          hash = ((hash << 5) - hash) + char; hash |= 0;
        }
        return hash;
      }

      if (hashPin(String(pin)) !== senderData.pinHash) {
        throw new Error("আপনার পিন সঠিক নয়।");
      }

      // চার্জ গণনা
      const chargeConfig = { percentage: 2, fixed: 5 }; // এটিও ডেটাবেস থেকে আনা যায়
      const charge = (amount * chargeConfig.percentage / 100) + chargeConfig.fixed;
      const totalDeduction = amount + charge;

      if (senderData.balance < totalDeduction) {
        throw new Error("আপনার অ্যাকাউন্টে পর্যাপ্ত ব্যালেন্স নেই।");
      }

      // ব্যালেন্স আপডেট
      transaction.update(senderRef, { balance: senderData.balance - totalDeduction });
      transaction.update(recipientRef, { balance: recipientData.balance + amount });
      
      // ট্রানজেকশন রেকর্ড তৈরি করা
      const timestamp = admin.firestore.FieldValue.serverTimestamp();
      const transactionId = `CP${Date.now()}`;
      transaction.set(senderRef.collection("transactions").doc(), {
        type: 'send', amount, charge, description: `Send Money to ${recipientData.name}`, status: 'completed', timestamp, transactionId
      });
      transaction.set(recipientRef.collection("transactions").doc(), {
        type: 'receive', amount, charge: 0, description: `Receive Money from ${senderData.name}`, status: 'received', timestamp, transactionId
      });
      
      return `টাকা সফলভাবে ${recipientData.name}-কে পাঠানো হয়েছে!`;
    });

    // ৫. সফল হলে ক্লায়েন্টকে বার্তা পাঠানো
    return res.status(200).json({ success: true, message: resultMessage });

  } catch (error) {
    // ৬. কোনো সমস্যা হলে ক্লায়েন্টকে ভুলের বার্তা পাঠানো
    console.error("Transaction Error:", error);
    return res.status(500).json({ error: error.message || "লেনদেন ব্যর্থ হয়েছে।" });
  }
}
