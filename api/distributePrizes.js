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
        const { authorization } = req.headers;
        if (!authorization || !authorization.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'Unauthorized.' });
        }
        const token = authorization.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(token);
        const adminUid = decodedToken.uid;

        // অ্যাডমিন কিনা যাচাই করুন
        const adminDoc = await db.doc(`artifacts/${process.env.APP_ID}/users/${adminUid}`).get();
        if (!adminDoc.exists() || !adminDoc.data().isAdmin) {
            return res.status(403).json({ message: 'Forbidden: Admins only.' });
        }

        const { postId, winners, contestName } = req.body;
        if (!postId || !Array.isArray(winners) || winners.length === 0) {
            return res.status(400).json({ message: 'Invalid input for prize distribution.' });
        }

        const postRef = db.doc(`artifacts/${process.env.APP_ID}/public/data/posts/${postId}`);

        await db.runTransaction(async (transaction) => {
            for (const winner of winners) {
                if (winner.userId && winner.amount > 0) {
                    const userRef = db.doc(`artifacts/${process.env.APP_ID}/users/${winner.userId}`);
                    const userTxRef = userRef.collection('transactions').doc();

                    // বিজয়ীর ব্যালেন্স বৃদ্ধি
                    transaction.update(userRef, { balance: admin.firestore.FieldValue.increment(winner.amount) });

                    // বিজয়ীর জন্য ট্রানজেকশন রেকর্ড
                    transaction.set(userTxRef, {
                        type: 'prize_win',
                        amount: winner.amount,
                        charge: 0,
                        description: `Prize for: ${contestName}`,
                        status: 'completed',
                        timestamp: admin.firestore.FieldValue.serverTimestamp(),
                        transactionId: generateTransactionId()
                    });
                }
            }
            // টুর্নামেন্টের স্ট্যাটাস আপডেট
            transaction.update(postRef, { status: 'prizes_distributed', pendingPrizes: {} });
        });

        return res.status(200).json({ success: true, message: 'পুরস্কার সফলভাবে বিতরণ করা হয়েছে!' });

    } catch (error) {
        console.error("API Error in distributePrizes:", error.message);
        return res.status(500).json({ message: 'সার্ভারে একটি সমস্যা হয়েছে।' });
    }
}