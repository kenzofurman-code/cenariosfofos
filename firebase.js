// Integração opcional com Firebase. Se firebase-config.js ainda tiver as chaves
// de exemplo, tudo aqui vira "no-op" (não faz nada) e o app funciona só com o
// cache local (db-local.js). Assim que você colar suas chaves reais, a nuvem
// entra em ação automaticamente, sem precisar mudar mais nada.

import { firebaseConfig } from './firebase-config.js';

export const cloudEnabled = !!(firebaseConfig.apiKey && firebaseConfig.apiKey !== 'COLE_AQUI');

let app = null, db = null, storage = null, auth = null, currentUser = null;
let initPromise = null;

// SDKs carregados via CDN (sem necessidade de build/bundler para publicar na Vercel)
const SDK_BASE = 'https://www.gstatic.com/firebasejs/10.12.2/';

export function initCloud(){
  if (!cloudEnabled) return Promise.resolve(false);
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const [{ initializeApp }, firestoreMod, storageMod, authMod] = await Promise.all([
        import(SDK_BASE + 'firebase-app.js'),
        import(SDK_BASE + 'firebase-firestore.js'),
        import(SDK_BASE + 'firebase-storage.js'),
        import(SDK_BASE + 'firebase-auth.js'),
      ]);

      app = initializeApp(firebaseConfig);
      db = firestoreMod.getFirestore(app);
      storage = storageMod.getStorage(app);
      auth = authMod.getAuth(app);

      window.__firestoreMod = firestoreMod;
      window.__storageMod = storageMod;

      await new Promise((resolve) => {
        authMod.onAuthStateChanged(auth, (user) => {
          if (user){ currentUser = user; resolve(); }
        });
        authMod.signInAnonymously(auth).catch((e) => {
          console.warn('[nuvem] login anônimo falhou — verifique se "Anonymous" está habilitado em Authentication > Sign-in method.', e);
          resolve();
        });
      });

      return !!currentUser;
    } catch (e) {
      console.warn('[nuvem] Firebase não pôde iniciar, seguindo só com cache local.', e);
      return false;
    }
  })();

  return initPromise;
}

export function getSyncFolderId(){
  const code = localStorage.getItem('familyCode');
  return (code && code.trim()) ? code.trim() : (currentUser ? currentUser.uid : 'anonymous');
}

function scenariosCol(){
  const { collection } = window.__firestoreMod;
  return collection(db, 'users', getSyncFolderId(), 'scenarios');
}

export async function uploadImageToStorage(dataURL, path){
  const { ref, uploadString, getDownloadURL } = window.__storageMod;
  const r = ref(storage, path);
  await uploadString(r, dataURL, 'data_url');
  return await getDownloadURL(r);
}

export async function uploadJSONToStorage(obj, path){
  const { ref, uploadString, getDownloadURL } = window.__storageMod;
  const r = ref(storage, path);
  await uploadString(r, JSON.stringify(obj), 'raw', { contentType: 'application/json' });
  return await getDownloadURL(r);
}

export async function saveScenarioCloud(scenario){
  if (!cloudEnabled || !currentUser) return false;
  try {
    const { doc, setDoc, serverTimestamp, collection, writeBatch } = window.__firestoreMod;

    const bgURL = scenario.background.startsWith('data:')
      ? await uploadImageToStorage(scenario.background, `scenarios/${scenario.id}/background.webp`)
      : scenario.background;

    const thumbURL = (scenario.thumbnail && scenario.thumbnail.startsWith('data:'))
      ? await uploadImageToStorage(scenario.thumbnail, `scenarios/${scenario.id}/thumbnail.webp`)
      : (scenario.thumbnail || '');

    // Salvar figurinhas em lote na subcoleção do Firestore
    const { getDocs } = window.__firestoreMod;
    const stickersColRef = collection(db, 'users', getSyncFolderId(), 'scenarios', scenario.id, 'stickers');
    const stickersSnap = await getDocs(stickersColRef).catch(() => ({ size: 0 }));
    const existingStickersCount = stickersSnap.size || 0;

    const batch = writeBatch(db);
    scenario.stickers.forEach((s, idx) => {
      const sRef = doc(stickersColRef, `s${idx}`);
      batch.set(sRef, { uri: s.uri, w: s.w, h: s.h });
    });

    // Deleta documentos extras remanescentes caso a lista tenha encolhido
    if (existingStickersCount > scenario.stickers.length) {
      for (let k = scenario.stickers.length; k < existingStickersCount; k++) {
        const extraRef = doc(stickersColRef, `s${k}`);
        batch.delete(extraRef);
      }
    }
    await batch.commit();

    await setDoc(doc(scenariosCol(), scenario.id), {
      name: scenario.name,
      background: bgURL,
      thumbnail: thumbURL,
      stickerCount: scenario.stickers.length,
      updatedAt: serverTimestamp()
    });
    return true;
  } catch (e) {
    console.warn('[nuvem] falha ao salvar cenário', e);
    return false;
  }
}

