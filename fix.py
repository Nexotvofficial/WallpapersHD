import sys
import re
import json

with open('generador.py', 'r', encoding='utf-8') as f:
    text = f.read()

start_str = 'gemini_api_key = os.environ.get("GEMINI_API_KEY")'
end_str = 'else:\n            print(f"🧠 (Fallback local) Clasificando {len(pending_images)} imagen(es)...")'

start_idx = text.find(start_str)
end_idx = text.find(end_str, start_idx)

if start_idx != -1 and end_idx != -1:
    old_block = text[start_idx:end_idx]
    
    new_block = '''gemini_api_key = os.environ.get("GEMINI_API_KEY")
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
                    
                    txt = None
                    for model_name in ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro']:
                        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={gemini_api_key}"
                        resp = requests.post(url, json=payload)
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
                    print(f"✅ Gemini clasificó {archivo} como: {cat} (VIP: {is_vip})")
                except Exception as e:
                    print(f"⚠️ Error con {archivo} en Gemini: {e}. Se asignará General.")
                    results[archivo] = ("General", False, [], 7.0)
        '''
    text = text.replace(old_block, new_block)
    
    with open('generador.py', 'w', encoding='utf-8') as f:
        f.write(text)
    print("Replaced successfully via Python")
else:
    print("Could not find block")
