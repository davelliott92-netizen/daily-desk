// Optional sync between devices using Firebase (Firestore + email sign-in).
// Only loaded if firebaseConfig.apiKey is filled in (js/config.js).
//
// Every piece of data is one Firestore document at
//   users/{uid}/items/{kind}__{id}   →  { kind, id, updatedAt, data }
// Newest updatedAt wins. Firestore keeps an offline copy and sends
// queued changes when the device is back online.
import * as store from './store.js';

const VERSION = '10.12.2';
const BASE = `https://www.gstatic.com/firebasejs/${VERSION}`;
const docId = (kind, id) => `${kind}__${id}`;

export async function startSync(config, onStatus) {
  if (!config || !config.apiKey) { onStatus({ state: 'off' }); return null; }
  onStatus({ state: 'loading' });

  let appMod, fa, ff;
  try {
    [appMod, fa, ff] = await Promise.all([
      import(`${BASE}/firebase-app.js`),
      import(`${BASE}/firebase-auth.js`),
      import(`${BASE}/firebase-firestore.js`)
    ]);
  } catch (e) {
    onStatus({ state: 'unavailable', error: 'Could not load sync (offline?). Your changes are saved on this device.' });
    return null;
  }

  const app = appMod.initializeApp(config);
  const auth = fa.initializeAuth(app, { persistence: [fa.indexedDBLocalPersistence, fa.browserLocalPersistence] });
  const db = ff.initializeFirestore(app, {
    localCache: ff.persistentLocalCache({ tabManager: ff.persistentMultipleTabManager() })
  });

  let unsubscribe = null;

  function push(kind, id, data) {
    const user = auth.currentUser;
    if (!user || !data) return;
    const clean = JSON.parse(JSON.stringify(data));
    ff.setDoc(ff.doc(db, 'users', user.uid, 'items', docId(kind, id)), {
      kind, id, updatedAt: clean.updatedAt || Date.now(), data: clean
    }).catch((e) => onStatus({ state: 'error', email: user.email, error: e.message }));
  }

  fa.onAuthStateChanged(auth, (user) => {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    store.setHook(null);
    if (!user) { onStatus({ state: 'signed-out' }); return; }
    onStatus({ state: 'syncing', email: user.email });

    const col = ff.collection(db, 'users', user.uid, 'items');
    let first = true;
    unsubscribe = ff.onSnapshot(col, { includeMetadataChanges: true }, (snap) => {
      let changed = false;
      snap.docChanges().forEach((ch) => {
        if (ch.type === 'removed') return;
        const d = ch.doc.data();
        if (store.applyRemote(d.kind, d.id, d.data)) changed = true;
      });
      // Wait for a snapshot from the server (not just the offline cache)
      // before uploading, so an old device never overwrites newer data.
      if (first && !snap.metadata.fromCache) {
        first = false;
        // Upload anything this device has that the cloud doesn't (or is older).
        const remote = new Map(snap.docs.map((d) => [d.id, d.data().updatedAt || 0]));
        for (const [kind, id, data] of store.allItems()) {
          const key = docId(kind, id);
          if (!remote.has(key) || (data.updatedAt || 0) > remote.get(key)) push(kind, id, data);
        }
        store.setHook(push);
      }
      if (changed) store.remoteDone();
      onStatus({
        state: 'synced', email: user.email,
        pending: snap.metadata.hasPendingWrites, offline: snap.metadata.fromCache
      });
    }, (err) => onStatus({ state: 'error', email: user.email, error: err.message }));
  });

  return {
    signIn: (email, pw) => fa.signInWithEmailAndPassword(auth, email, pw),
    signUp: (email, pw) => fa.createUserWithEmailAndPassword(auth, email, pw),
    resetPassword: (email) => fa.sendPasswordResetEmail(auth, email),
    signOut: () => fa.signOut(auth)
  };
}
