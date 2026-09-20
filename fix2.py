import sys

with open('generador.py', 'r', encoding='utf-8') as f:
    text = f.read()

import re

# Reemplazaremos desde txt = None hasta el raise Exception
start_str = "txt = None"
end_str = "if not txt:\n                        raise Exception(f\"Todos los modelos fallaron"

start_idx = text.find(start_str)
end_idx = text.find(end_str, start_idx)

if start_idx != -1 and end_idx != -1:
    old_block = text[start_idx:end_idx]
    
    new_block = '''
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
                        resp = requests.post(url, json=payload)
                        if resp.status_code == 200:
                            data_resp = resp.json()
                            if 'candidates' in data_resp and len(data_resp['candidates']) > 0:
                                txt = data_resp['candidates'][0]['content']['parts'][0]['text']
                                break
                    
                    '''
    text = text.replace(old_block, new_block)
    
    with open('generador.py', 'w', encoding='utf-8') as f:
        f.write(text)
    print("Replaced successfully via Python")
else:
    print("Could not find block")
