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
# ANTES: siempre "openai/clip-vit-large-patch14" — modelo grande (~1.7GB),
# lento de descargar y de correr en el CPU compartido de un runner de
# GitHub Actions.
# AHORA: por defecto se usa "clip-vit-base-patch32", varias veces más rápido
# de descargar y de inferir mientras se mantiene una precisión más que
# suficiente para las 9 categorías de este catálogo. Si preferís exactitud
# por sobre velocidad, podés volver al modelo grande seteando la variable de
# entorno CLIP_MODEL_NAME=openai/clip-vit-large-patch14.
CLIP_MODEL_NAME = os.environ.get("CLIP_MODEL_NAME", "openai/clip-vit-base-patch32")

# ------------------------------------------------------------------
# ARCHIVADO EN REPOS DE ALMACENAMIENTO ROTATIVOS
# Los archivos originales (img/*) solo hacían falta localmente para: (1)
# procesarlos una vez, (2) servir de respaldo jsDelivr si Publit.io falla,
# (3) calcular su hash. Mantenerlos para siempre infla el repo sin límite.
#
# AHORA: si Publit.io recibió bien el archivo, además se sube el original
# (y su miniatura) a UNO de los repos listados en storage_config.json vía
# la API de Contenidos de GitHub (sin clonar nada). Si esa subida también
# sale bien, el archivo local se borra — el repo generador deja de crecer
# con el tiempo. Si algo falla en el camino, todo se queda local como
# siempre (nunca se borra "por las dudas").
#
# STORAGE_REPO_TOKEN es un fine-grained PAT con permiso "Contents: Read
# and write" sobre TODOS los repos listados en storage_config.json
# (incluido este mismo, si lo incluís en la lista).
# ------------------------------------------------------------------
STORAGE_CONFIG_FILE = "storage_config.json"
STORAGE_REPO_TOKEN = os.environ.get("STORAGE_REPO_TOKEN")

_storage_config_cache = None
_repo_size_cache = {}
_storage_pick_lock = threading.Lock()


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
    """Sube (crea o actualiza) UN archivo a un repo de GitHub vía la API
    de Contenidos, sin clonar el repo. Devuelve True si funcionó."""
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
# El modelo (y hasta 'transformers'/'torch') solo se cargan la primera vez
# que realmente se necesitan, y la instancia se comparte protegida por un
# lock (el modelo de HuggingFace no es seguro para llamadas concurrentes
# desde varios hilos). Con la clasificación en lote de más abajo, en la
# práctica esto ahora se resuelve UNA sola vez por corrida, antes de que
# exista ninguna concurrencia real.
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
                    # Muchos runners (incluidos los de GitHub Actions) no usan
                    # todos los núcleos disponibles por defecto para las
                    # multiplicaciones de matrices de PyTorch. Se fija
                    # explícitamente para aprovechar todo el CPU del runner.
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
    """Clasifica una LISTA de imágenes en una sola pasada de IA.

    ANTES: se llamaba al pipeline una vez POR IMAGEN (una para la categoría,
    otra para las etiquetas), y cada llamada individual volvía a codificar
    desde cero el texto de los candidate_labels aunque fuera siempre el
    mismo. Con 30 archivos nuevos eso eran ~60 pasadas completas del modelo.

    AHORA: se le pasa la lista completa de imágenes de una sola vez. El
    texto se codifica una única vez y las imágenes se procesan en un solo
    forward pass por lote, en vez de N pasadas separadas con el overhead de
    Python/dispatch de cada llamada individual.
    """
    if not images:
        return []
    classifier = get_classifier()
    if not classifier:
        return [None] * len(images)
    with _classifier_lock:
        result = classifier(images, candidate_labels=candidate_labels)
    # Con una sola imagen el pipeline puede devolver la lista de labels
    # "aplanada" (sin el nivel extra de lista por imagen). Se normaliza para
    # que el resultado sea siempre "una lista de predicciones por imagen".
    if result and isinstance(result[0], dict):
        return [result]
    return result


def precompute_classifications(archivos, folder):
    """Fase previa (secuencial, antes de abrir el ThreadPoolExecutor) que
    resuelve categoría/tags/score/VIP para TODOS los archivos nuevos de una
    sola vez.

    ANTES: cada hilo llamaba a CLIP imagen por imagen bajo un lock global,
    así que la "paralelización" de la IA era ilusoria (se serializaba
    igual) y además el texto de los prompts se re-codificaba en cada
    llamada.

    AHORA: se separan primero los archivos que NO necesitan IA (con prefijo
    reconocido, o videos, que siempre son "Live Video") de los que sí la
    necesitan, y estos últimos se clasifican todos juntos en un único lote.
    El resultado es que el modelo hace, como mucho, dos pasadas totales por
    corrida (una para categoría, otra para etiquetas) sin importar cuántos
    archivos nuevos haya.
    """
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
        print(f"🧠 Clasificando {len(pending_images)} imagen(es) sin prefijo en un solo lote de IA...")
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

            # VIP es la excepción, no la regla: alta confianza EN LA
            # CATEGORÍA *Y* un aesthetic_score realmente alto (AND, no OR).
            is_vip_ai = bool(confidence >= 0.80 and aesthetic_score >= 9.0)

            results[archivo] = (best_category, is_vip_ai, tags, aesthetic_score)

        for img in pending_images:
            img.close()

    return results


