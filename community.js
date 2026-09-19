// community.js
// Sistema de comunidad para Nekutoon: comentarios en tiempo real y calificaciones de estrellas.
// Conectado directamente a las colecciones 'comentarios' y 'estrellas' en Firestore con soporte onSnapshot (tiempo real).

import { db, auth } from './firebase-init.js';
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

/**
 * Escucha comentarios en TIEMPO REAL para un fondo de pantalla específico.
 * @param {string|number} wallpaperId
 * @param {Function} callback Recibe la lista actualizada de comentarios
 * @returns {Function} Función para cancelar la suscripción (unsubscribe)
 */
export function subscribeComments(wallpaperId, callback) {
  if (!wallpaperId) return () => {};
  const wId = String(wallpaperId);

  // Consulta en la colección principal 'comentarios'
  try {
    const comRef = collection(db, 'comentarios');
    const q = query(
      comRef,
      where('fondoId', '==', wId),
      orderBy('fecha', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const comments = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        comments.push({
          id: docSnap.id,
          text: d.texto || d.text || '',
          authorName: d.usuarioNombre || d.authorName || 'Usuario',
          authorPhoto: d.usuarioFoto || d.authorPhoto || '',
          authorUid: d.usuarioId || d.authorUid || '',
          createdAt: d.fecha || d.createdAt || null
        });
      });

      // Si Firestore no tiene aún comentarios para este ID, mezclar con locales
      const localList = getLocalComments(wId);
      const ids = new Set(comments.map(c => c.id));
      localList.forEach(l => {
        if (!ids.has(l.id)) comments.unshift(l);
      });

      callback(comments);
    }, (err) => {
      console.warn('[community] Error en onSnapshot de comentarios:', err);
      // Si falla por índice o permisos, cargar locales + getDocs
      loadComments(wId).then(callback);
    });

    return unsubscribe;
  } catch (err) {
    console.warn('[community] No se pudo iniciar onSnapshot:', err);
    loadComments(wId).then(callback);
    return () => {};
  }
}

/**
 * Carga comentarios vía getDocs (compatibilidad).
 */
export async function loadComments(wallpaperId) {
  if (!wallpaperId) return [];
  const wId = String(wallpaperId);
  const localList = getLocalComments(wId);

  try {
    const comRef = collection(db, 'comentarios');
    const q = query(comRef, where('fondoId', '==', wId), limit(50));
    const snapshot = await getDocs(q);

    const comments = [];
    snapshot.forEach((docSnap) => {
      const d = docSnap.data();
      comments.push({
        id: docSnap.id,
        text: d.texto || d.text || '',
        authorName: d.usuarioNombre || d.authorName || 'Usuario',
        authorPhoto: d.usuarioFoto || d.authorPhoto || '',
        authorUid: d.usuarioId || d.authorUid || '',
        createdAt: d.fecha || d.createdAt || null
      });
    });

    const ids = new Set(comments.map(c => c.id));
    localList.forEach(l => {
      if (!ids.has(l.id)) comments.unshift(l);
    });

    return comments;
  } catch (err) {
    console.warn('[community] Fallback local para comentarios:', err);
    return localList;
  }
}

function getLocalComments(wallpaperId) {
  try {
    return JSON.parse(localStorage.getItem(`wp_comments_${wallpaperId}`) || '[]');
  } catch (_) {
    return [];
  }
}

/**
 * Publica un nuevo comentario en Firestore en la colección 'comentarios'.
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

  const wId = String(wallpaperId);
  const commentObj = {
    id: 'c_' + Date.now(),
    fondoId: wId,
    wallpaperId: wId,
    texto: cleanText,
    text: cleanText,
    usuarioId: user.uid,
    authorUid: user.uid,
    usuarioNombre: user.displayName || 'Usuario Nekutoon',
    authorName: user.displayName || 'Usuario Nekutoon',
    usuarioFoto: user.photoURL || '',
    authorPhoto: user.photoURL || '',
    fecha: new Date(),
    createdAt: new Date()
  };

  // Guardar siempre en local storage para visibilidad inmediata
  try {
    const localKey = `wp_comments_${wId}`;
    const localList = getLocalComments(wId);
    localList.unshift(commentObj);
    localStorage.setItem(localKey, JSON.stringify(localList.slice(0, 50)));
  } catch (_) {}

  // Guardar en Firestore en la colección 'comentarios'
  try {
    const docData = {
      fondoId: wId,
      wallpaperId: wId,
      texto: cleanText,
      text: cleanText,
      usuarioId: user.uid,
      authorUid: user.uid,
      usuarioNombre: user.displayName || 'Usuario Nekutoon',
      authorName: user.displayName || 'Usuario Nekutoon',
      usuarioFoto: user.photoURL || '',
      authorPhoto: user.photoURL || '',
      fecha: serverTimestamp(),
      createdAt: serverTimestamp()
    };

    await addDoc(collection(db, 'comentarios'), docData);
  } catch (err) {
    console.warn('[community] No se pudo guardar en Firestore (se guardó en local):', err);
  }

  return commentObj;
}

/**
 * Escucha calificaciones en TIEMPO REAL para un fondo.
 */
export function subscribeRatings(wallpaperId, callback) {
  if (!wallpaperId) return () => {};
  const wId = String(wallpaperId);

  try {
    const estRef = collection(db, 'estrellas');
    const q = query(estRef, where('fondoId', '==', wId));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      let sum = 0;
      let count = 0;
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        const stars = Number(d.estrellas || d.stars || 0);
        if (stars > 0) {
          sum += stars;
          count++;
        }
      });

      const avg = count > 0 ? Number((sum / count).toFixed(1)) : 0;
      callback({ avg, total: count });
    }, (err) => {
      console.warn('[community] Error onSnapshot estrellas:', err);
      getAvgRating(wId).then(callback);
    });

    return unsubscribe;
  } catch (err) {
    getAvgRating(wId).then(callback);
    return () => {};
  }
}

