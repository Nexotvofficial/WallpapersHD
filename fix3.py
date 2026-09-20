import sys

with open('generador.py', 'r', encoding='utf-8') as f:
    text = f.read()

start_str = '_atomic_write_json(OUTPUT_JSON, data)'
end_str = '_atomic_write_json(CACHE_FILE, new_cache)'

start_idx = text.find(start_str)

if start_idx != -1:
    old_block = '_atomic_write_json(OUTPUT_JSON, data)\n    _atomic_write_json(CACHE_FILE, new_cache)'
    
    new_block = '''
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
'''
    text = text.replace(old_block, new_block.strip())
    
    with open('generador.py', 'w', encoding='utf-8') as f:
        f.write(text)
    print("Replaced successfully via Python")
else:
    print("Could not find block")
