import admin from 'firebase-admin';

// Initialize Firebase Admin using Vercel env var FIREBASE_SERVICE_ACCOUNT_BASE64
const serviceAccount = JSON.parse(
  Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf-8')
);
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}
const db = admin.firestore();

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }
  try {
    const { authorization } = req.headers;
    if (!authorization || !authorization.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Unauthorized: Missing token.' });
    }
    const token = authorization.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(token);
    const uid = decoded.uid;

    const appId = process.env.APP_ID;
    if (!appId) {
      return res.status(500).json({ message: 'Server misconfigured: APP_ID missing.' });
    }

    // Verify admin role in Firestore profile
    const adminUserSnap = await db.doc(`artifacts/${appId}/users/${uid}`).get();
    if (!adminUserSnap.exists || adminUserSnap.data()?.isAdmin !== true) {
      return res.status(403).json({ message: 'Only admins can access totals.' });
    }

    // Sum using collection group from transactions
    const txGroup = db.collectionGroup('transactions');
    const [joinsSnap, prizesSnap] = await Promise.all([
      txGroup.where('type', '==', 'tournament_join').get(),
      txGroup.where('type', '==', 'tournament_prize').get(),
    ]);

    let joinSum = 0;
    joinsSnap.forEach(d => { const a = Number(d.data()?.amount || 0); if (Number.isFinite(a)) joinSum += a; });
    let prizeSum = 0;
    prizesSnap.forEach(d => { const a = Number(d.data()?.amount || 0); if (Number.isFinite(a)) prizeSum += a; });

    return res.status(200).json({ success: true, join: joinSum, prize: prizeSum, profit: joinSum - prizeSum });
  } catch (error) {
    console.error('API Error in getTournamentTotals:', error);
    const msg = error?.message || 'Server error';
    return res.status(400).json({ message: msg });
  }
}
