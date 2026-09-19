// community.js
// Sistema de comunidad para Nekutoon: comentarios en tiempo real y calificaciones de estrellas.
// Integrado con Firebase Firestore y Auth. Expone la API tanto como módulo ES como a window.WP_COMMUNITY.

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

    return comments;
  } catch (err) {
    console.warn(`[community] Error al cargar comentarios de ${wallpaperId}:`, err);
    return [];
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

  try {
    const threadRef = collection(db, 'comments', String(wallpaperId), 'thread');
    const docRef = await addDoc(threadRef, {
      text: cleanText,
      authorName: user.displayName || 'Usuario Nekutoon',
      authorPhoto: user.photoURL || '',
      authorUid: user.uid,
      createdAt: serverTimestamp()
    });

    return {
      id: docRef.id,
      text: cleanText,
      authorName: user.displayName || 'Usuario Nekutoon',
      authorPhoto: user.photoURL || '',
      authorUid: user.uid,
      createdAt: new Date()
    };
  } catch (err) {
    console.error('[community] Error al publicar comentario:', err);
    throw new Error('No se pudo publicar el comentario. Intenta de nuevo.');
  }
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

  try {
    const voteDocRef = doc(db, 'ratings', String(wallpaperId), 'votes', user.uid);
    await setDoc(voteDocRef, {
      stars: ratingValue,
      uid: user.uid,
      authorName: user.displayName || 'Usuario',
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (err) {
    console.error('[community] Error al registrar calificación:', err);
    throw new Error('No se pudo guardar la calificación. Intenta de nuevo.');
  }
}

/**
 * Obtiene el promedio de calificación y el número total de votos para un wallpaper.
 * @param {string|number} wallpaperId
 * @returns {Promise<{ avg: number, total: number }>}
 */
export async function getAvgRating(wallpaperId) {
  if (!wallpaperId) return { avg: 0, total: 0 };
  try {
    const votesRef = collection(db, 'ratings', String(wallpaperId), 'votes');
    const snapshot = await getDocs(votesRef);

    if (snapshot.empty) {
      return { avg: 0, total: 0 };
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

    if (count === 0) return { avg: 0, total: 0 };
    const avg = Number((sum / count).toFixed(1));
    return { avg, total: count };
  } catch (err) {
    console.warn(`[community] Error al obtener promedio de ${wallpaperId}:`, err);
    return { avg: 0, total: 0 };
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
  try {
    const voteDocRef = doc(db, 'ratings', String(wallpaperId), 'votes', user.uid);
    const snap = await getDoc(voteDocRef);
    if (snap.exists()) {
      return snap.data().stars || 0;
    }
    return 0;
  } catch (err) {
    console.warn(`[community] Error al leer voto del usuario para ${wallpaperId}:`, err);
    return 0;
  }
}

const communityAPI = {
  loadComments,
  postComment,
  setRating,
  getAvgRating,
  getUserRating
};

// Exponer a window para compatibilidad directa con app.js
if (typeof window !== 'undefined') {
  window.WP_COMMUNITY = communityAPI;
}

export default communityAPI;
