// community.js
// Sistema de comunidad para Nekutoon: comentarios en tiempo real y calificaciones de estrellas.
// Integrado con Firebase Firestore con fallback automático a localStorage para máxima fiabilidad.

import { db, auth } from './firebase-init.js';
import {
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
  doc,
  setDoc,
  getDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

/**
 * Carga los comentarios más recientes para un fondo de pantalla específico.
 * @param {string|number} wallpaperId
 * @returns {Promise<Array>}
 */
export async function loadComments(wallpaperId) {
  if (!wallpaperId) return [];
  const localKey = `wp_comments_${wallpaperId}`;
  let localList = [];
  try {
    localList = JSON.parse(localStorage.getItem(localKey) || '[]');
  } catch (_) { localList = []; }

  try {
    const threadRef = collection(db, 'comments', String(wallpaperId), 'thread');
    const q = query(threadRef, orderBy('createdAt', 'desc'), limit(30));
    const snapshot = await getDocs(q);

    const comments = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      comments.push({
        id: docSnap.id,
        text: data.text || '',
        authorName: data.authorName || 'Usuario',
        authorPhoto: data.authorPhoto || '',
        authorUid: data.authorUid || '',
        createdAt: data.createdAt || null
      });
    });

    // Combinar con comentarios locales
    const ids = new Set(comments.map(c => c.id));
    localList.forEach(l => {
      if (!ids.has(l.id)) comments.unshift(l);
    });

    return comments;
  } catch (err) {
    console.warn(`[community] Fallback local para comentarios de ${wallpaperId}:`, err);
    return localList;
  }
}

/**
 * Publica un nuevo comentario en el hilo del fondo de pantalla.
 * @param {string|number} wallpaperId
 * @param {string} text
 * @returns {Promise<Object>}
 */
export async function postComment(wallpaperId, text) {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Debes iniciar sesión con Google para comentar.');
  }

  const cleanText = (text || '').trim();
  if (!cleanText) {
    throw new Error('El comentario no puede estar vacío.');
  }
  if (cleanText.length > 500) {
    throw new Error('El comentario supera el límite de 500 caracteres.');
  }

  const commentObj = {
    id: 'c_' + Date.now(),
    text: cleanText,
    authorName: user.displayName || 'Usuario Nekutoon',
    authorPhoto: user.photoURL || '',
    authorUid: user.uid,
    createdAt: new Date()
  };

  // Guardar siempre en local storage para que el usuario lo vea al instante
  try {
    const localKey = `wp_comments_${wallpaperId}`;
    const localList = JSON.parse(localStorage.getItem(localKey) || '[]');
    localList.unshift(commentObj);
    localStorage.setItem(localKey, JSON.stringify(localList));
  } catch (_) {}

  // Intentar sincronizar con Firestore en la nube
  try {
    const threadRef = collection(db, 'comments', String(wallpaperId), 'thread');
    await addDoc(threadRef, {
      text: cleanText,
      authorName: user.displayName || 'Usuario Nekutoon',
      authorPhoto: user.photoURL || '',
      authorUid: user.uid,
      createdAt: serverTimestamp()
    });
  } catch (err) {
    console.warn('[community] No se pudo guardar en Firestore (se conservó localmente):', err);
  }

  return commentObj;
}

/**
 * Guarda o actualiza la calificación (1 a 5 estrellas) del usuario actual.
 * @param {string|number} wallpaperId
 * @param {number} stars
 * @returns {Promise<void>}
 */
export async function setRating(wallpaperId, stars) {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Inicia sesión con Google para calificar este fondo.');
  }

  const ratingValue = Math.min(5, Math.max(1, parseInt(stars, 10) || 5));

  // Guardar copia local inmediata
  localStorage.setItem(`wp_user_vote_${wallpaperId}_${user.uid}`, String(ratingValue));

  try {
    const voteDocRef = doc(db, 'ratings', String(wallpaperId), 'votes', user.uid);
    await setDoc(voteDocRef, {
      stars: ratingValue,
      uid: user.uid,
      authorName: user.displayName || 'Usuario',
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (err) {
    console.warn('[community] Guardado localmente el voto:', err);
  }
}

/**
 * Obtiene el promedio de calificación y el número total de votos para un wallpaper.
 * @param {string|number} wallpaperId
 * @returns {Promise<{ avg: number, total: number }>}
 */
export async function getAvgRating(wallpaperId) {
  if (!wallpaperId) return { avg: 0, total: 0 };
  
  const user = auth.currentUser;
  let localAvg = 0;
  let localCount = 0;
  if (user) {
    const v = parseInt(localStorage.getItem(`wp_user_vote_${wallpaperId}_${user.uid}`) || '0', 10);
    if (v > 0) { localAvg = v; localCount = 1; }
  }

  try {
    const votesRef = collection(db, 'ratings', String(wallpaperId), 'votes');
    const snapshot = await getDocs(votesRef);

    if (snapshot.empty) {
      return { avg: localAvg, total: localCount };
    }

    let sum = 0;
    let count = 0;
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (typeof data.stars === 'number') {
        sum += data.stars;
        count++;
      }
    });

    if (count === 0) return { avg: localAvg, total: localCount };
    const avg = Number((sum / count).toFixed(1));
    return { avg, total: count };
  } catch (err) {
    return { avg: localAvg, total: localCount };
  }
}

/**
 * Obtiene la calificación que dio el usuario actual a este wallpaper (si existe).
 * @param {string|number} wallpaperId
 * @returns {Promise<number>}
 */
export async function getUserRating(wallpaperId) {
  const user = auth.currentUser;
  if (!user || !wallpaperId) return 0;

  const localVal = parseInt(localStorage.getItem(`wp_user_vote_${wallpaperId}_${user.uid}`) || '0', 10);

  try {
    const voteDocRef = doc(db, 'ratings', String(wallpaperId), 'votes', user.uid);
    const snap = await getDoc(voteDocRef);
    if (snap.exists()) {
      return snap.data().stars || localVal;
    }
    return localVal;
  } catch (_) {
    return localVal;
  }
}

const communityAPI = {
  loadComments,
  postComment,
  setRating,
  getAvgRating,
  getUserRating
};

if (typeof window !== 'undefined') {
  window.WP_COMMUNITY = communityAPI;
}

export default communityAPI;
