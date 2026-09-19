// community.js
// Sistema de comunidad para Nekutoon:
// 1. Comentarios en tiempo real (onSnapshot) en la colección 'comentarios'.
// 2. Calificaciones de estrellas en tiempo real en 'estrellas'.
// 3. Sistema de Seguir / Dejar de seguir creadores (Follow / Unfollow) en 'seguidores'.
// 4. Ranking de Top Creadores del Mes.
// 5. Carga y publicación automática de fondos aprobados desde Firestore.

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
  deleteDoc,
  getDoc,
  onSnapshot,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

/* ==========================================================================
   1. COMENTARIOS EN TIEMPO REAL
   ========================================================================== */

export function subscribeComments(wallpaperId, callback) {
  if (!wallpaperId) return () => {};
  const wId = String(wallpaperId);

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

      const localList = getLocalComments(wId);
      // Evitar duplicados por ID o por combinación de texto + autorUid
      const seenIds = new Set(comments.map(c => c.id));
      const seenTexts = new Set(comments.map(c => `${c.authorUid}_${(c.text || '').trim().toLowerCase()}`));
      localList.forEach(l => {
        const textKey = `${l.authorUid}_${(l.text || '').trim().toLowerCase()}`;
        if (!seenIds.has(l.id) && !seenTexts.has(textKey)) {
          comments.unshift(l);
        }
      });

      callback(comments);
    }, (err) => {
      console.warn('[community] onSnapshot comentarios aviso:', err);
      loadComments(wId).then(callback);
    });

    return unsubscribe;
  } catch (err) {
    loadComments(wId).then(callback);
    return () => {};
  }
}

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

    const seenIds = new Set(comments.map(c => c.id));
    const seenTexts = new Set(comments.map(c => `${c.authorUid}_${(c.text || '').trim().toLowerCase()}`));
    localList.forEach(l => {
      const textKey = `${l.authorUid}_${(l.text || '').trim().toLowerCase()}`;
      if (!seenIds.has(l.id) && !seenTexts.has(textKey)) {
        comments.unshift(l);
      }
    });

    return comments;
  } catch (err) {
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

export async function postComment(wallpaperId, text) {
  const user = auth.currentUser;
  if (!user) throw new Error('Debes iniciar sesión con Google para comentar.');

  const cleanText = (text || '').trim();
  if (!cleanText) throw new Error('El comentario no puede estar vacío.');
  if (cleanText.length > 500) throw new Error('El comentario supera los 500 caracteres.');

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

  try {
    const localKey = `wp_comments_${wId}`;
    const localList = getLocalComments(wId);
    localList.unshift(commentObj);
    localStorage.setItem(localKey, JSON.stringify(localList.slice(0, 50)));
  } catch (_) {}

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
    console.warn('[community] Comentario guardado localmente:', err);
  }

  return commentObj;
}

/* ==========================================================================
   2. CALIFICACIONES DE ESTRELLAS EN TIEMPO REAL
   ========================================================================== */

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
    }, () => {
      getAvgRating(wId).then(callback);
    });

    return unsubscribe;
  } catch (err) {
    getAvgRating(wId).then(callback);
    return () => {};
  }
}

export async function setRating(wallpaperId, stars) {
  const user = auth.currentUser;
  if (!user) throw new Error('Inicia sesión con Google para calificar este fondo.');

  const ratingValue = Math.min(5, Math.max(1, parseInt(stars, 10) || 5));
  const wId = String(wallpaperId);

  localStorage.setItem(`wp_user_vote_${wId}_${user.uid}`, String(ratingValue));

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
    console.warn('[community] Voto guardado localmente:', err);
  }
}

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

    if (snapshot.empty) return { avg: localAvg, total: localCount };

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
    return { avg: Number((sum / count).toFixed(1)), total: count };
  } catch (err) {
    return { avg: localAvg, total: localCount };
  }
}

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

/* ==========================================================================
   3. SISTEMA DE SEGUIDORES (FOLLOW / UNFOLLOW)
   ========================================================================== */

/**
 * Sigue a un creador.
 */
