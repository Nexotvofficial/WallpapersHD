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
      const ids = new Set(comments.map(c => c.id));
      localList.forEach(l => {
        if (!ids.has(l.id)) comments.unshift(l);
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

    const ids = new Set(comments.map(c => c.id));
    localList.forEach(l => {
      if (!ids.has(l.id)) comments.unshift(l);
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

/**
 * Obtiene el conteo total de seguidores de un creador.
 */
export async function getFollowersCount(creatorUid) {
  if (!creatorUid) return 0;
  try {
    const q = query(collection(db, 'seguidores'), where('creatorUid', '==', creatorUid));
    const snap = await getDocs(q);
    return snap.size || 0;
  } catch (_) {
    return 0;
  }
}

/**
 * Escucha en tiempo real los seguidores de un creador.
 */
export function subscribeFollowers(creatorUid, callback) {
  if (!creatorUid) return () => {};
  try {
    const q = query(collection(db, 'seguidores'), where('creatorUid', '==', creatorUid));
    return onSnapshot(q, (snap) => {
      callback(snap.size || 0);
    }, () => {
      getFollowersCount(creatorUid).then(callback);
    });
  } catch (_) {
    getFollowersCount(creatorUid).then(callback);
    return () => {};
  }
}

/* ==========================================================================
   4. RANKING / TOP CREADORES DEL MES
   ========================================================================== */

/**
 * Obtiene los creadores más seguidos y activos del mes.
 */
export async function getTopCreators(limitCount = 6) {
  const creatorsMap = new Map();

  // Creadores base destacados del sitio
  const defaultCreators = [
    {
      uid: 'c_nekutoon',
      name: 'Nekutoon Studio',
      photo: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80',
      badge: 'Oficial',
      wallpapersCount: 24,
      followersCount: 1540
    },
    {
      uid: 'c_cyberpunk',
      name: 'NeoTokyo Arts',
      photo: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80',
      badge: 'Top Creador',
      wallpapersCount: 18,
      followersCount: 920
    },
    {
      uid: 'c_animevibe',
      name: 'AnimeVibe Lab',
      photo: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=120&auto=format&fit=crop&q=80',
      badge: 'Verificado',
      wallpapersCount: 15,
      followersCount: 780
    },
    {
      uid: 'c_automotive',
      name: 'SpeedApex 4K',
      photo: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=120&auto=format&fit=crop&q=80',
      badge: 'Autos VIP',
      wallpapersCount: 12,
      followersCount: 650
    }
  ];

  defaultCreators.forEach(c => creatorsMap.set(c.uid, c));

  // Cargar creadores reales que han subido fondos aprobados
  try {
    const approvedWallpapers = await loadApprovedWallpapers();
    approvedWallpapers.forEach(w => {
      const uid = w.authorUid || w.authorName;
      if (!uid) return;
      if (creatorsMap.has(uid)) {
        const c = creatorsMap.get(uid);
        c.wallpapersCount = (c.wallpapersCount || 0) + 1;
      } else {
        creatorsMap.set(uid, {
          uid,
          name: w.authorName || 'Creador de la Comunidad',
          photo: w.authorPhoto || '',
          badge: 'Comunidad',
          wallpapersCount: 1,
          followersCount: 1
        });
      }
    });
  } catch (_) {}

  // Contar seguidores en Firestore para cada creador
  try {
    const followersSnap = await getDocs(collection(db, 'seguidores'));
    followersSnap.forEach(docSnap => {
      const d = docSnap.data();
      if (d.creatorUid && creatorsMap.has(d.creatorUid)) {
        const c = creatorsMap.get(d.creatorUid);
        c.followersCount = (c.followersCount || 0) + 1;
      }
    });
  } catch (_) {}

  const sorted = Array.from(creatorsMap.values())
    .sort((a, b) => b.followersCount - a.followersCount)
    .slice(0, limitCount);

  return sorted;
}

/* ==========================================================================
   5. CARGA AUTOMÁTICA DE FONDOS APROBADOS
   ========================================================================== */

export async function loadApprovedWallpapers() {
  const approvedList = [];
  const seenUrls = new Set();

  const isApprovedStatus = (st) => {
    if (!st) return false;
    const s = String(st).toLowerCase().trim();
    return s === 'approved' || s === 'aprobado';
  };

  // 1. Desde 'submissions'
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

  // 2. Desde 'fondos_revision'
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
  loadApprovedWallpapers
};

if (typeof window !== 'undefined') {
  window.WP_COMMUNITY = communityAPI;
  window.dispatchEvent(new CustomEvent('wp:community-ready', { detail: communityAPI }));
}

export default communityAPI;
