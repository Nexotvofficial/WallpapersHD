import json
import os
import random
import re
import subprocess
import threading
import concurrent.futures
import cv2
import requests
import base64
import hashlib
import time
import numpy as np
from PIL import Image, ImageOps

folder = "./img"
thumbs_folder = "./img/thumbs"

OUTPUT_JSON = "wallpapers.json"
CACHE_FILE = "wallpapers_cache.json"

PUBLITIO_KEY = os.environ.get("PUBLITIO_KEY", "tyvWN2nvwQDsPRi7yyg7")
PUBLITIO_SECRET = os.environ.get("PUBLITIO_SECRET", "D8Gj1ASvQtH0x21sP6N7bQT0A98brmVQ")

# Tamaño del placeholder ultra-liviano en base64 que viaja DENTRO del JSON.
# Se pinta al instante (sin red) mientras la imagen/miniatura real carga,
# eliminando el "flash" en blanco/negro al abrir el visor o el grid.
PLACEHOLDER_MAX_SIZE = (24, 42)
PLACEHOLDER_QUALITY = 40

# Cuántos archivos (nuevos o cambiados) se procesan/suben en paralelo.
# Súbelo con cuidado: Publit.io tiene límites de tasa. 4-6 es un rango seguro.
# Nota: desde la optimización de clasificación en lote, estos hilos ya NO
# esperan turno para usar la IA (eso ahora pasa antes, una sola vez), así
# que este número solo importa para ffmpeg y las subidas de red.
MAX_WORKERS = int(os.environ.get("PIPELINE_MAX_WORKERS", "5"))

# Dimensión máxima del lado largo y del lado corto para optimizar video (evita
# subir 4K innecesario en un live wallpaper, pero respeta la orientación real).
VIDEO_MAX_LONG_SIDE = int(os.environ.get("VIDEO_MAX_LONG_SIDE", "1920"))
VIDEO_MAX_SHORT_SIDE = int(os.environ.get("VIDEO_MAX_SHORT_SIDE", "1080"))

# Preset de ffmpeg. "veryfast" es el balance por defecto; si el Action sigue
# lento por muchos videos nuevos, "ultrafast" acelera bastante más a cambio
# de un archivo final un poco más pesado.
VIDEO_PRESET = os.environ.get("VIDEO_PRESET", "veryfast")

# ------------------------------------------------------------------
# LISTA NEGRA DE PALABRAS EN TÍTULOS
# Archivo de texto plano, privado, con una palabra o frase por línea (líneas
# que empiezan con "#" se ignoran). El contenido de esa lista nunca pasa por
# este script como código — el usuario la edita directamente en su repo. Si
# el archivo no existe todavía, simplemente no se borra nada (se comporta
# exactamente igual que antes).
# ------------------------------------------------------------------
TITLE_BLACKLIST_FILE = os.environ.get("TITLE_BLACKLIST_FILE", "title_blacklist.txt")
_title_blacklist_cache = None


