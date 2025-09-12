// ❗️❗️ নিরাপত্তা বাড়ানোর জন্য এই ফাংশনটি পরিবর্তন করা হয়েছে (Vercel API ব্যবহার করে) ❗️❗️
async function handleSendMoneyTransaction(recipient, amount) {
    const pin = document.getElementById('pin-input').value;
    if (!pin || pin.length !== 4) {
        showMessage("দয়া করে ৪-সংখ্যার সঠিক পিন দিন।");
        return;
    }

    showLoading(true);

    try {
        const user = auth.currentUser;
        if (!user) {
            throw new Error("লেনদেন করার জন্য আপনাকে লগইন করতে হবে।");
        }

        // ব্যবহারকারীর পরিচয় নিশ্চিত করার জন্য Firebase থেকে একটি টোকেন নেওয়া হচ্ছে
        const token = await user.getIdToken();

        // আপনার নিরাপদ Vercel API-কে কল করা হচ্ছে
        const response = await fetch('/api/sendMoney', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                recipientUid: recipient.uid,
                amount: amount,
                pin: pin
            })
        });

        const result = await response.json();

        // যদি সার্ভার থেকে কোনো এরর আসে, তাহলে সেটি দেখানো হবে
        if (!response.ok) {
            throw new Error(result.message || 'একটি অজানা সমস্যা হয়েছে।');
        }

        // সফল হলে সার্ভার থেকে আসা বার্তা দেখানো হবে
        showMessage(result.message);

    } catch (error) {
        console.error("Transaction failed:", error);
        showMessage(error.message);
    } finally {
        showLoading(false);
        // লেনদেন শেষে ড্যাশবোর্ড আবার লোড করার জন্য ২ সেকেন্ড অপেক্ষা
        setTimeout(() => {
            const profileDocRef = doc(db, `artifacts/${appId}/users/${currentUser.uid}`);
            onSnapshot(profileDocRef, (docSnap) => {
                if (docSnap.exists()){
                    const profileData = docSnap.data();
                    renderDashboard(profileData);
                }
            });
        }, 2000);
    }
}