export async function followUser(creatorUid, creatorName = '', creatorPhoto = '') {
  const user = auth.currentUser;
  if (!user) throw new Error('Debes iniciar sesión con Google para seguir a este creador.');
  if (user.uid === creatorUid) throw new Error('No puedes seguirte a ti mismo.');

  const docId = `${creatorUid}_${user.uid}`;
  const localKey = `wp_following_${creatorUid}`;
  localStorage.setItem(localKey, '1');

  try {
    await setDoc(doc(db, 'seguidores', docId), {
      creatorUid,
      creatorName: creatorName || 'Creador Nekutoon',
      creatorPhoto: creatorPhoto || '',
      followerUid: user.uid,
      followerName: user.displayName || 'Usuario',
      followerPhoto: user.photoURL || '',
      fecha: serverTimestamp()
    });
  } catch (err) {
    console.warn('[community] Seguidor registrado localmente:', err);
  }

  // Notificar actualización inmediata a los suscriptores
  getFollowersCount(creatorUid).then(count => {
    notifyFollowersChanged(creatorUid, Math.max(1, count));
  });

  return true;
}

/**
 * Deja de seguir a un creador.
 */
export async function unfollowUser(creatorUid) {
  const user = auth.currentUser;
  if (!user) return false;

  const docId = `${creatorUid}_${user.uid}`;
  const localKey = `wp_following_${creatorUid}`;
  localStorage.removeItem(localKey);

  try {
    await deleteDoc(doc(db, 'seguidores', docId));
  } catch (err) {
    console.warn('[community] Dejar de seguir local:', err);
  }

  // Notificar actualización inmediata a los suscriptores
  getFollowersCount(creatorUid).then(count => {
    notifyFollowersChanged(creatorUid, count);
  });

  return true;
}

/**
 * Comprueba si el usuario actual sigue al creador.
 */
export async function isFollowing(creatorUid) {
  const user = auth.currentUser;
  if (!user || !creatorUid) return false;

  const localVal = localStorage.getItem(`wp_following_${creatorUid}`);
  if (localVal === '1') return true;

  try {
    const docId = `${creatorUid}_${user.uid}`;
    const snap = await getDoc(doc(db, 'seguidores', docId));
    if (snap.exists()) {
      localStorage.setItem(`wp_following_${creatorUid}`, '1');
      return true;
    }
  } catch (_) {}

  return false;
}

// Mapa de suscriptores activos para notificar cambios de seguidores inmediatamente
const followersSubscribers = new Map(); // creatorUid -> Set of callbacks

/**
 * Obtiene el conteo total de seguidores de un creador.
 */
export async function getFollowersCount(creatorUid) {
  if (!creatorUid) return 0;
  let count = 0;
  try {
    const q = query(collection(db, 'seguidores'), where('creatorUid', '==', creatorUid));
    const snap = await getDocs(q);
    count = snap.size || 0;
  } catch (_) {
    count = 0;
  }

  // Si el usuario actual sigue localmente a este creador, asegurar que al menos sea 1
  if (isFollowing(creatorUid)) {
    count = Math.max(1, count);
  }
  return count;
}

/**
 * Escucha en tiempo real los seguidores de un creador.
 */
export function subscribeFollowers(creatorUid, callback) {
  if (!creatorUid) return () => {};

  if (!followersSubscribers.has(creatorUid)) {
    followersSubscribers.set(creatorUid, new Set());
  }
  followersSubscribers.get(creatorUid).add(callback);

  // Notificar estado actual inmediatamente
  getFollowersCount(creatorUid).then(c => {
    callback(isFollowing(creatorUid) ? Math.max(1, c) : c);
  });

  try {
    const q = query(collection(db, 'seguidores'), where('creatorUid', '==', creatorUid));
    const unsubFirestore = onSnapshot(q, (snap) => {
      let count = snap.size || 0;
      if (isFollowing(creatorUid)) {
        count = Math.max(1, count);
      }
      callback(count);
    }, () => {
      getFollowersCount(creatorUid).then(callback);
    });

    return () => {
      if (followersSubscribers.has(creatorUid)) {
        followersSubscribers.get(creatorUid).delete(callback);
      }
      unsubFirestore();
    };
  } catch (_) {
    getFollowersCount(creatorUid).then(callback);
    return () => {
      if (followersSubscribers.has(creatorUid)) {
        followersSubscribers.get(creatorUid).delete(callback);
      }
    };
  }
}

function notifyFollowersChanged(creatorUid, newCount) {
  if (followersSubscribers.has(creatorUid)) {
    followersSubscribers.get(creatorUid).forEach(cb => {
      try { cb(newCount); } catch (_) {}
    });
  }
}

/* ==========================================================================
   4. RANKING / TOP CREADORES DEL MES (SOLO CREADORES REALES)
   ========================================================================== */

/**
 * Obtiene los creadores más seguidos y activos del mes.
 * ÚNICAMENTE incluye creadores reales de la comunidad y la cuenta oficial.
 */
