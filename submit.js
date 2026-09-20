// submit.js — Subida via Cloudinary + Firestore (fondos_revision y submissions)
import { auth, db, watchAuthState, loginWithGoogle } from './firebase-init.js';
import { collection, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

// ─── Cloudinary config ──────────────────────────────────────────────────────
const CLOUD_NAME = "siypq1kf";
// Se prueban ambos presets por si en Cloudinary se creó con punto final ("nekutoon_preset.") o sin punto ("nekutoon_preset")
const PRESETS_TO_TRY = ["nekutoon_preset.", "nekutoon_preset"];
// ────────────────────────────────────────────────────────────────────────────

let currentUser  = null;
let selectedFile = null;

// DOM refs
const authPrompt       = document.getElementById('auth-prompt');
const formContainer    = document.getElementById('upload-form-container');
const uploadForm       = document.getElementById('upload-form');
const fileInput        = document.getElementById('file-input');
const dropzone         = document.getElementById('dropzone');
const previewContainer = document.getElementById('preview-container');
const previewWrapper   = document.getElementById('preview-wrapper');
const removePreviewBtn = document.getElementById('remove-preview');
const submitBtn        = document.getElementById('submit-btn');
const progressWrap     = document.getElementById('progress-container');
const progressBar      = document.getElementById('progress-bar');
const progressLabel    = document.getElementById('upload-status');
const successMessage   = document.getElementById('success-message');
const btnUploadMore    = document.getElementById('btn-upload-more');

/* ── Auth ─────────────────────────────────────────────────────────────────── */
function initAuthCheck() {
  watchAuthState((user) => {
    currentUser = user;
    if (authPrompt)    authPrompt.style.display    = user ? 'none'  : 'block';
    if (formContainer) formContainer.style.display = user ? 'block' : 'none';
  });

  document.getElementById('btn-login-prompt')?.addEventListener('click', () =>
    loginWithGoogle().catch(err => console.warn('Login error:', err))
  );
}

/* ── Dropzone ─────────────────────────────────────────────────────────────── */
function setupDropzone() {
  if (!dropzone || !fileInput) return;

  dropzone.addEventListener('click', () => fileInput.click());

  ['dragenter','dragover','dragleave','drop'].forEach(ev =>
    dropzone.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }, false)
  );
  ['dragenter','dragover'].forEach(ev =>
    dropzone.addEventListener(ev, () => dropzone.classList.add('dragover'), false)
  );
  ['dragleave','drop'].forEach(ev =>
    dropzone.addEventListener(ev, () => dropzone.classList.remove('dragover'), false)
  );

  dropzone.addEventListener('drop', e => {
    const files = e.dataTransfer?.files;
    if (files?.length) handleFileSelect(files[0]);
  });

  fileInput.addEventListener('change', function () {
    if (this.files.length) handleFileSelect(this.files[0]);
  });

  removePreviewBtn?.addEventListener('click', clearPreview);
}

function clearPreview() {
  selectedFile                   = null;
  fileInput.value                = '';
  previewContainer.style.display = 'none';
  dropzone.style.display         = 'block';
  previewWrapper.innerHTML       = '';
  const badge = document.getElementById('file-name-badge');
  if (badge) badge.style.display = 'none';
}

function handleFileSelect(file) {
  if (file.size > 50 * 1024 * 1024) {
    showToast('El archivo supera el límite de 50 MB.', 'error'); return;
  }
  if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
    showToast('Solo se permiten imágenes (WEBP, PNG, JPG) o video (MP4).', 'error'); return;
  }

  selectedFile = file;
  dropzone.style.display         = 'none';
  previewContainer.style.display = 'block';

  previewWrapper.innerHTML = '';
  const url = URL.createObjectURL(file);

  if (file.type.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = url; img.className = 'preview-media'; img.alt = 'Vista previa';
    previewWrapper.appendChild(img);
    img.onload = () => {
      const isPortrait = img.naturalHeight > img.naturalWidth;
      const radio = document.querySelector('input[name="orientation"][value="' + (isPortrait ? 'portrait' : 'landscape') + '"]');
      if(radio) radio.checked = true;
      showToast('✨ Formato detectado: ' + (isPortrait ? 'Vertical (Celular)' : 'Horizontal (PC)'));
    };
  } else {
    const vid = document.createElement('video');
    vid.src = url; vid.className = 'preview-media';
    vid.controls = true; vid.autoplay = true; vid.muted = true; vid.loop = true;
    previewWrapper.appendChild(vid);
    vid.onloadedmetadata = () => {
      const isPortrait = vid.videoHeight > vid.videoWidth;
      const radio = document.querySelector('input[name="orientation"][value="' + (isPortrait ? 'portrait' : 'landscape') + '"]');
      if(radio) radio.checked = true;
      showToast('✨ Formato de video detectado: ' + (isPortrait ? 'Vertical' : 'Horizontal'));
    };
  }

  // Actualizar badge del dropzone con nombre de archivo
  const badge = document.getElementById('file-name-badge');
  if (badge) { badge.textContent = file.name; badge.style.display = 'inline-flex'; }
}

