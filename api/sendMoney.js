import admin from 'firebase-admin';

// Vercel Environment Variables থেকে আপনার সার্ভিস অ্যাকাউন্ট কী লোড করুন
// এই কী Base64 ফরম্যাটে Vercel ড্যাশবোর্ডে সেট করতে হবে
const serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf-8')
);

// Firebase Admin অ্যাপটি শুধু একবার ইনিশিয়ালাইজ করুন
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

// ক্লায়েন্ট-সাইডের সাথে মিল রেখে পিন হ্যাশিং ফাংশন
function hashPin(pin) {
    let hash = 0;
    for (let i = 0; i < pin.length; i++) {
        const char = pin.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
}

// Vercel ফাংশনের মূল হ্যান্ডলার
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        // ক্লায়েন্টের পাঠানো Authorization হেডার থেকে টোকেন নিন
        const { authorization } = req.headers;
        if (!authorization || !authorization.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'Unauthorized: Missing token.' });
        }

        const token = authorization.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(token);
        const senderUid = decodedToken.uid; // এটি ভেরিফাইড ইউজার আইডি

        const { recipientUid, amount, pin } = req.body;

        // ইনপুট ভ্যালিডেশন
        if (!recipientUid || typeof amount !== 'number' || amount <= 0 || !pin || pin.length !== 4) {
            return res.status(400).json({ message: 'Invalid input provided.' });
        }

        if (senderUid === recipientUid) {
            return res.status(400).json({ message: 'You cannot send money to yourself.' });
        }
        
        const senderDocRef = db.collection('artifacts/default-app-id/users').doc(senderUid); // আপনার appId ব্যবহার করুন
        const recipientDocRef = db.collection('artifacts/default-app-id/users').doc(recipientUid); // আপনার appId ব্যবহার করুন

        // Firestore Transaction ব্যবহার করে নিরাপদ লেনদেন
        await db.runTransaction(async (transaction) => {
            const senderDoc = await transaction.get(senderDocRef);
            const recipientDoc = await transaction.get(recipientDocRef);

            if (!senderDoc.exists || !recipientDoc.exists) {
                throw new Error("Sender or recipient not found.");
            }

            const senderData = senderDoc.data();
            const recipientData = recipientDoc.data();

            // সার্ভারে পিন এবং ব্যালেন্স চেক
            if (hashPin(pin) !== senderData.pinHash) {
                throw new Error("Incorrect PIN provided.");
            }

            const charge = (amount * 0.02) + 5; // উদাহরণ: 2% + 5 টাকা চার্জ
            const totalDeduction = amount + charge;

            if ((senderData.balance || 0) < totalDeduction) {
                throw new Error("Insufficient balance.");
            }

            // ব্যালেন্স আপডেট
            const newSenderBalance = senderData.balance - totalDeduction;
            const newRecipientBalance = (recipientData.balance || 0) + amount;
            
            transaction.update(senderDocRef, { balance: newSenderBalance });
            transaction.update(recipientDocRef, { balance: newRecipientBalance });

            // লেনদেনের লগ তৈরি করা (ঐচ্ছিক কিন্তু জরুরি)
            const transactionId = `TXN_${Date.now()}`;
            const senderTxRef = senderDocRef.collection("transactions").doc();
            transaction.set(senderTxRef, {
                type: 'send', amount, charge, description: `Sent to ${recipientData.name}`, 
                timestamp: admin.firestore.FieldValue.serverTimestamp(), status: 'completed', transactionId
            });
            const recipientTxRef = recipientDocRef.collection("transactions").doc();
            transaction.set(recipientTxRef, {
                type: 'receive', amount, charge: 0, description: `Received from ${senderData.name}`,
                timestamp: admin.firestore.FieldValue.serverTimestamp(), status: 'received', transactionId
            });
        });

        return res.status(200).json({ success: true, message: `৳ ${amount} সফলভাবে পাঠানো হয়েছে!` });

    } catch (error) {
        console.error("API Error:", error.message);
        return res.status(500).json({ message: error.message || 'An internal error occurred.' });
    }
}
