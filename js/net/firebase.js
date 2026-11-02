// Beam: lazy Firebase Realtime Database (project beam-gzowo), used only for room signaling and the relay fallback.

const SDK = 'https://www.gstatic.com/firebasejs/10.12.5';

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBLWRf6T52ih_Cs6yEa-QkEynag94uEtck',
  authDomain: 'beam-gzowo.firebaseapp.com',
  databaseURL: 'https://beam-gzowo-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'beam-gzowo',
  storageBucket: 'beam-gzowo.firebasestorage.app',
  messagingSenderId: '29685477466',
  appId: '1:29685477466:web:73acf84803ef0b43dde863',
};

let pending = null;

function timeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('firebase-timeout')), ms))]);
}

export function fb(ms = 10000) {
  if (pending) return pending;
  pending = (async () => {
    const [A, D] = await timeout(Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-database.js`)]), ms);
    const app = A.getApps().length ? A.getApp() : A.initializeApp(FIREBASE_CONFIG);
    const db = D.getDatabase(app);
    return {
      ref: path => D.ref(db, path),
      get: async r => (await timeout(D.get(r), ms)).val(),
      set: (r, v) => D.set(r, v),
      remove: r => D.remove(r),
      push: (r, v) => D.push(r, v),
      onValue: (r, cb) => D.onValue(r, s => cb(s.val(), s.key)),
      onChildAdded: (r, cb) => D.onChildAdded(r, s => cb(s.val(), s.key)),
      onChildRemoved: (r, cb) => D.onChildRemoved(r, s => cb(s.val(), s.key)),
      runTransaction: async (r, fn) => {
        const res = await timeout(D.runTransaction(r, fn), ms);
        return { committed: !!res.committed, value: res.snapshot ? res.snapshot.val() : null };
      },
      onDisconnectRemove: r => D.onDisconnect(r).remove(),
      cancelDisconnect: r => D.onDisconnect(r).cancel(),
    };
  })();
  pending.catch(() => { pending = null; });
  return pending;
}