# ------------------------------------------------------------------
# SESIÓN HTTP CON REINTENTOS AUTOMÁTICOS
# Antes cualquier fallo transitorio de red (timeout, 500, 502, etc.) hacía
# fallar la subida directamente. Ahora reintenta con backoff antes de rendirse.
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
            retry = Retry(allowed_methods=["GET", "POST", "PUT"], **retry_kwargs)
        except TypeError:
            retry = Retry(method_whitelist=["GET", "POST", "PUT"], **retry_kwargs)
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
    """Genera una miniatura minúscula (24x42) en base64 para incrustar
    directamente en wallpapers.json."""
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
    """Recodifica el video respetando la orientación real."""
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
    """Extrae el primer frame y de paso devuelve la resolución real del video."""
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
    """Hash de contenido (no mtime): en GitHub Actions cada checkout reescribe
    la fecha de modificación de TODOS los archivos, así que mtime no sirve para
    detectar cambios reales. El hash de contenido sí es confiable."""
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

    # --- Archivado en repo de almacenamiento rotativo ---
    # Solo se intenta si Publit.io ya tiene el archivo real (url_hd no es
    # None). Si la subida al repo de respaldo también sale bien, host_repo
    # queda seteado y más abajo se borra el original local.
    host_repo = None
    if url_hd:
        target_repo = pick_storage_repo()
        if target_repo:
            raw_ok = upload_file_to_storage_repo(ruta_completa, target_repo, f"img/{archivo}")
            thumb_ok = True
            if os.path.exists(thumb_path):
                thumb_ok = upload_file_to_storage_repo(thumb_path, target_repo, f"img/thumbs/{thumb_filename}")
            if raw_ok and thumb_ok:
                host_repo = target_repo
                print(f"🗄️ Archivado en {target_repo}: {archivo}")

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

    # Recién ACÁ, con todo lo anterior ya leído del disco, es seguro borrar
    # el original local: solo si quedó a salvo en Publit.io Y en el repo de
    # almacenamiento. Si algo falló antes, host_repo es None y no se borra
    # nada — el archivo se queda local como respaldo, igual que siempre.
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

    # Orden alfabético estable: importante para que los N shards (que corren
    # en jobs distintos pero parten del mismo checkout) calculen EXACTAMENTE
    # la misma lista y el mismo reparto de trabajo sin coordinarse entre sí.
    archivos = sorted([
        f for f in os.listdir(folder)
        if f.lower().endswith(valid_extensions) and not f.startswith("thumb_") and os.path.isfile(os.path.join(folder, f))
    ])

    if IS_SHARDED:
        print(f"\n🔀 Shard {SHARD_INDEX}/{SHARD_TOTAL} — analizando {len(archivos)} archivos en total...\n")
    else:
        print(f"\nAnalizando {len(archivos)} archivos (comprobando cuáles cambiaron)...\n")

    # --- Fase 1: calcular hash de cada archivo y decidir qué se reutiliza vs qué se reprocesa ---
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

    # --- Fase 1.6: si hay sharding, este job se queda solo con SU porción ---
    # (todos los shards parten de la MISMA lista `to_process`, calculada
    # igual en cada job gracias al orden alfabético fijo de arriba, así que
    # el reparto por índice módulo SHARD_TOTAL no se pisa entre jobs).
    if IS_SHARDED:
        to_process = [a for i, a in enumerate(to_process) if i % SHARD_TOTAL == SHARD_INDEX]
        print(f"⚡ {reused_count} archivo(s) sin cambios. {to_process_total} nuevos/modificados en total "
              f"→ a este shard le tocan {len(to_process)}.\n")
    else:
        print(f"⚡ {reused_count} archivo(s) sin cambios (se reutilizan). {to_process_total} archivo(s) nuevos/modificados a procesar.\n")

    # --- Fase 1.5: clasificación de IA en UN SOLO lote para todo lo nuevo ---
    # Se hace acá, en el hilo principal y antes de abrir el pool, para que el
    # modelo se cargue y corra una sola vez por corrida en lugar de una vez
    # por archivo (ver precompute_classifications).
    classification_map = precompute_classifications(to_process, folder) if to_process else {}

    # --- Fase 2: procesar en paralelo solo lo nuevo/cambiado (ffmpeg, miniaturas, subidas) ---
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
        # Modo shard: no se ensambla wallpapers.json acá (otro shard puede
        # tener archivos que a este job ni le tocaron). Solo se deja un
        # archivo parcial con los items que ESTE shard resolvió + sus
        # hashes, para que merge_shards.py los junte todos al final.
        shard_data = {
            "shard_index": SHARD_INDEX,
            "items": {a: results_by_name[a] for a in results_by_name},
            "hashes": {a: file_hashes[a] for a in results_by_name},
        }
        _atomic_write_json(SHARD_OUTPUT, shard_data)
        print(f"\n✅ Shard {SHARD_INDEX} completo: {len(results_by_name)} item(s) nuevos escritos en {SHARD_OUTPUT}.")
        return

    # --- Fase 3: ensamblar wallpapers.json en el orden original, con ids estables ---
    # IMPORTANTE: ya no se itera solo sobre `archivos` (lo que hay HOY en
    # disco), porque un item archivado (ver process_single_file) borra su
    # original local y desaparecería del catálogo. Se itera sobre la UNIÓN
    # de archivos locales + todo lo que ya está en cache (incluye archivados).
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
                # No se pudo procesar y tampoco hay cache previo: se omite.
                continue
            item_obj = cached_entry["item"]

        item_obj["id"] = str(i + 1)
        data["wallpapers"].append(item_obj)
        # Si el archivo ya no está local (fue archivado en una corrida
        # anterior), no hay hash nuevo que calcular: se conserva el que
        # ya tenía guardado en cache.
        new_cache[archivo] = {
            "hash": file_hashes.get(archivo, (cache.get(archivo) or {}).get("hash")),
            "item": item_obj
        }

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