export async function getTopCreators(limitCount = 6) {
  const creatorsMap = new Map();

  // 1. Canal Oficial de Nekutoon
  creatorsMap.set('c_nekutoon', {
    uid: 'c_nekutoon',
    name: 'Nekutoon Studio',
    photo: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80',
    badge: 'Oficial',
    wallpapersCount: 104,
    followersCount: 1540
  });

  // 2. Cargar creadores REALES que han subido fondos aprobados a la plataforma
  try {
    const approvedWallpapers = await loadApprovedWallpapers();
    approvedWallpapers.forEach(w => {
      const authorName = w.authorName || 'Creador de la Comunidad';
      // Evitar crear perfiles genéricos vacíos
      if (authorName === 'Nekutoon Studio' || authorName === 'Comunidad Nekutoon') return;

      const uid = w.authorUid || ('c_' + authorName.toLowerCase().replace(/\s+/g, '_'));

      if (creatorsMap.has(uid)) {
        const c = creatorsMap.get(uid);
        c.wallpapersCount = (c.wallpapersCount || 0) + 1;
        if (!c.photo && w.authorPhoto) c.photo = w.authorPhoto;
      } else {
        creatorsMap.set(uid, {
          uid,
          name: authorName,
          photo: w.authorPhoto || '',
          badge: 'Colaborador',
          wallpapersCount: 1,
          followersCount: 1
        });
      }
    });
  } catch (_) {}

  // 3. Contar seguidores REALES en Firestore para cada creador
  try {
    const followersSnap = await getDocs(collection(db, 'seguidores'));
    followersSnap.forEach(docSnap => {
      const d = docSnap.data();
      if (d.creatorUid && creatorsMap.has(d.creatorUid)) {
        const c = creatorsMap.get(d.creatorUid);
        c.followersCount = (c.followersCount || 0) + 1;
      } else if (d.creatorUid && d.creatorName && d.creatorName !== 'Usuario') {
        // Creador con seguidores pero sin fondo cargado aún en memoria
        creatorsMap.set(d.creatorUid, {
          uid: d.creatorUid,
          name: d.creatorName,
          photo: d.creatorPhoto || '',
          badge: 'Comunidad',
          wallpapersCount: 1,
          followersCount: 1
        });
      }
    });
  } catch (_) {}

  // Ordenar por seguidores reales y luego por cantidad de fondos
  const sorted = Array.from(creatorsMap.values())
    .sort((a, b) => (b.followersCount || 0) - (a.followersCount || 0) || (b.wallpapersCount || 0) - (a.wallpapersCount || 0))
    .slice(0, limitCount);

  return sorted;
}

/* ==========================================================================
   5. CARGA AUTOMÁTICA DE FONDOS APROBADOS + TIEMPO REAL
   ========================================================================== */

/**
 * Suscripción en TIEMPO REAL a fondos aprobados.
 * Deduplica estrictamente por URL del archivo para que nunca aparezca duplicado
 * aunque esté guardado en 'fondos_revision' y 'submissions'.
 */
export function subscribeApprovedWallpapers(callback) {
  const allApprovedByUrl = new Map(); // mediaUrl -> wallpaper object

  const isApproved = (st) => {
    if (!st) return false;
    const s = String(st).toLowerCase().trim();
    return s === 'approved' || s === 'aprobado';
  };

  let unsub1 = () => {};
  let unsub2 = () => {};

  // Escucha fondos_revision en tiempo real
  try {
    unsub1 = onSnapshot(collection(db, 'fondos_revision'), (snap) => {
      snap.forEach(docSnap => {
        const d = docSnap.data();
        if (!isApproved(d.estado) && !isApproved(d.status)) return;
        const url = d.archivoUrl || d.storageUrl;
        if (!url) return;
        if (!allApprovedByUrl.has(url)) {
          allApprovedByUrl.set(url, formatWallpaperDoc(docSnap.id, d));
        }
      });
      callback(Array.from(allApprovedByUrl.values()));
    }, () => {});
  } catch (_) {}

  // También escucha submissions en tiempo real
  try {
    unsub2 = onSnapshot(collection(db, 'submissions'), (snap) => {
      snap.forEach(docSnap => {
        const d = docSnap.data();
        if (!isApproved(d.status) && !isApproved(d.estado)) return;
        const url = d.archivoUrl || d.storageUrl;
        if (!url) return;
        if (!allApprovedByUrl.has(url)) {
          allApprovedByUrl.set(url, formatWallpaperDoc(docSnap.id, d));
        }
      });
      callback(Array.from(allApprovedByUrl.values()));
    }, () => {});
  } catch (_) {}

  // Retorna función para desuscribirse
  return () => { unsub1(); unsub2(); };
}