/**
 * Guarda o actualiza la calificación (1 a 5 estrellas) en la colección 'estrellas'.
 */
export async function setRating(wallpaperId, stars) {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Inicia sesión con Google para calificar este fondo.');
  }

  const ratingValue = Math.min(5, Math.max(1, parseInt(stars, 10) || 5));
  const wId = String(wallpaperId);

  // Copia local inmediata
  localStorage.setItem(`wp_user_vote_${wId}_${user.uid}`, String(ratingValue));

  // Guardar en Firestore: doc ID es fondoId_usuarioId para que cada usuario tenga 1 voto por fondo
  try {
    const voteDocRef = doc(db, 'estrellas', `${wId}_${user.uid}`);
    await setDoc(voteDocRef, {
      fondoId: wId,
      wallpaperId: wId,
      estrellas: ratingValue,
      stars: ratingValue,
      usuarioId: user.uid,
      authorUid: user.uid,
      usuarioNombre: user.displayName || 'Usuario',
      fecha: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (err) {
    console.warn('[community] Guardado local del voto (Firestore falló):', err);
  }
}

/**
 * Obtiene el promedio y total de estrellas desde 'estrellas'.
 */
export async function getAvgRating(wallpaperId) {
  if (!wallpaperId) return { avg: 0, total: 0 };
  const wId = String(wallpaperId);

  const user = auth.currentUser;
  let localAvg = 0;
  let localCount = 0;
  if (user) {
    const v = parseInt(localStorage.getItem(`wp_user_vote_${wId}_${user.uid}`) || '0', 10);
    if (v > 0) { localAvg = v; localCount = 1; }
  }

  try {
    const estRef = collection(db, 'estrellas');
    const q = query(estRef, where('fondoId', '==', wId));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return { avg: localAvg, total: localCount };
    }

    let sum = 0;
    let count = 0;
    snapshot.forEach((docSnap) => {
      const d = docSnap.data();
      const stars = Number(d.estrellas || d.stars || 0);
      if (stars > 0) {
        sum += stars;
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
 * Obtiene la calificación que dio el usuario actual a este wallpaper.
 */
export async function getUserRating(wallpaperId) {
  const user = auth.currentUser;
  if (!user || !wallpaperId) return 0;
  const wId = String(wallpaperId);

  const localVal = parseInt(localStorage.getItem(`wp_user_vote_${wId}_${user.uid}`) || '0', 10);

  try {
    const voteDocRef = doc(db, 'estrellas', `${wId}_${user.uid}`);
    const snap = await getDoc(voteDocRef);
    if (snap.exists()) {
      return snap.data().estrellas || snap.data().stars || localVal;
    }
    return localVal;
  } catch (_) {
    return localVal;
  }
}

/**
 * Carga los fondos que han sido aprobados por el administrador en Firestore
 * para mostrarlos automáticamente en la galería principal de Nekutoon.
 */
export async function loadApprovedWallpapers() {
  const approvedList = [];
  const seenUrls = new Set();

  try {
    const q1 = query(collection(db, 'submissions'), where('status', '==', 'approved'));
    const snap1 = await getDocs(q1);
    snap1.forEach(docSnap => {
      const d = docSnap.data();
      const url = d.archivoUrl || d.storageUrl;
      if (url && !seenUrls.has(url)) {
        seenUrls.add(url);
        approvedList.push(formatWallpaperDoc(docSnap.id, d));
      }
    });
  } catch (_) {}

  try {
    const q2 = query(collection(db, 'fondos_revision'), where('estado', '==', 'aprobado'));
    const snap2 = await getDocs(q2);
    snap2.forEach(docSnap => {
      const d = docSnap.data();
      const url = d.archivoUrl || d.storageUrl;
      if (url && !seenUrls.has(url)) {
        seenUrls.add(url);
        approvedList.push(formatWallpaperDoc(docSnap.id, d));
      }
    });
  } catch (_) {}

  return approvedList;
}

function formatWallpaperDoc(id, d) {
  const url = d.archivoUrl || d.storageUrl || '';
  const isVideo = url.includes('.mp4') || d.orientation === 'video' || d.orientacion === 'video';
  const isPortrait = d.orientacion === 'Vertical' || d.orientation === 'portrait';

  return {
    id: 'sub_' + id,
    title: d.titulo || d.title || 'Fondo Comunitario',
    file_name: (d.titulo || d.title || 'wallpaper').toLowerCase().replace(/\s+/g, '_') + (isVideo ? '.mp4' : '.jpg'),
    type: isVideo ? 'video' : 'image',
    is_video: isVideo,
    category: d.categoria || d.category || 'Anime',
    tags: d.etiquetas || d.tags || [],
    orientation: isPortrait ? 'portrait' : 'landscape',
    aspect_ratio: isPortrait ? 0.56 : 1.78,
    thumbnail: url,
    hd_url: url,
    resolution: d.resolucion || d.resolution || '4K Ultra HD',
    authorName: d.usuarioNombre || d.authorName || 'Comunidad',
    authorPhoto: d.usuarioFoto || d.authorPhoto || '',
    is_community: true
  };
}

const communityAPI = {
  subscribeComments,
  loadComments,
  postComment,
  subscribeRatings,
  setRating,
  getAvgRating,
  getUserRating,
  loadApprovedWallpapers
};

if (typeof window !== 'undefined') {
  window.WP_COMMUNITY = communityAPI;
  window.dispatchEvent(new CustomEvent('wp:community-ready', { detail: communityAPI }));
}

export default communityAPI;