export async function loadScenariosCloud(){
  if (!cloudEnabled || !currentUser) return [];
  try {
    const { getDocs, collection } = window.__firestoreMod;
    const snap = await getDocs(scenariosCol());
    const out = [];
    for (const d of snap.docs){
      const data = d.data();
      let stickers = [];
      try {
        const stickersColRef = collection(db, 'users', getSyncFolderId(), 'scenarios', d.id, 'stickers');
        const stickersSnap = await getDocs(stickersColRef);
        const sortedDocs = stickersSnap.docs.map(doc => ({ id: doc.id, data: doc.data() }));
        sortedDocs.sort((a, b) => {
          const numA = parseInt(a.id.replace('s', ''), 10);
          const numB = parseInt(b.id.replace('s', ''), 10);
          return numA - numB;
        });
        stickers = sortedDocs.map(item => item.data);
      } catch (e){ console.warn('[nuvem] falha ao buscar adesivos de', d.id, e); }
      out.push({
        id: d.id,
        name: data.name,
        background: data.background,
        thumbnail: data.thumbnail,
        stickers,
        variantCache: {}
      });
    }
    return out;
  } catch (e) {
    console.warn('[nuvem] falha ao carregar cenários', e);
    return [];
  }
}

export async function saveLayoutCloud(scenarioId, items){
  if (!cloudEnabled || !currentUser) return false;
  try {
    const { doc, setDoc, serverTimestamp } = window.__firestoreMod;
    await setDoc(doc(db, 'users', getSyncFolderId(), 'layouts', scenarioId), {
      items, updatedAt: serverTimestamp()
    });
    return true;
  } catch (e) { console.warn('[nuvem] falha ao salvar layout', e); return false; }
}

export async function loadLayoutCloud(scenarioId){
  if (!cloudEnabled || !currentUser) return null;
  try {
    const { doc, getDoc } = window.__firestoreMod;
    const snap = await getDoc(doc(db, 'users', getSyncFolderId(), 'layouts', scenarioId));
    return snap.exists() ? snap.data().items : null;
  } catch (e) { return null; }
}

export async function deleteScenarioCloud(id){
  if (!cloudEnabled || !currentUser) return false;
  try {
    const { doc, deleteDoc, collection, getDocs, writeBatch } = window.__firestoreMod;

    // 1. Delete all stickers in the subcollection first
    const stickersColRef = collection(db, 'users', getSyncFolderId(), 'scenarios', id, 'stickers');
    const stickersSnap = await getDocs(stickersColRef);
    const batch = writeBatch(db);
    stickersSnap.docs.forEach(d => {
      batch.delete(d.ref);
    });
    await batch.commit();

    // 2. Delete scenario document from user's subcollection
    await deleteDoc(doc(scenariosCol(), id));
    // 3. Delete layout document from user's layouts subcollection
    await deleteDoc(doc(db, 'users', getSyncFolderId(), 'layouts', id));
    
    // 4. Delete files from Firebase Storage if possible
    try {
      const { ref, deleteObject } = window.__storageMod;
      await deleteObject(ref(storage, `scenarios/${id}/background.webp`)).catch(() => {});
      await deleteObject(ref(storage, `scenarios/${id}/thumbnail.webp`)).catch(() => {});
    } catch (storageErr) {
      // ignore storage errors
    }
    
    return true;
  } catch (e) {
    console.warn('[nuvem] falha ao deletar cenário', e);
    return false;
  }
}