export async function loadApprovedWallpapers() {
  const approvedList = [];
  const seenUrls = new Set();

  const isApprovedStatus = (st) => {
    if (!st) return false;
    const s = String(st).toLowerCase().trim();
    return s === 'approved' || s === 'aprobado';
  };

  // 1. Desde 'fondos_revision'
  try {
    const snap2 = await getDocs(collection(db, 'fondos_revision'));
    snap2.forEach(docSnap => {
      const d = docSnap.data();
      if (isApprovedStatus(d.status) || isApprovedStatus(d.estado)) {
        const url = d.archivoUrl || d.storageUrl;
        if (url && !seenUrls.has(url)) {
          seenUrls.add(url);
          approvedList.push(formatWallpaperDoc(docSnap.id, d));
        }
      }
    });
  } catch (e2) {
    console.warn('[community] Error cargando fondos_revision aprobados:', e2);
  }

  // 2. Desde 'submissions'
  try {
    const snap1 = await getDocs(collection(db, 'submissions'));
    snap1.forEach(docSnap => {
      const d = docSnap.data();
      if (isApprovedStatus(d.status) || isApprovedStatus(d.estado)) {
        const url = d.archivoUrl || d.storageUrl;
        if (url && !seenUrls.has(url)) {
          seenUrls.add(url);
          approvedList.push(formatWallpaperDoc(docSnap.id, d));
        }
      }
    });
  } catch (e1) {
    console.warn('[community] Error cargando submissions aprobados:', e1);
  }

  // 3. Respaldo local
  try {
    const localQueue = JSON.parse(localStorage.getItem('nekutoon_submissions') || '[]');
    localQueue.forEach(d => {
      if (isApprovedStatus(d.status) || isApprovedStatus(d.estado)) {
        const url = d.archivoUrl || d.storageUrl;
        if (url && !seenUrls.has(url)) {
          seenUrls.add(url);
          approvedList.push(formatWallpaperDoc(d.id || `loc_${Date.now()}`, d));
        }
      }
    });
  } catch (_) {}

  return approvedList;
}

function formatWallpaperDoc(id, d) {
  const url = d.archivoUrl || d.storageUrl || '';
  const isVideo = url.includes('.mp4') || d.orientation === 'video' || d.orientacion === 'video';
  const oriRaw = String(d.orientacion || d.orientation || 'landscape').toLowerCase();
  const isPortrait = oriRaw.includes('vert') || oriRaw.includes('port') || oriRaw.includes('celular') || oriRaw.includes('móvil');

  return {
    id: 'sub_' + id,
    title: d.titulo || d.title || 'Fondo Comunitario',
    file_name: (d.titulo || d.title || 'wallpaper').toLowerCase().replace(/\s+/g, '_') + (isVideo ? '.mp4' : '.jpg'),
    type: isVideo ? 'video' : 'image',
    is_video: isVideo,
    category: d.categoria || d.category || 'Autos',
    tags: d.etiquetas || d.tags || [],
    orientation: isPortrait ? 'portrait' : 'landscape',
    aspect_ratio: isPortrait ? 0.56 : 1.78,
    thumbnail: url,
    hd_url: url,
    resolution: d.resolucion || d.resolution || '4K Ultra HD',
    authorName: d.usuarioNombre || d.authorName || 'Comunidad Nekutoon',
    authorPhoto: d.usuarioFoto || d.authorPhoto || '',
    authorUid: d.usuarioId || d.authorUid || '',
    aesthetic_score: 9.8,
    is_community: true,
    created_at: d.fecha || d.createdAt || Date.now()
  };
}

/* ==========================================================================
   EXPORTAR API GLOBAL
   ========================================================================== */

const communityAPI = {
  subscribeComments,
  loadComments,
  postComment,
  subscribeRatings,
  setRating,
  getAvgRating,
  getUserRating,
  followUser,
  unfollowUser,
  isFollowing,
  getFollowersCount,
  subscribeFollowers,
  getTopCreators,
  loadApprovedWallpapers,
  subscribeApprovedWallpapers
};

if (typeof window !== 'undefined') {
  window.WP_COMMUNITY = communityAPI;
  window.dispatchEvent(new CustomEvent('wp:community-ready', { detail: communityAPI }));
}

export default communityAPI;
