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
MAX_WORKERS = int(os.environ.get("PIPELINE_MAX_WORKERS", "5"))

# Dimensión máxima del lado largo y del lado corto para optimizar video (evita
# subir 4K innecesario en un live wallpaper, pero respeta la orientación real).
VIDEO_MAX_LONG_SIDE = int(os.environ.get("VIDEO_MAX_LONG_SIDE", "1920"))
VIDEO_MAX_SHORT_SIDE = int(os.environ.get("VIDEO_MAX_SHORT_SIDE", "1080"))

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
# Antes el modelo (y hasta 'transformers'/'torch') se cargaban siempre al
# arrancar el script, aunque no hubiera ni una imagen nueva que clasificar.
# Ahora solo se cargan la primera vez que realmente se necesitan, y la
# instancia se comparte entre hilos protegida por un lock (el modelo de
# HuggingFace no es seguro para llamadas concurrentes desde varios hilos).
# ------------------------------------------------------------------
_classifier_lock = threading.Lock()
_classifier_state = {"model": None, "loaded": False}


def get_classifier():
    if _classifier_state["loaded"]:
        return _classifier_state["model"]
    with _classifier_lock:
        if not _classifier_state["loaded"]:
            print("⏳ Cargando modelo de Clasificación de IA (CLIP Large)...")
            try:
                from transformers import pipeline
                _classifier_state["model"] = pipeline(
                    "zero-shot-image-classification",
                    model="openai/clip-vit-large-patch14",
                    device=-1
                )
            except Exception as e:
                print(f"⚠️ No se pudo cargar el modelo CLIP Large: {e}. Se usará fallback.")
                _classifier_state["model"] = None
            _classifier_state["loaded"] = True
    return _classifier_state["model"]


