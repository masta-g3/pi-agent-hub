# Usage: uv run --with pillow encode.py frames.json frameDir out.gif
import json, sys
from PIL import Image
frames = json.load(open(sys.argv[1]))
imgs = [Image.open(f"{sys.argv[2]}/f{i}.png").convert("RGB") for i in range(len(frames))]
# One shared palette keeps colors stable between frames.
sheet = Image.new("RGB", (imgs[0].width, imgs[0].height * len(imgs)))
for i, im in enumerate(imgs): sheet.paste(im, (0, i * im.height))
pal = sheet.quantize(colors=64, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
out = [im.quantize(palette=pal, dither=Image.Dither.NONE) for im in imgs]
out[0].save(sys.argv[3], save_all=True, append_images=out[1:], duration=[int(f["hold"] * 1000) for f in frames], loop=0, optimize=True, disposal=1)
