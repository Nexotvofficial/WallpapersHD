"""
Fusiona los resultados de los N jobs en paralelo (shards) del pipeline en
un único wallpapers.json + wallpapers_cache.json, y dispara las
notificaciones de Discord/OneSignal.

Corre UNA sola vez, en el job "merge" del workflow, después de que
actions/download-artifact trajo los wallpapers_shardN.json de cada job
matrix (junto con sus miniaturas .webp y videos optimizados).
"""
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from generador import (  # noqa: E402
    folder,
    OUTPUT_JSON,
    CACHE_FILE,
    categories_clean,
    load_cache,
    _atomic_write_json,
    send_discord_notification,
    send_onesignal_notification,
)

VALID_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".mp4", ".webm")


def main():
    cache = load_cache()

    archivos = sorted([
        f for f in os.listdir(folder)
        if f.lower().endswith(VALID_EXTENSIONS) and not f.startswith("thumb_") and os.path.isfile(os.path.join(folder, f))
    ])

    merged_items = {}
    merged_hashes = {}
    shard_files = sorted(glob.glob("wallpapers_shard*.json"))

    if not shard_files:
        print("⚠️ No se encontró ningún wallpapers_shardN.json — ¿corrieron los jobs de shard?")

    for shard_file in shard_files:
        with open(shard_file, "r", encoding="utf-8") as f:
            shard = json.load(f)
        items = shard.get("items", {})
        merged_items.update(items)
        merged_hashes.update(shard.get("hashes", {}))
        print(f"📦 {shard_file}: {len(items)} item(s) nuevos/modificados.")

    categories_list = ["Todos"] + categories_clean + ["Live Video"]
    data = {"categories": categories_list, "wallpapers": []}
    new_cache = {}
    new_items = []

    for i, archivo in enumerate(archivos):
        if archivo in merged_items:
            item_obj = merged_items[archivo]
            file_hash = merged_hashes.get(archivo)
            if archivo not in cache:
                new_items.append(item_obj)
        else:
            cached_entry = cache.get(archivo)
            if not cached_entry or not cached_entry.get("item"):
                # Ningún shard lo procesó y tampoco hay cache previo
                # (por ejemplo, falló en todos los reintentos): se omite.
                continue
            item_obj = cached_entry["item"]
            file_hash = cached_entry.get("hash")

        item_obj["id"] = str(i + 1)
        data["wallpapers"].append(item_obj)
        new_cache[archivo] = {"hash": file_hash, "item": item_obj}

    _atomic_write_json(OUTPUT_JSON, data)
    _atomic_write_json(CACHE_FILE, new_cache)

    print(f"\n¡Listo! {OUTPUT_JSON} fusionado con {len(data['wallpapers'])} item(s) "
          f"({len(new_items)} nuevo(s) esta corrida).")

    total_vips = sum(1 for w in data["wallpapers"] if w.get("is_vip"))
    total_videos = sum(1 for w in data["wallpapers"] if w.get("is_video"))
    send_discord_notification(len(data["wallpapers"]), total_vips, total_videos, len(new_items))
    if new_items:
        send_onesignal_notification(len(new_items), new_items[-1])


if __name__ == "__main__":
    main()
