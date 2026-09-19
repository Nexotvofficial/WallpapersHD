// submit.js
// Lógica de subida de fondos de usuarios hacia Firebase Storage y Firestore

import { auth, storage, db, watchAuthState, loginWithGoogle } from './firebase-init.js';
import { ref, uploadBytesResumable, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js';
import { collection, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

let currentUser = null;
let selectedFile = null;

// DOM Elements
const authPrompt = document.getElementById('auth-prompt');
const formContainer = document.getElementById('upload-form-container');
const uploadForm = document.getElementById('upload-form');
const fileInput = document.getElementById('file-input');
const dropzone = document.getElementById('dropzone');
const previewContainer = document.getElementById('preview-container');
const previewWrapper = document.getElementById('preview-wrapper');
const removePreviewBtn = document.getElementById('remove-preview');
const submitBtn = document.getElementById('submit-btn');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const uploadStatus = document.getElementById('upload-status');
const successMessage = document.getElementById('success-message');
const btnUploadMore = document.getElementById('btn-upload-more');

function initAuthCheck() {
  watchAuthState((user) => {
    currentUser = user;
    if (user) {
      if (authPrompt) authPrompt.style.display = 'none';
      if (formContainer) formContainer.style.display = 'block';
    } else {
      if (authPrompt) authPrompt.style.display = 'block';
      if (formContainer) formContainer.style.display = 'none';
    }
  });

  document.getElementById('btn-login-prompt')?.addEventListener('click', () => {
    loginWithGoogle().catch((err) => {
      console.warn('Error al iniciar sesión:', err);
    });
  });
}

function setupDropzone() {
  if (!dropzone || !fileInput) return;

  dropzone.addEventListener('click', () => fileInput.click());

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, false);
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropzone.addEventListener(eventName, () => dropzone.classList.add('dragover'), false);
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    dropzone.addEventListener(eventName, () => dropzone.classList.remove('dragover'), false);
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length) handleFileSelect(files[0]);
  });

  fileInput.addEventListener('change', function () {
    if (this.files.length) handleFileSelect(this.files[0]);
  });

  removePreviewBtn?.addEventListener('click', () => {
    selectedFile = null;
    fileInput.value = '';
    previewContainer.style.display = 'none';
    dropzone.style.display = 'block';
    previewWrapper.innerHTML = '';
  });
}

function handleFileSelect(file) {
  const MAX_SIZE = 50 * 1024 * 1024; // 50MB
  if (file.size > MAX_SIZE) {
    alert('El archivo supera el límite permitido de 50MB.');
    return;
  }

  if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
    alert('Solo se permiten archivos de imagen (WEBP, PNG, JPG) o video (MP4).');
    return;
  }

  selectedFile = file;
  dropzone.style.display = 'none';
  previewContainer.style.display = 'block';

  const objectUrl = URL.createObjectURL(file);
  previewWrapper.innerHTML = '';

  if (file.type.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = objectUrl;
    img.className = 'preview-media';
    img.alt = 'Vista previa';
    previewWrapper.appendChild(img);
  } else {
    const video = document.createElement('video');
    video.src = objectUrl;
    video.className = 'preview-media';
    video.controls = true;
    video.autoplay = true;
    video.muted = true;
    video.loop = true;
    previewWrapper.appendChild(video);
  }
}

async function handleSubmit(e) {
  e.preventDefault();

  if (!currentUser) {
    alert('Debes iniciar sesión con Google para enviar un fondo.');
    return;
  }

  if (!selectedFile) {
    alert('Por favor selecciona una imagen o video para subir.');
    return;
  }

  const title = document.getElementById('title').value.trim();
  const category = document.getElementById('category').value;
  const resolution = document.getElementById('resolution').value;
  const tagsInput = document.getElementById('tags').value;
  const orientation = document.querySelector('input[name="orientation"]:checked')?.value || 'landscape';

  const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);

  submitBtn.disabled = true;
  submitBtn.textContent = 'Subiendo archivo a la nube…';
  progressContainer.style.display = 'block';
  uploadStatus.style.display = 'block';

  try {
    const timestamp = Date.now();
    const safeFilename = selectedFile.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const storagePath = `submissions/${currentUser.uid}/${timestamp}_${safeFilename}`;
    const storageReference = ref(storage, storagePath);

    const uploadTask = uploadBytesResumable(storageReference, selectedFile);

    uploadTask.on('state_changed',
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        progressBar.style.width = progress + '%';
        uploadStatus.textContent = `Subiendo: ${Math.round(progress)}%`;
      },
      (error) => {
        console.error('Error en subida:', error);
        alert('Ocurrió un error al subir el archivo. Intenta de nuevo.');
        resetFormState();
      },
      async () => {
        try {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);

          // Guardar metadatos en Firestore con status: 'pending' para moderación
          await addDoc(collection(db, 'submissions'), {
            title,
            category,
            tags,
            resolution,
            orientation,
            storageUrl: downloadURL,
            authorUid: currentUser.uid,
            authorName: currentUser.displayName || 'Usuario Nekutoon',
            authorPhoto: currentUser.photoURL || '',
            status: 'pending',
            createdAt: serverTimestamp()
          });

          uploadForm.style.display = 'none';
          successMessage.style.display = 'block';
        } catch (dbError) {
          console.error('Error en Firestore:', dbError);
          alert('Archivo subido pero no se pudieron registrar los datos. Contacta a soporte.');
          resetFormState();
        }
      }
    );
  } catch (err) {
    console.error(err);
    alert('Ocurrió un error inesperado al iniciar la subida.');
    resetFormState();
  }
}

function resetFormState() {
  submitBtn.disabled = false;
  submitBtn.textContent = 'Enviar fondo para revisión';
  progressContainer.style.display = 'none';
  uploadStatus.style.display = 'none';
  progressBar.style.width = '0%';
}

btnUploadMore?.addEventListener('click', () => {
  uploadForm.reset();
  selectedFile = null;
  fileInput.value = '';
  previewContainer.style.display = 'none';
  dropzone.style.display = 'block';
  previewWrapper.innerHTML = '';

  successMessage.style.display = 'none';
  uploadForm.style.display = 'block';
  resetFormState();
});

document.addEventListener('DOMContentLoaded', () => {
  initAuthCheck();
  setupDropzone();
  uploadForm?.addEventListener('submit', handleSubmit);
});
