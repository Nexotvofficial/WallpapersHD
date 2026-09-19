// submit.js — Subida via Cloudinary + Firestore (fondos_revision)
import { auth, db, watchAuthState, loginWithGoogle } from './firebase-init.js';
import { collection, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

// ─── Cloudinary config ──────────────────────────────────────────────────────
const CLOUD_NAME    = "siypq1kf";
const UPLOAD_PRESET = "nekutoon_preset";
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
    authPrompt.style.display    = user ? 'none'  : 'block';
    formContainer.style.display = user ? 'block' : 'none';
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
  selectedFile              = null;
  fileInput.value           = '';
  previewContainer.style.display = 'none';
  dropzone.style.display    = 'block';
  previewWrapper.innerHTML  = '';
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
  } else {
    const vid = document.createElement('video');
    vid.src = url; vid.className = 'preview-media';
    vid.controls = true; vid.autoplay = true; vid.muted = true; vid.loop = true;
    previewWrapper.appendChild(vid);
  }

  // Actualizar badge del dropzone con nombre de archivo
  const badge = document.getElementById('file-name-badge');
  if (badge) { badge.textContent = file.name; badge.style.display = 'inline-flex'; }
}

/* ── Upload via Cloudinary ──────────────────────────────────────────────────
   1. Sube el archivo a Cloudinary  →  obtiene secure_url
   2. Guarda metadatos + URL en Firestore  →  fondos_revision
   ─────────────────────────────────────────────────────────────────────────── */
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
  setProgress(0, 'Preparando subida…');

  try {
    // ── PASO 1: Subir a Cloudinary ─────────────────────────────────────────
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('upload_preset', UPLOAD_PRESET);

    setProgress(10, 'Subiendo a Cloudinary…');

    // Simulamos progreso visual mientras XHR real no da progreso en Cloudinary
    let fakeProgress = 10;
    const ticker = setInterval(() => {
      if (fakeProgress < 85) { fakeProgress += 3; setProgress(fakeProgress, `Subiendo… ${fakeProgress}%`); }
    }, 300);

    const resourceType = selectedFile.type.startsWith('video/') ? 'video' : 'image';
    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`,
      { method: 'POST', body: formData }
    );
    clearInterval(ticker);

    if (!res.ok) throw new Error(`Cloudinary error ${res.status}: ${await res.text()}`);

    const data = await res.json();
    const cloudUrl = data.secure_url;

    if (!cloudUrl) throw new Error('Cloudinary no devolvió una URL.');

    setProgress(90, 'Registrando en la base de datos…');

    // ── PASO 2: Guardar en Firestore → fondos_revision ─────────────────────
    await addDoc(collection(db, 'fondos_revision'), {
      titulo:        title,
      categoria:     category,
      etiquetas:     tags,
      resolucion:    resolution,
      orientacion:   orientation,
      archivoUrl:    cloudUrl,
      usuarioId:     currentUser.uid,
      usuarioNombre: currentUser.displayName || 'Usuario Nekutoon',
      usuarioFoto:   currentUser.photoURL    || '',
      estado:        'pendiente',
      fecha:         serverTimestamp()
    });

    setProgress(100, '¡Completado!');
    await new Promise(r => setTimeout(r, 600));

    uploadForm.style.display    = 'none';
    successMessage.style.display = 'block';

  } catch (err) {
    console.error('Error en subida:', err);
    showToast('Ocurrió un error al subir. Intenta de nuevo.', 'error');
    resetFormState();
  }
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function setProgress(pct, label) {
  if (progressWrap)  progressWrap.style.display  = 'block';
  if (progressLabel) { progressLabel.style.display = 'block'; progressLabel.textContent = label; }
  if (progressBar)   progressBar.style.width = pct + '%';
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
  toast._timer = setTimeout(() => toast.classList.remove('nk-toast--visible'), 3800);
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
