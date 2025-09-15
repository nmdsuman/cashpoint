import admin from 'firebase-admin';

// Firebase Admin SDK ইনিশিয়ালাইজেশন
const serviceAccount = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf-8'));
if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

function generateTransactionId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 9; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        // ব্যবহারকারী যাচাই
        const { authorization } = req.headers;
        if (!authorization || !authorization.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'Unauthorized: Missing token.' });
        }
        const token = authorization.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(token);
        const uid = decodedToken.uid;

        const { postId, idValue, entryFee, contestName } = req.body;
        if (!postId || !idValue || typeof entryFee !== 'number' || entryFee < 0) {
            return res.status(400).json({ message: 'Invalid input.' });
        }

        const userRef = db.doc(`artifacts/${process.env.APP_ID}/users/${uid}`);
        const participantRef = db.doc(`artifacts/${process.env.APP_ID}/public/data/posts/${postId}/participants/${uid}`);
        const transactionRef = userRef.collection('transactions').doc();

        await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists()) throw new Error("User profile not found.");
            
            const userData = userDoc.data();
            if ((userData.balance || 0) < entryFee) throw new Error("Insufficient balance.");

            // ব্যালেন্স কমানো
            transaction.update(userRef, { balance: admin.firestore.FieldValue.increment(-entryFee) });

            // অংশগ্রহণকারী হিসেবে যুক্ত করা
            transaction.set(participantRef, {
                fullName: userData.name, // CashPoint এর নাম ব্যবহার করা হচ্ছে
                email: userData.email,
                idValue: idValue,
                joinedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // CashPoint স্টেটমেন্টের জন্য ট্রানজেকশন তৈরি করা
            transaction.set(transactionRef, {
                type: 'entry_fee',
                amount: entryFee,
                charge: 0,
                description: `Entry fee for: ${contestName}`,
                status: 'completed',
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                transactionId: generateTransactionId()
            });
        });

        return res.status(200).json({ success: true, message: 'সফলভাবে যোগদান করেছেন!' });

    } catch (error) {
        console.error("API Error in joinTournament:", error.message);
        return res.status(400).json({ message: error.message || 'সার্ভারে একটি সমস্যা হয়েছে।' });
    }
}