def load_title_blacklist():
    global _title_blacklist_cache
    if _title_blacklist_cache is not None:
        return _title_blacklist_cache
    words = []
    if os.path.exists(TITLE_BLACKLIST_FILE):
        with open(TITLE_BLACKLIST_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                words.append(line)
    _title_blacklist_cache = words
    return words


def apply_title_blacklist(title):
    blacklist = load_title_blacklist()
    if not blacklist or not title:
        return title
    cleaned = title
    for word in blacklist:
        pattern = r"\b" + re.escape(word) + r"\b"
        cleaned = re.sub(pattern, "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip(" -_")
    return cleaned if cleaned else "Wallpaper"

# ------------------------------------------------------------------
# SHARDING (procesamiento en paralelo entre varios jobs de Actions)
# Cuando el workflow lanza N jobs en paralelo (matrix), cada uno corre este
# mismo script pero con SHARD_INDEX distinto. Cada shard procesa solo una
# porción de los archivos NUEVOS/cambiados y escribe un archivo parcial
# (wallpapers_shardN.json) en vez de wallpapers.json final. El job "merge"
# del workflow (ver merge_shards.py) junta los N archivos parciales + la
# cache previa en el wallpapers.json definitivo, UNA sola vez.
# Con SHARD_TOTAL=1 (default) el script se comporta exactamente igual que
# antes: corrida única, sin sharding.
# ------------------------------------------------------------------
SHARD_INDEX = int(os.environ.get("SHARD_INDEX", "0"))
SHARD_TOTAL = max(1, int(os.environ.get("SHARD_TOTAL", "1")))
IS_SHARDED = SHARD_TOTAL > 1
SHARD_OUTPUT = f"wallpapers_shard{SHARD_INDEX}.json"

# Modelo de CLIP usado para clasificar imágenes sin prefijo reconocido.
CLIP_MODEL_NAME = os.environ.get("CLIP_MODEL_NAME", "openai/clip-vit-base-patch32")

# ------------------------------------------------------------------
# ARCHIVADO EN REPOS DE ALMACENAMIENTO ROTATIVOS (MULTI-REPO)
# Los archivos originales (img/*) solo hacían falta localmente para: (1)
# procesarlos una vez, (2) servir de respaldo jsDelivr si Publit.io falla,
# (3) calcular su hash. Mantenerlos para siempre infla el repo sin límite.
#
# Publit.io sigue siendo el CDN principal (url_hd / thumbnail), pero AHORA
# el archivado multi-repo dejó de depender de que Publit.io funcione o no:
# se intenta archivar SIEMPRE que haya STORAGE_REPO_TOKEN configurado,
# tanto para imágenes como para videos (mp4).
#
# Hay DOS mecanismos según el tamaño del archivo:
#   - Archivos <= STORAGE_API_SAFE_SIZE_BYTES: API de Contents de GitHub
#     (upload_file_to_storage_repo). Simple: 1 request, pero GitHub la
#     limita a ~1MB por archivo.
#   - Archivos más grandes (típicamente los .mp4 de los live wallpapers):
#     Git Data API (upload_file_via_git_data_api) — crea un blob + árbol +
#     commit + mueve la rama a mano. Soporta archivos bastante más grandes
#     (decenas de MB), que es lo que hacía falta para que los videos
#     también se archivaran en el repo rotativo.
#
# STORAGE_REPO_TOKEN es un fine-grained PAT con permiso "Contents: Read
# and write" sobre TODOS los repos listados en storage_config.json
# (incluido este mismo, si lo incluís en la lista). La Git Data API usa
# el mismo scope, no hace falta nada extra en el token.
# ------------------------------------------------------------------
STORAGE_CONFIG_FILE = "storage_config.json"
STORAGE_REPO_TOKEN = os.environ.get("STORAGE_REPO_TOKEN")

# Umbral que decide QUÉ mecanismo de subida se usa (Contents API vs Git
# Data API) — ya NO decide si se archiva o no. Por encima de este tamaño
# se usa automáticamente la Git Data API, que soporta archivos más grandes.
STORAGE_API_SAFE_SIZE_BYTES = int(os.environ.get("STORAGE_API_SAFE_SIZE_BYTES", str(900 * 1024)))

_storage_config_cache = None
_repo_size_cache = {}
_storage_pick_lock = threading.Lock()

# Lock por repo: cada commit vía Git Data API necesita el SHA del commit
# anterior como padre. Si dos hilos escriben al mismo repo/rama a la vez,
# el segundo push pisaría el ref calculado por el primero. Se serializa
# por repo (no globalmente) para no frenar subidas a repos distintos.
_repo_locks_lock = threading.Lock()
_repo_locks = {}


def _get_repo_lock(repo):
    with _repo_locks_lock:
        if repo not in _repo_locks:
            _repo_locks[repo] = threading.Lock()
        return _repo_locks[repo]


def load_storage_config():
    global _storage_config_cache
    if _storage_config_cache is not None:
        return _storage_config_cache
    config = {"storage_repos": [], "size_limit_mb": 800, "branch": "main"}
    if os.path.exists(STORAGE_CONFIG_FILE):
        try:
            with open(STORAGE_CONFIG_FILE, "r", encoding="utf-8") as f:
                loaded = json.load(f)
            config.update(loaded)
        except Exception as e:
            print(f"⚠️ No se pudo leer {STORAGE_CONFIG_FILE}, se ignora: {e}")
    _storage_config_cache = config
    return _storage_config_cache


def get_repo_size_kb(repo):
    """Tamaño reportado por GitHub (en KB) para decidir si un repo de
    almacenamiento ya está lleno. Se cachea por corrida."""
    if repo in _repo_size_cache:
        return _repo_size_cache[repo]
    size_kb = 0
    try:
        headers = {"Authorization": f"Bearer {STORAGE_REPO_TOKEN}", "Accept": "application/vnd.github+json"}
        resp = _SESSION.get(f"https://api.github.com/repos/{repo}", headers=headers, timeout=20)
        if resp.ok:
            size_kb = resp.json().get("size", 0)
        else:
            print(f"⚠️ No se pudo consultar tamaño de {repo}: {resp.status_code}")
    except Exception as e:
        print(f"⚠️ Excepción consultando tamaño de {repo}: {e}")
    _repo_size_cache[repo] = size_kb
    return size_kb


def pick_storage_repo():
    """Elige el primer repo de storage_config.json que todavía tenga
    espacio libre. Si todos están cerca del límite, usa el último de la
    lista igual (mejor seguir funcionando que romper el pipeline)."""
    if not STORAGE_REPO_TOKEN:
        return None
    config = load_storage_config()
    repos = config.get("storage_repos", [])
    if not repos:
        return None
    limit_kb = config.get("size_limit_mb", 800) * 1024
    with _storage_pick_lock:
        for repo in repos:
            if get_repo_size_kb(repo) < limit_kb:
                return repo
        print("⚠️ Todos los repos de almacenamiento están cerca del límite, se usa el último de la lista.")
        return repos[-1]


def upload_file_to_storage_repo(local_path, repo, dest_path):
    """Sube (crea o actualiza) UN archivo CHICO a un repo de GitHub vía la
    API de Contenidos, sin clonar el repo. Devuelve True si funcionó.
    Solo pensada para archivos por debajo de ~1MB (límite duro de esta API
    de GitHub) — para archivos más grandes usar upload_file_via_git_data_api."""
    if not STORAGE_REPO_TOKEN or not repo or not os.path.exists(local_path):
        return False
    branch = load_storage_config().get("branch", "main")
    api_url = f"https://api.github.com/repos/{repo}/contents/{dest_path}"
    headers = {"Authorization": f"Bearer {STORAGE_REPO_TOKEN}", "Accept": "application/vnd.github+json"}
    try:
        with open(local_path, "rb") as f:
            content_b64 = base64.b64encode(f.read()).decode("ascii")

        sha = None
        get_resp = _SESSION.get(f"{api_url}?ref={branch}", headers=headers, timeout=30)
        if get_resp.status_code == 200:
            sha = get_resp.json().get("sha")

        payload = {
            "message": f"Archivar {os.path.basename(local_path)} [skip ci]",
            "content": content_b64,
            "branch": branch,
        }
        if sha:
            payload["sha"] = sha

        put_resp = _SESSION.put(api_url, headers=headers, json=payload, timeout=180)
        if put_resp.status_code in (200, 201):
            return True
        print(f"⚠️ Error subiendo {os.path.basename(local_path)} a {repo}: {put_resp.status_code} {put_resp.text[:200]}")
        return False
    except Exception as e:
        print(f"⚠️ Excepción subiendo {os.path.basename(local_path)} a {repo}: {e}")
        return False


def upload_file_via_git_data_api(local_path, repo, dest_path, max_retries=3):
    """Sube (crea o reemplaza) UN archivo GRANDE (ej. un .mp4) a un repo de
    GitHub usando la Git Data API (blobs), que soporta archivos bastante
    más grandes que la API de Contents. Hace, en orden: leer el ref de la
    rama -> leer el commit -> crear un blob con el contenido -> crear un
    árbol nuevo que apunta el path al blob -> crear un commit -> mover la
    rama al commit nuevo.

    Se serializa con un lock POR REPO (ver _get_repo_lock): dos hilos
    escribiendo al mismo repo/rama a la vez romperían el encadenado de
    commits. Si otro proceso movió la rama justo en el medio (409/422 al
    actualizar el ref), reintenta desde el paso 1 hasta max_retries veces."""
    if not STORAGE_REPO_TOKEN or not repo or not os.path.exists(local_path):
        return False
    branch = load_storage_config().get("branch", "main")
    headers = {"Authorization": f"Bearer {STORAGE_REPO_TOKEN}", "Accept": "application/vnd.github+json"}
    base = f"https://api.github.com/repos/{repo}"

    lock = _get_repo_lock(repo)
    with lock:
        for attempt in range(max_retries):
            try:
                # 1) Referencia actual de la rama
                ref_resp = _SESSION.get(f"{base}/git/ref/heads/{branch}", headers=headers, timeout=30)
                if not ref_resp.ok:
                    print(f"⚠️ No se pudo leer ref de {repo}@{branch}: {ref_resp.status_code} {ref_resp.text[:200]}")
                    return False
                latest_commit_sha = ref_resp.json()["object"]["sha"]

                # 2) Árbol base del commit actual
                commit_resp = _SESSION.get(f"{base}/git/commits/{latest_commit_sha}", headers=headers, timeout=30)
                if not commit_resp.ok:
                    print(f"⚠️ No se pudo leer commit {latest_commit_sha} de {repo}: {commit_resp.status_code}")
                    return False
                base_tree_sha = commit_resp.json()["tree"]["sha"]

                # 3) Crear el blob con el contenido del archivo (base64)
                with open(local_path, "rb") as f:
                    content_b64 = base64.b64encode(f.read()).decode("ascii")
                blob_resp = _SESSION.post(f"{base}/git/blobs", headers=headers, json={
                    "content": content_b64, "encoding": "base64"
                }, timeout=180)
                if not blob_resp.ok:
                    print(f"⚠️ Error creando blob en {repo}: {blob_resp.status_code} {blob_resp.text[:200]}")
                    return False
                blob_sha = blob_resp.json()["sha"]

                # 4) Crear un árbol nuevo apuntando ese path al blob nuevo
                tree_resp = _SESSION.post(f"{base}/git/trees", headers=headers, json={
                    "base_tree": base_tree_sha,
                    "tree": [{"path": dest_path, "mode": "100644", "type": "blob", "sha": blob_sha}]
                }, timeout=60)
                if not tree_resp.ok:
                    print(f"⚠️ Error creando árbol en {repo}: {tree_resp.status_code} {tree_resp.text[:200]}")
                    return False
                new_tree_sha = tree_resp.json()["sha"]

                # 5) Crear el commit
                commit_create_resp = _SESSION.post(f"{base}/git/commits", headers=headers, json={
                    "message": f"Archivar {os.path.basename(local_path)} [skip ci]",
                    "tree": new_tree_sha,
                    "parents": [latest_commit_sha]
                }, timeout=60)
                if not commit_create_resp.ok:
                    print(f"⚠️ Error creando commit en {repo}: {commit_create_resp.status_code} {commit_create_resp.text[:200]}")
                    return False
                new_commit_sha = commit_create_resp.json()["sha"]

                # 6) Mover la rama al nuevo commit
                update_ref_resp = _SESSION.patch(f"{base}/git/refs/heads/{branch}", headers=headers, json={
                    "sha": new_commit_sha, "force": False
                }, timeout=30)
                if update_ref_resp.ok:
                    return True
                if update_ref_resp.status_code in (409, 422) and attempt < max_retries - 1:
                    # Otro proceso movió la rama entre el paso 1 y este paso:
                    # se reintenta desde cero con el ref actualizado.
                    print(f"↻ Ref de {repo} cambió mientras subía {os.path.basename(local_path)}, reintentando ({attempt + 1}/{max_retries})...")
                    continue
                print(f"⚠️ No se pudo actualizar ref de {repo}: {update_ref_resp.status_code} {update_ref_resp.text[:200]}")
                return False
            except Exception as e:
                print(f"⚠️ Excepción subiendo {os.path.basename(local_path)} a {repo} (Git Data API): {e}")
                return False
    return False


PREFIX_MAP = {
    "an_": "Anime",
    "cy_": "Cyberpunk",
    "na_": "Naturaleza",
    "fa_": "Fantasía",
    "mi_": "Minimalista",
    "au_": "Autos",
    "ur_": "Urbano",
    "es_": "Espacio",
    "ab_": "Abstracto"
}

category_prompts = {
    "an anime illustration, 2d Japanese animation, manga drawing, or animated character artwork": "Anime",
    "a cyberpunk futuristic neon city, glowing sci-fi scene, high tech dystopian city": "Cyberpunk",
    "a realistic natural landscape, green forest, mountains, waterfall, beach, or nature view": "Naturaleza",
    "a fantasy concept art, mythical dragon, magic spell, dark fantasy monster, or surreal magical world": "Fantasía",
    "a minimal flat color wallpaper, simple clean background with minimal vectors or isolated object": "Minimalista",
    "a sports car, super car, luxury vehicle, motorcycle, or automotive photography": "Autos",
    "a realistic urban city street, real life buildings, architecture, or city photography": "Urbano",
    "outer space, galaxy, cosmos, nebula, stars, planets, or astronomy photo": "Espacio",
    "an abstract 3d geometric render, fluid colorful artwork, wallpaper pattern, digital abstract graphics": "Abstracto"
}

tag_prompts = [
    "dark theme", "neon lights", "colorful", "character", "landscape",
    "futuristic", "retro", "amoled black", "detailed artwork", "minimalist"
]

candidate_prompts = list(category_prompts.keys())
categories_clean = list(category_prompts.values())

# ------------------------------------------------------------------
# CARGA PEREZOSA DEL MODELO CLIP
# ------------------------------------------------------------------
_classifier_lock = threading.Lock()
_classifier_state = {"model": None, "loaded": False}


def get_classifier():
    if _classifier_state["loaded"]:
        return _classifier_state["model"]
    with _classifier_lock:
        if not _classifier_state["loaded"]:
            print(f"⏳ Cargando modelo de clasificación de IA ({CLIP_MODEL_NAME})...")
            try:
                from transformers import pipeline
                try:
                    import torch
                    torch.set_num_threads(max(1, os.cpu_count() or 1))
                except Exception:
                    pass
                _classifier_state["model"] = pipeline(
                    "zero-shot-image-classification",
                    model=CLIP_MODEL_NAME,
                    device=-1
                )
            except Exception as e:
                print(f"⚠️ No se pudo cargar el modelo CLIP ({CLIP_MODEL_NAME}): {e}. Se usará fallback.")
                _classifier_state["model"] = None
            _classifier_state["loaded"] = True
    return _classifier_state["model"]


def is_video_filename(filename):
    fn = filename.lower()
    return fn.endswith((".mp4", ".webm")) or "live" in fn or "lv_" in fn


def classify_batch(images, candidate_labels):
    if not images:
        return []
    classifier = get_classifier()
    if not classifier:
        return [None] * len(images)
    with _classifier_lock:
        result = classifier(images, candidate_labels=candidate_labels)
    if result and isinstance(result[0], dict):
        return [result]
    return result


def precompute_classifications(archivos, folder):
    results = {}
    pending_names = []
    pending_images = []

    for archivo in archivos:
        if is_video_filename(archivo):
            results[archivo] = ("Live Video", False, [], 8.0)
            continue

        fn_lower = archivo.lower()
        matched = False
        for pref, cat in PREFIX_MAP.items():
            if fn_lower.startswith(pref) or f"_{pref}" in fn_lower:
                results[archivo] = (cat, fn_lower.startswith("vip_"), [cat.lower()], 8.5)
                matched = True
                break
        if matched:
            continue

        try:
            img = Image.open(os.path.join(folder, archivo)).convert("RGB")
            pending_names.append(archivo)
            pending_images.append(img)
        except Exception:
            results[archivo] = ("Todos", False, [], 7.0)

    if pending_images:
        gemini_api_key = os.environ.get("GEMINI_API_KEY")
        if gemini_api_key:
            print(f"🧠 Usando Gemini API con requests para clasificar {len(pending_images)} imagen(es)...")
            import base64
            import requests
            
            for idx, archivo in enumerate(pending_names):
                img_path = os.path.join(folder, archivo)
                prompt = """
                Analiza esta imagen y clasifícala para una app de fondos de pantalla.
                Devuelve ÚNICAMENTE un JSON válido con esta estructura estricta:
                {
                  "categoria": "Elige de [Anime, Cyberpunk, Naturaleza, Fantasía, Minimalista, Autos, Urbano, Espacio, Abstracto]. SI NO ENCAJA, INVENTA una sola palabra descriptiva.",
                  "tags": ["tag1", "tag2", "tag3"],
                  "aesthetic_score": 9.5,
                  "is_vip": true
                }
                No escribas markdown, solo el JSON puro.
                """
                
                try:
                    with open(img_path, "rb") as f:
                        img_data = f.read()
                    b64_img = base64.b64encode(img_data).decode("utf-8")
                    mime_type = "image/jpeg"
                    if archivo.lower().endswith(".png"): mime_type = "image/png"
                    elif archivo.lower().endswith(".webp"): mime_type = "image/webp"

                    payload = {
                        "contents": [{
                            "parts": [
                                {"text": prompt},
                                {"inline_data": {"mime_type": mime_type, "data": b64_img}}
                            ]
                        }]
                    }
                    
                    
                    # Auto-descubrimiento de modelos disponibles para esta API Key
                    if not hasattr(requests, "_gemini_models"):
                        try:
                            models_resp = requests.get(f"https://generativelanguage.googleapis.com/v1beta/models?key={gemini_api_key}").json()
                            available = [m['name'].replace("models/", "") for m in models_resp.get("models", []) if "generateContent" in m.get("supportedGenerationMethods", [])]
                            # Priorizar modelos visuales o rápidos
                            prioritized = [m for m in available if "flash" in m or "vision" in m] + available
                            requests._gemini_models = prioritized if prioritized else ['gemini-1.5-flash-latest', 'gemini-pro-vision']
                        except:
                            requests._gemini_models = ['gemini-1.5-flash', 'gemini-pro-vision']

                    txt = None
                    for model_name in requests._gemini_models:
                        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={gemini_api_key}"
                        resp = requests.post(url, json=payload, timeout=20)
                        if resp.status_code == 200:
                            data_resp = resp.json()
                            if 'candidates' in data_resp and len(data_resp['candidates']) > 0:
                                txt = data_resp['candidates'][0]['content']['parts'][0]['text']
                                break
                    
                    if not txt:
                        raise Exception(f"Todos los modelos fallaron. HTTP {resp.status_code}: {resp.text}")

                    txt = txt.replace('`json', '').replace('`', '').strip()
                    data = json.loads(txt)
                    cat = data.get("categoria", "General").title()
                    tags = data.get("tags", [])
                    aes = float(data.get("aesthetic_score", 7.5))
                    is_vip = bool(data.get("is_vip", False))
                    results[archivo] = (cat, is_vip, tags[:4], aes)
                    print(f"✅ Gemini clasificó {archivo} como: {cat} (VIP: {is_vip})", flush=True)
                except Exception as e:
                    print(f"⚠️ Error con {archivo} en Gemini: {e}. Se asignará General.")
                    results[archivo] = ("General", False, [], 7.0)
        else:
            print(f"🧠 (Fallback local) Clasificando {len(pending_images)} imagen(es)...")
            cat_predictions = classify_batch(pending_images, candidate_prompts)
            tag_predictions = classify_batch(pending_images, tag_prompts)

            for idx, archivo in enumerate(pending_names):
                cat_pred = cat_predictions[idx] if idx < len(cat_predictions) else None
                tag_pred = tag_predictions[idx] if idx < len(tag_predictions) else None

                if not cat_pred:
                    results[archivo] = ("Todos", False, [], 7.0)
                    continue

                confidence = float(cat_pred[0]['score'])
                best_category = "Todos" if confidence < 0.28 else category_prompts[cat_pred[0]['label']]

                tags = [p['label'] for p in tag_pred if p['score'] > 0.25][:4] if tag_pred else []
                aesthetic_score = round(min(9.9, max(5.0, (confidence * 4.0) + 5.5)), 1)

                is_vip_ai = bool(confidence >= 0.80 and aesthetic_score >= 9.0)

                results[archivo] = (best_category, is_vip_ai, tags, aesthetic_score)

        for img in pending_images:
            img.close()

    return results


# ------------------------------------------------------------------
# SESIÓN HTTP CON REINTENTOS AUTOMÁTICOS
# ------------------------------------------------------------------
def _build_session():
    session = requests.Session()
    try:
        from requests.adapters import HTTPAdapter
        try:
            from urllib3.util.retry import Retry
        except ImportError:
            from requests.packages.urllib3.util.retry import Retry
        retry_kwargs = dict(total=3, backoff_factor=1.5, status_forcelist=[429, 500, 502, 503, 504])
        try:
            retry = Retry(allowed_methods=["GET", "POST", "PUT", "PATCH"], **retry_kwargs)
        except TypeError:
            retry = Retry(method_whitelist=["GET", "POST", "PUT", "PATCH"], **retry_kwargs)
        adapter = HTTPAdapter(max_retries=retry, pool_maxsize=MAX_WORKERS + 2)
        session.mount("https://", adapter)
        session.mount("http://", adapter)
    except Exception as e:
        print(f"⚠️ No se pudo configurar reintentos automáticos de red: {e}")
    return session


_SESSION = _build_session()


def _publitio_signature():
    timestamp = str(int(time.time()))
    nonce = str(random.randint(10000000, 99999999))
    str_to_sign = f"{timestamp}{nonce}{PUBLITIO_SECRET}"
    signature = hashlib.sha1(str_to_sign.encode('utf-8')).hexdigest()
    return timestamp, nonce, signature


def upload_media_to_publitio(file_path, folder_tag="wallpapers"):
    """Sube CUALQUIER archivo (imagen, miniatura o video) a Publit.io."""
    if not os.path.exists(file_path):
        return None
    try:
        timestamp, nonce, signature = _publitio_signature()
        url = "https://api.publit.io/v1/files/create"
        params = {
            "api_key": PUBLITIO_KEY,
            "api_timestamp": timestamp,
            "api_nonce": nonce,
            "api_signature": signature,
            "privacy": "1",
            "folder": folder_tag,
        }
        with open(file_path, "rb") as f:
            files = {"file": f}
            response = _SESSION.post(url, params=params, files=files, timeout=180)
            res_data = response.json()
            if res_data.get("success"):
                return res_data.get("url_preview") or res_data.get("url")
            else:
                print(f"⚠️ Error Publit.io en {os.path.basename(file_path)}: {res_data}")
                return None
    except Exception as e:
        print(f"⚠️ Excepción subiendo {os.path.basename(file_path)} a Publit.io: {e}")
        return None


def generate_base64_placeholder(file_path):
    try:
        with Image.open(file_path) as img:
            img = ImageOps.exif_transpose(img).convert("RGB")
            img.thumbnail(PLACEHOLDER_MAX_SIZE, Image.Resampling.LANCZOS)
            import io
            buf = io.BytesIO()
            img.save(buf, "JPEG", quality=PLACEHOLDER_QUALITY, optimize=True)
            b64 = base64.b64encode(buf.getvalue()).decode("ascii")
            return f"data:image/jpeg;base64,{b64}"
    except Exception:
        return None


def get_orientation_and_ratio_from_dims(width, height):
    ratio = round(width / height, 2) if height else 0.56
    if width > height:
        orientation = "landscape"
    elif height > width:
        orientation = "portrait"
    else:
        orientation = "square"
    return orientation, ratio


def get_orientation_and_ratio(file_path):
    try:
        with Image.open(file_path) as img:
            width, height = img.size
            return get_orientation_and_ratio_from_dims(width, height)
    except Exception:
        return "portrait", 0.56


def extract_dominant_color_and_amoled(file_path):
    try:
        with Image.open(file_path) as img:
            img = ImageOps.exif_transpose(img)
            img = img.convert("RGB")
            img_small = img.resize((100, 100))
            arr = np.array(img_small)

            black_pixels = np.sum(np.all(arr <= [15, 15, 15], axis=-1))
            total_pixels = 100 * 100
            is_amoled = bool((black_pixels / total_pixels) >= 0.35)

            avg_color = arr.mean(axis=(0, 1)).astype(int)
            hex_color = f"#{avg_color[0]:02x}{avg_color[1]:02x}{avg_color[2]:02x}"
            return hex_color, is_amoled
    except Exception as e:
        print(f"Error analizando color/amoled en {file_path}: {e}")
        return "#121212", False


def send_discord_notification(total_items, total_vips, total_videos, new_count):
    webhook_url = os.environ.get("DISCORD_WEBHOOK")
    if not webhook_url:
        return

    payload = {
        "embeds": [{
            "title": "🚀 Pipeline de Nekutoon Actualizado",
            "color": 3447003,
            "fields": [
                {"name": "Total Wallpapers", "value": str(total_items), "inline": True},
                {"name": "Fondos Nuevos", "value": str(new_count), "inline": True},
                {"name": "Fondos VIP", "value": str(total_vips), "inline": True},
                {"name": "Live Videos", "value": str(total_videos), "inline": True},
                {"name": "Estado", "value": "✅ Miniaturas optimizadas generadas con éxito.", "inline": False}
            ],
            "footer": {"text": "Nekutoon System"}
        }]
    }
    try:
        requests.post(webhook_url, json=payload, timeout=10)
    except Exception:
        pass


def send_onesignal_notification(new_count, latest_item):
    app_id = os.environ.get("ONESIGNAL_APP_ID", "782f3005-fc46-45ab-a98a-f44a07537b65")
    rest_key = os.environ.get("ONESIGNAL_REST_KEY")

    if not rest_key or new_count <= 0 or not latest_item:
        return

    titles_es = ["🔥 ¡Tu pantalla merece un cambio!", "✨ ¡Nuevo Fondo Exclusivo!", "🎨 ¡Nuevos Wallpapers Disponibles!"]
    titles_en = ["🔥 Upgrade Your Screen Now!", "✨ Exclusive New Wallpaper!", "🎨 New Wallpapers Available!"]

    msg_es = f"😍 Agregamos '{latest_item.get('title', 'un nuevo fondo')}'. ¡Toca para verlo!" if new_count == 1 else f"⚡ Agregamos {new_count} nuevos fondos HD y AMOLED."
    msg_en = f"😍 Just added '{latest_item.get('title', 'a new wallpaper')}'." if new_count == 1 else f"⚡ Added {new_count} new HD & AMOLED wallpapers."

    headers = {"Content-Type": "application/json; charset=utf-8", "Authorization": f"Basic {rest_key}"}
    payload = {
        "app_id": app_id,
        "included_segments": ["All"],
        "headings": {"es": random.choice(titles_es), "en": random.choice(titles_en)},
        "contents": {"es": msg_es, "en": msg_en},
        "big_picture": latest_item.get("thumbnail", ""),
        "large_icon": latest_item.get("thumbnail", ""),
        "data": {"wallpaper_id": str(latest_item.get("id", "")), "category": str(latest_item.get("category", ""))}
    }
    try:
        requests.post("https://onesignal.com/api/v1/notifications", headers=headers, json=payload, timeout=10)
    except Exception:
        pass


def optimize_video(input_path):
    temp_path = input_path + ".opt.mp4"
    scale_expr = f"scale='if(gt(a,1),min(iw,{VIDEO_MAX_LONG_SIDE}),min(iw,{VIDEO_MAX_SHORT_SIDE}))':-2"
    command = [
        "ffmpeg", "-y", "-i", input_path,
        "-vf", scale_expr,
        "-c:v", "libx264", "-crf", "24", "-preset", VIDEO_PRESET, "-threads", "0",
        "-movflags", "+faststart",
        "-c:a", "aac", "-b:a", "128k",
        temp_path
    ]
    try:
        subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        os.replace(temp_path, input_path)
        return True
    except Exception as e:
        print(f"⚠️ No se pudo optimizar el video {os.path.basename(input_path)}: {e}")
        if os.path.exists(temp_path):
            os.remove(temp_path)
        return False


def generate_webp_thumbnail(file_path, output_webp_path, max_size=(480, 854)):
    try:
        with Image.open(file_path) as img:
            img = ImageOps.exif_transpose(img)
            img = img.convert("RGB")
            img.thumbnail(max_size, Image.Resampling.LANCZOS)
            img.save(output_webp_path, "WEBP", quality=80, optimize=True)
            return True
    except Exception:
        return False


def extract_video_frame(video_path, output_jpg):
    try:
        cap = cv2.VideoCapture(video_path)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        success, frame = cap.read()
        if success:
            cv2.imwrite(output_jpg, frame, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
        cap.release()
        return success, width, height
    except Exception:
        return False, 0, 0


def get_media_info_from_dims(width, height):
    max_dim = max(width, height) if width and height else 0
    if max_dim >= 3840:
        return "4K Ultra HD"
    elif max_dim >= 2560:
        return "2K Quad HD"
    elif max_dim >= 1920:
        return "1080p Full HD"
    elif max_dim > 0:
        return "HD"
    return "1080p Full HD"


def format_title(filename):
    name = filename.rsplit(".", 1)[0]
    if name.lower().startswith("vip_"):
        name = name[4:]

    prefixes = ["an_", "cy_", "na_", "fa_", "mi_", "au_", "ur_", "es_", "ab_", "lv_"]
    for pref in prefixes:
        if name.lower().startswith(pref):
            name = name[len(pref):]
            break

    name = re.sub(r"\(\d+\)", "", name).replace("_", " ").replace("-", " ")
    trash_words = ["descarga", "img", "wallpaper", "foto", "copia"]
    for word in trash_words:
        name = re.sub(r"\b" + word + r"\b", "", name, flags=re.IGNORECASE)

    title = " ".join(name.split()).title()
    title = apply_title_blacklist(title)

    return title if title else "Wallpaper"


# ---------------------- CACHE (evita resubir archivos sin cambios) ----------------------

def _atomic_write_json(path, data):
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False,
                   default=lambda x: x.item() if hasattr(x, 'item') else str(x))
    os.replace(tmp_path, path)


def load_cache():
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"⚠️ No se pudo leer {CACHE_FILE}, se ignora el cache: {e}")
    return {}


def compute_file_hash(path, chunk_size=1024 * 1024):
    h = hashlib.md5()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


# ---------------------- PIPELINE POR ARCHIVO ----------------------

def process_single_file(archivo, ruta_completa, precomputed):
    """Hace todo el trabajo pesado (optimizar video, miniatura, subida) para
    UN archivo. Pensado para correr dentro de un hilo del ThreadPoolExecutor.

    'precomputed' es la tupla (categoria, is_vip_ai, tags, aesthetic_score)
    ya resuelta por precompute_classifications ANTES de llegar acá — este
    hilo ya no llama a CLIP en ningún momento."""
    nombre_base = os.path.splitext(archivo)[0]

    es_vip_manual = archivo.lower().startswith("vip_")
    titulo_bonito = format_title(archivo)
    url_archivo = archivo.replace(" ", "%20")

    es_video = is_video_filename(archivo)

    thumb_filename = f"{nombre_base}.webp"
    thumb_path = os.path.join(thumbs_folder, thumb_filename)

    temp_frame = None
    video_width, video_height = 0, 0

    if es_video:
        optimize_video(ruta_completa)
        temp_frame = os.path.join(thumbs_folder, f"temp_{nombre_base}_{threading.get_ident()}.jpg")
        success, video_width, video_height = extract_video_frame(ruta_completa, temp_frame)
        if success:
            generate_webp_thumbnail(temp_frame, thumb_path)
    else:
        generate_webp_thumbnail(ruta_completa, thumb_path)

    print(f"📤 Subiendo {'video' if es_video else 'imagen'} a Publit.io (CDN): {archivo}")
    url_hd = upload_media_to_publitio(ruta_completa, folder_tag="videos" if es_video else "wallpapers")

    url_thumb_cdn = None
    if os.path.exists(thumb_path):
        url_thumb_cdn = upload_media_to_publitio(thumb_path, folder_tag="thumbs")

    # --- Archivado multi-repo (SIEMPRE que haya STORAGE_REPO_TOKEN) ---
    # Ya no depende de que Publit.io haya funcionado, ni se salta por
    # tamaño: los archivos grandes (mp4) usan la Git Data API en vez de la
    # API de Contents.
    host_repo = None
    target_repo = pick_storage_repo()
    if target_repo:
        try:
            file_size = os.path.getsize(ruta_completa)
        except OSError:
            file_size = 0

        if file_size > STORAGE_API_SAFE_SIZE_BYTES:
            raw_ok = upload_file_via_git_data_api(ruta_completa, target_repo, f"img/{archivo}")
        else:
            raw_ok = upload_file_to_storage_repo(ruta_completa, target_repo, f"img/{archivo}")

        thumb_ok = True
        if os.path.exists(thumb_path):
            # La miniatura webp casi siempre es chica: alcanza con Contents API.
            thumb_ok = upload_file_to_storage_repo(thumb_path, target_repo, f"img/thumbs/{thumb_filename}")

        if raw_ok and thumb_ok:
            host_repo = target_repo
            print(f"🗄️ Archivado en {target_repo}: {archivo}")
        else:
            print(f"⚠️ No se pudo archivar {archivo} en {target_repo} (raw_ok={raw_ok}, thumb_ok={thumb_ok}).")

    fallback_repo = host_repo or "Nexotvofficial/WallpapersHD"
    fallback_hd = f"https://cdn.jsdelivr.net/gh/{fallback_repo}@main/img/{url_archivo}"
    fallback_thumb = f"https://cdn.jsdelivr.net/gh/{fallback_repo}@main/img/thumbs/{thumb_filename}"

    final_hd_url = url_hd if url_hd else fallback_hd
    final_thumb_url = url_thumb_cdn if url_thumb_cdn else fallback_thumb

    placeholder_source = temp_frame if (es_video and temp_frame and os.path.exists(temp_frame)) else (None if es_video else ruta_completa)
    blur_placeholder = generate_base64_placeholder(placeholder_source) if placeholder_source else None

    if es_video and video_width and video_height:
        orientation, aspect_ratio = get_orientation_and_ratio_from_dims(video_width, video_height)
        resolucion_real = get_media_info_from_dims(video_width, video_height)
    elif es_video:
        orientation, aspect_ratio = "portrait", 0.56
        resolucion_real = "1080p Full HD"
    else:
        orientation, aspect_ratio = get_orientation_and_ratio(ruta_completa)
        with Image.open(ruta_completa) as _img:
            resolucion_real = get_media_info_from_dims(*_img.size)

    color_source = temp_frame if (es_video and temp_frame and os.path.exists(temp_frame)) else ruta_completa
    hex_color, is_amoled = extract_dominant_color_and_amoled(color_source)

    cat_detectada, is_vip_ai, tags, aesthetic_score = precomputed

    if temp_frame and os.path.exists(temp_frame):
        os.remove(temp_frame)

    es_vip_final = bool(es_vip_manual or is_vip_ai)

    item_obj = {
        "title": titulo_bonito,
        "file_name": archivo,
        "type": "video" if es_video else "image",
        "is_video": es_video,
        "category": cat_detectada,
        "tags": tags,
        "color": hex_color,
        "color_hex": hex_color,
        "is_amoled": is_amoled,
        "orientation": orientation,
        "aspect_ratio": aspect_ratio,
        "aesthetic_score": aesthetic_score,
        "thumbnail": final_thumb_url,
        "hd_url": final_hd_url,
        "blur_placeholder": blur_placeholder,
        "resolution": resolucion_real,
        "is_vip": es_vip_final,
        "archived_repo": host_repo
    }

    # Se borra el original local únicamente si quedó archivado en un repo
    # de almacenamiento (host_repo). Si Publit.io falló pero el archivado
    # multi-repo funcionó, igual se borra: el multi-repo ya es una fuente
    # válida (fallback_hd/fallback_thumb apuntan ahí vía jsDelivr). Si el
    # archivado también falló, nunca se borra nada — se queda local como
    # respaldo, igual que siempre.
    if host_repo:
        try:
            os.remove(ruta_completa)
        except Exception as e:
            print(f"⚠️ No se pudo borrar {archivo} tras archivarlo: {e}")
        if os.path.exists(thumb_path):
            try:
                os.remove(thumb_path)
            except Exception:
                pass

    return item_obj


def main():
    os.makedirs(folder, exist_ok=True)
    os.makedirs(thumbs_folder, exist_ok=True)

    valid_extensions = (".jpg", ".jpeg", ".png", ".webp", ".mp4", ".webm")
    for item in os.listdir("."):
        if item.lower().endswith(valid_extensions) and os.path.isfile(item):
            os.rename(item, os.path.join(folder, item))

    cache = load_cache()

    categories_list = ["Todos"] + categories_clean + ["Live Video"]

    archivos = sorted([
        f for f in os.listdir(folder)
        if f.lower().endswith(valid_extensions) and not f.startswith("thumb_") and os.path.isfile(os.path.join(folder, f))
    ])

    if IS_SHARDED:
        print(f"\n🔀 Shard {SHARD_INDEX}/{SHARD_TOTAL} — analizando {len(archivos)} archivos en total...\n")
    else:
        print(f"\nAnalizando {len(archivos)} archivos (comprobando cuáles cambiaron)...\n")

    file_hashes = {}
    to_process = []
    reused_count = 0

    for archivo in archivos:
        ruta_completa = os.path.join(folder, archivo)
        try:
            file_hash = compute_file_hash(ruta_completa)
        except Exception as e:
            print(f"⚠️ No se pudo leer {archivo}, se procesará de todas formas: {e}")
            file_hash = None
        file_hashes[archivo] = file_hash

        cached_entry = cache.get(archivo)
        thumb_exists = os.path.exists(os.path.join(thumbs_folder, f"{os.path.splitext(archivo)[0]}.webp"))

        if (cached_entry and file_hash and cached_entry.get("hash") == file_hash
                and cached_entry.get("item") and thumb_exists):
            reused_count += 1
        else:
            to_process.append(archivo)

    to_process_total = len(to_process)

    if IS_SHARDED:
        to_process = [a for i, a in enumerate(to_process) if i % SHARD_TOTAL == SHARD_INDEX]
        print(f"⚡ {reused_count} archivo(s) sin cambios. {to_process_total} nuevos/modificados en total "
              f"→ a este shard le tocan {len(to_process)}.\n")
    else:
        print(f"⚡ {reused_count} archivo(s) sin cambios (se reutilizan). {to_process_total} archivo(s) nuevos/modificados a procesar.\n")

    classification_map = precompute_classifications(to_process, folder) if to_process else {}

    results_by_name = {}
    new_cache = {}

    if to_process:
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(to_process))) as executor:
            future_map = {
                executor.submit(
                    process_single_file,
                    archivo,
                    os.path.join(folder, archivo),
                    classification_map.get(archivo, ("Todos", False, [], 7.0))
                ): archivo
                for archivo in to_process
            }
            for future in concurrent.futures.as_completed(future_map):
                archivo = future_map[future]
                try:
                    item_obj = future.result()
                    results_by_name[archivo] = item_obj
                    print(f"✅ Completado: {archivo}")
                except Exception as e:
                    print(f"❌ Error procesando '{archivo}', se omite en esta corrida: {e}")

    if IS_SHARDED:
        shard_data = {
            "shard_index": SHARD_INDEX,
            "items": {a: results_by_name[a] for a in results_by_name},
            "hashes": {a: file_hashes[a] for a in results_by_name},
        }
        _atomic_write_json(SHARD_OUTPUT, shard_data)
        print(f"\n✅ Shard {SHARD_INDEX} completo: {len(results_by_name)} item(s) nuevos escritos en {SHARD_OUTPUT}.")
        return

    all_known_files = sorted(set(archivos) | set(cache.keys()))

    data = {"categories": categories_list, "wallpapers": []}
    new_items = []

    for i, archivo in enumerate(all_known_files):
        if archivo in results_by_name:
            item_obj = results_by_name[archivo]
            if archivo not in cache:
                new_items.append(item_obj)
        else:
            cached_entry = cache.get(archivo)
            if not cached_entry or not cached_entry.get("item"):
                continue
            item_obj = cached_entry["item"]

        item_obj["id"] = str(i + 1)
        data["wallpapers"].append(item_obj)
        new_cache[archivo] = {
            "hash": file_hashes.get(archivo, (cache.get(archivo) or {}).get("hash")),
            "item": item_obj
        }

    # Generar categorías dinámicas basadas en los fondos reales que tenemos
    unique_cats = set(w.get("category", "General") for w in data["wallpapers"])
    final_cats = ["Todos"]
    
    # Asegurar que Live Video siempre esté al final si existe, o en su orden
    sorted_cats = sorted(list(unique_cats - {"Todos", "Live Video", "General"}))
    if "General" in unique_cats:
        sorted_cats.append("General")
    final_cats.extend(sorted_cats)
    if "Live Video" in unique_cats:
        final_cats.append("Live Video")
        
    data["categories"] = final_cats

    _atomic_write_json(OUTPUT_JSON, data)
    _atomic_write_json(CACHE_FILE, new_cache)

    print(f"\n¡Listo! Generado {OUTPUT_JSON} con {len(data['wallpapers'])} items "
          f"({reused_count} reutilizados, {len(to_process)} procesados).")

    total_vips = sum(1 for w in data["wallpapers"] if w.get("is_vip"))
    total_videos = sum(1 for w in data["wallpapers"] if w.get("is_video"))

    send_discord_notification(len(data["wallpapers"]), total_vips, total_videos, len(new_items))

    if len(new_items) > 0:
        send_onesignal_notification(len(new_items), new_items[-1])


if __name__ == "__main__":
    main()




