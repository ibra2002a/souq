// خادم «إمبراطورية السوق»: يتحقق من الثروة ويكتب لوحات الصدارة بنفسه، ويرسل الإشعارات.
'use strict';

const { onDocumentWritten, onDocumentUpdated, onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions, logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { worthOf, maxRate, growthBound } = require('./game');

admin.initializeApp();
const db = admin.firestore();
setGlobalOptions({ region: 'europe-west1', maxInstances: 5, memory: '256MiB' });

const SITE = 'https://ibra2002a.github.io/souq/';
const WEEK = 7 * 864e5, OFF = 4 * 864e5 - 3 * 36e5;
const seasonId = (t = Date.now()) => Math.floor((t - OFF) / WEEK);
const SLOT = 3 * 36e5;
const RARE_NAMES = ['فندق تراثي في أربيل', 'حصة في ميناء أم قصر', 'مخبز شهير في الكرادة', 'دكان قديم في الشورجة', 'مولّدة أهلية كبيرة', 'خان تاريخي في الموصل'];
const clip = (v, n = 40) => String(v || '').slice(0, n);

/* ================= Anti-cheat: verify every save ================= */
exports.verifySave = onDocumentWritten('saves/{uid}', async (event) => {
  const uid = event.params.uid;
  const after = event.data.after.exists ? event.data.after.data() : null;
  const vref = db.doc(`verify/${uid}`);

  if (!after) {                                     // account deleted
    await Promise.allSettled([vref.delete(), db.doc(`board/${uid}`).delete()]);
    return;
  }
  const st = after.state;
  if (!st || !Array.isArray(st.b)) return;

  const now = Date.now();
  const claimed = Math.max(0, worthOf(st, now));
  const rateNow = maxRate(st);
  const vsnap = await vref.get();
  const v = vsnap.exists ? vsnap.data() : null;

  let verified = claimed, flagged = false;
  if (v) {
    const bound = growthBound(v.worth, v.rate, (now - v.ts) / 1000);
    if (claimed > bound) { verified = bound; flagged = true; }
  } else {
    // First save we ever see: a new player cannot start rich.
    const firstCap = 5e7;
    if (claimed > firstCap) { verified = firstCap; flagged = true; }
  }
  // Income is tied to what the player verifiably owns, so a doctored save cannot raise the next bound much.
  const rate = Math.min(rateNow, verified * 2 + 1e4);

  const sid = seasonId(now);
  const seasonStart = v && v.season === sid ? v.seasonStart : verified;
  const score = Math.max(0, verified - seasonStart);
  const name = clip(st.pname) || 'تاجر';

  await vref.set({ worth: verified, rate, ts: now, season: sid, seasonStart, flags: (v ? v.flags || 0 : 0) + (flagged ? 1 : 0), lastClaimed: claimed });
  await db.doc(`board/${uid}`).set({ name, worth: Math.floor(verified), earned: Math.floor(Math.min(Number(st.earned) || 0, 1e30)), ts: now });
  await db.doc(`seasons/${sid}/players/${uid}`).set({ name, score: Math.floor(score), worth: Math.floor(verified), ts: now });

  // Keep the member's share of their alliance in step with the verified number.
  const al = await db.collection('alliances').where('members', 'array-contains', uid).limit(1).get();
  if (!al.empty) {
    const ref = al.docs[0].ref;
    await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (!s.exists) return;
      const w = Object.assign({}, s.data().worth, { [uid]: Math.floor(verified) });
      const total = Object.values(w).reduce((a, b) => a + (Number(b) || 0), 0);
      tx.update(ref, { worth: w, total });
    });
  }
  if (flagged) logger.warn('worth clamped', { uid, claimed, verified });
});

/* ================= Notifications ================= */
async function sendToUser(uid, title, body) {
  if (!uid) return;
  const snap = await db.collection('tokens').where('uid', '==', uid).limit(10).get();
  const tokens = snap.docs.map(d => d.id);
  if (!tokens.length) return;
  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    webpush: { fcmOptions: { link: SITE }, notification: { icon: SITE + 'icons/icon-192.png', dir: 'rtl', lang: 'ar' } }
  });
  // Drop tokens the push service no longer accepts.
  await Promise.allSettled(res.responses.map((r, i) => {
    const c = r.error && r.error.code;
    if (c === 'messaging/registration-token-not-registered' || c === 'messaging/invalid-registration-token') return db.doc(`tokens/${tokens[i]}`).delete();
    return null;
  }));
}
async function sendToAll(title, body) {
  await admin.messaging().send({
    topic: 'all',
    notification: { title, body },
    webpush: { fcmOptions: { link: SITE }, notification: { icon: SITE + 'icons/icon-192.png', dir: 'rtl', lang: 'ar' } }
  });
}

exports.onToken = onDocumentCreated('tokens/{token}', async (event) => {
  try { await admin.messaging().subscribeToTopic([event.params.token], 'all'); } catch (e) { logger.warn('subscribe failed', e.message); }
});

exports.auctionStarts = onSchedule({ schedule: '0 */3 * * *', timeZone: 'Etc/UTC' }, async () => {
  const slot = Math.floor(Date.now() / SLOT);
  await sendToAll('بدأ المزاد المباشر 🔨', `${RARE_NAMES[slot % RARE_NAMES.length]} معروض الآن لمدة ١٥ دقيقة. ادخل وزايد!`);
});

exports.dailyGift = onSchedule({ schedule: '0 20 * * *', timeZone: 'Asia/Baghdad' }, async () => {
  await sendToAll('هديتك اليومية تنتظرك 🎁', 'ادخل واستلم هدية اليوم قبل منتصف الليل حتى لا تنقطع سلسلتك.');
});

exports.onOutbid = onDocumentUpdated('auctions/{slot}', async (event) => {
  const b = event.data.before.data(), a = event.data.after.data();
  if (!b || !a || b.highBidder === a.highBidder) return;
  await sendToUser(b.highBidder, 'زايد عليك تاجر! ⚠️', `${clip(a.highName)} صار صاحب أعلى مزايدة. ارجع للمزاد قبل ما ينتهي.`);
});

exports.onDuel = onDocumentUpdated('duels/{code}', async (event) => {
  const b = event.data.before.data(), a = event.data.after.data();
  if (b && a && b.status === 'open' && a.status === 'live') {
    await sendToUser(a.a, 'بدأ التحدي ⚔️', `${clip(a.bName)} قبل تحديك. ادخل الآن، عندك ٥ دقائق!`);
  }
});

exports.onSale = onDocumentUpdated('market/{id}', async (event) => {
  const b = event.data.before.data(), a = event.data.after.data();
  if (b && a && b.status === 'open' && a.status === 'sold') {
    await sendToUser(a.seller, 'بيعت بضاعتك 💰', `${clip(a.buyerName)} اشترى عرضك في سوق اللاعبين. ادخل لتستلم فلوسك.`);
  }
});

exports.onReferral = onDocumentCreated('refs/{uid}', async (event) => {
  const d = event.data && event.data.data();
  if (d) await sendToUser(d.by, 'انضم صديقك 🎉', `${clip(d.name)} سجّل برابط دعوتك. ادخل واستلم مكافأتك.`);
});