/* ── Subida a Cloudinary con reintento automático de presets ──────────────── */
async function uploadToCloudinary(file) {
  const resourceType = file.type.startsWith('video/') ? 'video' : 'image';
  let lastError = null;

  for (const preset of PRESETS_TO_TRY) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', preset);

    try {
      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (res.ok && data.secure_url) {
        return data.secure_url;
      }
      lastError = data?.error?.message || `HTTP ${res.status}`;
    } catch (err) {
      lastError = err.message;
    }
  }

  throw new Error(lastError || 'No se pudo subir a Cloudinary');
}

/* ── Submit Handler ──────────────────────────────────────────────────────── */
async function handleSubmit(e) {
  e.preventDefault();

  if (!currentUser) { showToast('Debes iniciar sesión primero.', 'error'); return; }
  if (!selectedFile) { showToast('Selecciona una imagen o video para subir.', 'error'); return; }

  const title       = document.getElementById('title').value.trim();
  const category    = document.getElementById('category').value;
  const resolution  = document.getElementById('resolution').value;
  const tagsRaw     = document.getElementById('tags').value;
  const orientation = document.querySelector('input[name="orientation"]:checked')?.value || 'landscape';
  const tags        = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);

  if (!title)    { showToast('Escribe un título para el fondo.', 'error'); return; }
  if (!category) { showToast('Elige una categoría.', 'error'); return; }

  // UI → cargando
  submitBtn.disabled = true;
  setProgress(10, 'Subiendo archivo a Cloudinary…');

  // Animación de progreso visual
  let fakeProgress = 15;
  const ticker = setInterval(() => {
    if (fakeProgress < 85) {
      fakeProgress += 4;
      setProgress(fakeProgress, `Subiendo archivo a Cloudinary… ${fakeProgress}%`);
    }
  }, 250);

  try {
    // ── PASO 1: Subir a Cloudinary ─────────────────────────────────────────
    const cloudUrl = await uploadToCloudinary(selectedFile);
    clearInterval(ticker);

    setProgress(90, 'Guardando en la base de datos…');

    // ── PASO 2: Guardar en Firestore ───────────────────────────────────────
    const submissionData = {
      titulo:        title,
      title:         title,
      categoria:     category,
      category:      category,
      etiquetas:     tags,
      tags:          tags,
      resolucion:    resolution,
      resolution:    resolution,
      orientacion:   orientation,
      orientation:   orientation,
      archivoUrl:    cloudUrl,
      storageUrl:    cloudUrl,
      usuarioId:     currentUser.uid,
      authorUid:     currentUser.uid,
      usuarioNombre: currentUser.displayName || 'Usuario Nekutoon',
      authorName:    currentUser.displayName || 'Usuario Nekutoon',
      usuarioFoto:   currentUser.photoURL    || '',
      authorPhoto:   currentUser.photoURL    || '',
      estado:        'pendiente',
      status:        'pending',
      fecha:         serverTimestamp(),
      createdAt:     serverTimestamp()
    };

    // Guardamos en fondos_revision y submissions para compatibilidad total
    let firestoreSaved = false;

    try {
      await addDoc(collection(db, 'fondos_revision'), submissionData);
      firestoreSaved = true;
    } catch (err1) {
      console.warn('Aviso fondos_revision:', err1);
    }

    try {
      await addDoc(collection(db, 'submissions'), submissionData);
      firestoreSaved = true;
    } catch (err2) {
      console.warn('Aviso submissions:', err2);
    }

    // Respaldo local por si las reglas de Firestore aún no están activadas en la nube
    try {
      const localQueue = JSON.parse(localStorage.getItem('nekutoon_submissions') || '[]');
      localQueue.unshift({ ...submissionData, localTimestamp: Date.now() });
      localStorage.setItem('nekutoon_submissions', JSON.stringify(localQueue.slice(0, 50)));
    } catch (_) {}

    setProgress(100, '¡Completado con éxito!');
    await new Promise(r => setTimeout(r, 500));

    uploadForm.style.display     = 'none';
    successMessage.style.display = 'block';

  } catch (err) {
    clearInterval(ticker);
    console.error('Error en subida:', err);
    showToast(`Error al subir: ${err.message}`, 'error');
    resetFormState();
  }
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function setProgress(pct, label) {
  if (progressWrap)  progressWrap.style.display  = 'block';
  if (progressLabel) { progressLabel.style.display = 'block'; progressLabel.textContent = label; }
  if (progressBar)   progressBar.style.width = pct + '%';
  const pctSpan = document.getElementById('progress-pct');
  if (pctSpan) pctSpan.textContent = Math.round(pct) + '%';
}

function resetFormState() {
  submitBtn.disabled             = false;
  if (progressWrap)  progressWrap.style.display  = 'none';
  if (progressLabel) progressLabel.style.display = 'none';
  if (progressBar)   progressBar.style.width     = '0%';
}

function showToast(msg, type = 'info') {
  const toast = document.getElementById('nk-toast');
  if (!toast) { alert(msg); return; }
  toast.textContent  = msg;
  toast.className    = `nk-toast nk-toast--${type} nk-toast--visible`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('nk-toast--visible'), 4500);
}

btnUploadMore?.addEventListener('click', () => {
  uploadForm.reset();
  clearPreview();
  successMessage.style.display = 'none';
  uploadForm.style.display     = 'block';
  resetFormState();
});

document.addEventListener('DOMContentLoaded', () => {
  initAuthCheck();
  setupDropzone();
  uploadForm?.addEventListener('submit', handleSubmit);
});