def classify_image(image, candidate_labels):
    """Llama al clasificador de forma segura entre hilos (el modelo no soporta
    inferencia concurrente real, así que se serializa con un lock, pero el resto
    del pipeline de cada archivo -subidas, ffmpeg, etc.- sigue en paralelo)."""
    classifier = get_classifier()
    if not classifier:
        return None
    with _classifier_lock:
        return classifier(image, candidate_labels=candidate_labels)


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
            retry = Retry(allowed_methods=["GET", "POST"], **retry_kwargs)
        except TypeError:
            retry = Retry(method_whitelist=["GET", "POST"], **retry_kwargs)
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
    """Sube CUALQUIER archivo (imagen, miniatura o video) a Publit.io.
    Reemplaza por completo a ImgBB: un solo proveedor, un solo CDN, y las
    imágenes quedan servidas desde la misma red rápida que ya usábamos para
    los videos (mejor cache/edge que enlazar directo a GitHub/jsDelivr, que
    es lo que hacía que fondos e incluso el video tardaran en aplicarse)."""
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
    directamente en wallpapers.json. La app la pinta instantáneamente
    (sin esperar ninguna red) como fondo borroso mientras la miniatura/HD
    real termina de cargar — igual que hacen apps como Unsplash/Pinterest."""
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


def generate_tags_and_score(image, confidence):
    tags = []
    predictions = classify_image(image, tag_prompts)
    if predictions:
        tags = [p['label'] for p in predictions if p['score'] > 0.25][:4]

    score = round(min(9.9, max(5.0, (float(confidence) * 4.0) + 5.5)), 1)
    return tags, score


def send_discord_notification(total_items, total_vips, total_videos, new_count):
    webhook_url = os.environ.get("DISCORD_WEBHOOK")
    if not webhook_url:
        return

    payload = {
        "embeds": [{
            "title": "🚀 Wallpaper Pipeline Actualizado",
            "color": 3447003,
            "fields": [
                {"name": "Total Wallpapers", "value": str(total_items), "inline": True},
                {"name": "Fondos Nuevos", "value": str(new_count), "inline": True},
                {"name": "Fondos VIP", "value": str(total_vips), "inline": True},
                {"name": "Live Videos", "value": str(total_videos), "inline": True},
                {"name": "Estado", "value": "✅ Miniaturas optimizadas generadas con éxito.", "inline": False}
            ],
            "footer": {"text": "WallpapersHD System"}
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
    """Recodifica el video respetando la orientación real:
    - Si es horizontal (landscape): limita el lado largo (ancho) a VIDEO_MAX_LONG_SIDE (1920 por defecto = 1080p real).
    - Si es vertical/cuadrado (la mayoría de los live wallpapers): limita el ancho a VIDEO_MAX_SHORT_SIDE (1080 por defecto).
    Antes SIEMPRE limitaba el ancho a 1080 sin importar la orientación, lo que
    dejaba los videos horizontales en solo 1080x608 (muy por debajo de 1080p real).
    También usa 'veryfast' + todos los hilos disponibles para acelerar la
    codificación sin tocar la calidad (mismo CRF que antes)."""
    temp_path = input_path + ".opt.mp4"
    scale_expr = f"scale='if(gt(a,1),min(iw,{VIDEO_MAX_LONG_SIDE}),min(iw,{VIDEO_MAX_SHORT_SIDE}))':-2"
    command = [
        "ffmpeg", "-y", "-i", input_path,
        "-vf", scale_expr,
        "-c:v", "libx264", "-crf", "24", "-preset", "veryfast", "-threads", "0",
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
    """Extrae el primer frame y de paso devuelve la resolución real del video
    (evita tener que reabrir el archivo después solo para medir dimensiones)."""
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


def analyze_with_ai(file_name, file_path, is_video, temp_frame_path=None):
    if is_video:
        return "Live Video", False, [], 8.0

    fn_lower = file_name.lower()
    for pref, cat in PREFIX_MAP.items():
        if fn_lower.startswith(pref) or f"_{pref}" in fn_lower:
            return cat, fn_lower.startswith("vip_"), [cat.lower()], 8.5

    try:
        target_path = temp_frame_path if (is_video and temp_frame_path and os.path.exists(temp_frame_path)) else file_path
        image = Image.open(target_path).convert("RGB")

        prediction = classify_image(image, candidate_prompts)
        if not prediction:
            return "Todos", False, [], 7.0

        confidence = float(prediction[0]['score'])
        best_category = "Todos" if confidence < 0.28 else category_prompts[prediction[0]['label']]

        tags, aesthetic_score = generate_tags_and_score(image, confidence)

        # ANTES: "confidence > 0.65 OR aesthetic_score >= 8.8" marcaba VIP casi
        # cualquier imagen, porque CLIP suele dar >0.65 de confianza en la
        # categoría con solo reconocer el tema general (no la calidad real),
        # y aesthetic_score depende de esa misma confidence (score = conf*4+5.5),
        # así que ambas condiciones se disparaban juntas casi siempre.
        # AHORA: VIP es la excepción, no la regla. Se exige alta confianza EN LA
        # CATEGORÍA *Y* un aesthetic_score realmente alto (AND, no OR), con
        # umbrales más estrictos, para que solo el top del catálogo quede VIP.
        is_vip_ai = bool(confidence >= 0.80 and aesthetic_score >= 9.0)

        return best_category, is_vip_ai, tags, aesthetic_score
    except Exception:
        return "Todos", False, [], 7.0


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

def process_single_file(archivo, ruta_completa):
    """Hace todo el trabajo pesado (optimizar video, miniatura, IA, subidas) para
    UN archivo. Pensado para correr dentro de un hilo del ThreadPoolExecutor."""
    nombre_base = os.path.splitext(archivo)[0]

    es_vip_manual = archivo.lower().startswith("vip_")
    titulo_bonito = format_title(archivo)
    url_archivo = archivo.replace(" ", "%20")

    es_video = bool(archivo.lower().endswith((".mp4", ".webm")) or "live" in archivo.lower() or "lv_" in archivo.lower())

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

    # jsDelivr sobre el propio repo de GitHub queda solo como red de emergencia
    # si Publit.io llegara a fallar (rate limit, corte, etc.) — así el fondo
    # nunca se queda sin URL, pero en el caso normal todo sale por el CDN,
    # que carga bastante más rápido a la hora de aplicar el wallpaper.
    fallback_hd = f"https://cdn.jsdelivr.net/gh/Nexotvofficial/WallpapersHD@main/img/{url_archivo}"
    fallback_thumb = f"https://cdn.jsdelivr.net/gh/Nexotvofficial/WallpapersHD@main/img/thumbs/{thumb_filename}"

    final_hd_url = url_hd if url_hd else fallback_hd
    final_thumb_url = url_thumb_cdn if url_thumb_cdn else fallback_thumb

    # Placeholder base64 minúsculo (solo para imágenes; en video se usa el
    # primer frame ya extraído) para que la UI pinte algo nítido al instante.
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

    cat_detectada, is_vip_ai, tags, aesthetic_score = analyze_with_ai(archivo, ruta_completa, es_video, temp_frame)

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
        "is_vip": es_vip_final
    }
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

    archivos = [
        f for f in os.listdir(folder)
        if f.lower().endswith(valid_extensions) and not f.startswith("thumb_") and os.path.isfile(os.path.join(folder, f))
    ]

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

    print(f"⚡ {reused_count} archivo(s) sin cambios (se reutilizan). {len(to_process)} archivo(s) nuevos/modificados a procesar.\n")

    # --- Fase 2: procesar en paralelo solo lo nuevo/cambiado ---
    results_by_name = {}
    new_cache = {}

    if to_process:
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(to_process))) as executor:
            future_map = {
                executor.submit(process_single_file, archivo, os.path.join(folder, archivo)): archivo
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

    # --- Fase 3: ensamblar wallpapers.json en el orden original, con ids estables ---
    data = {"categories": categories_list, "wallpapers": []}
    new_items = []

    for i, archivo in enumerate(archivos):
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
        new_cache[archivo] = {"hash": file_hashes.get(archivo), "item": item_obj}

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
