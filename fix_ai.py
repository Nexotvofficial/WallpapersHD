import sys
import re

with open('generador.py', 'r', encoding='utf-8') as f:
    text = f.read()

bad_prompt = '"categoria": "Elige de [Anime, Cyberpunk, Naturaleza, Fantasía, Minimalista, Autos, Urbano, Espacio, Abstracto]. SI NO ENCAJA en ninguna, INVENTA una sola palabra descriptiva (ej: Juegos, Superhéroes, Películas).",'
bad_prompt_2 = '"categoria": "Elige de [Anime, Cyberpunk, Naturaleza, Fantasía, Minimalista, Autos, Urbano, Espacio, Abstracto]. SI NO ENCAJA, INVENTA una sola palabra descriptiva.",'

good_prompt = '"categoria": "Elige ESTRICTAMENTE de esta lista: [Anime, Cyberpunk, Naturaleza, Fantasía, Minimalista, Autos, Urbano, Espacio, Abstracto, Superhéroes, Terror, Videojuegos, Animales, Películas]. NO inventes otras.",'

text = text.replace(bad_prompt, good_prompt)
text = text.replace(bad_prompt_2, good_prompt)

with open('generador.py', 'w', encoding='utf-8') as f:
    f.write(text)
print("Updated generador.py prompt")
