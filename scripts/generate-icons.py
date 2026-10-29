#!/usr/bin/env python3
"""
Icon generator for NoReplay Firefox extension.
Generates:
- icons/icon.svg (Vector master)
- icons/icon-16.png
- icons/icon-32.png
- icons/icon-48.png
- icons/icon-96.png
- icons/icon-128.png
- icons/icon-256.png
- icons/icon-512.png
"""

import math
import os
from PIL import Image, ImageDraw, ImageFilter

def create_svg():
    return '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <!-- Background Gradient: YouTube Crimson / Coral -->
    <linearGradient id="bgGrad" x1="15%" y1="10%" x2="85%" y2="90%">
      <stop offset="0%" stop-color="#FF2449"/>
      <stop offset="50%" stop-color="#E6002E"/>
      <stop offset="100%" stop-color="#B80024"/>
    </linearGradient>

    <!-- Top Inner Glow / Bezel -->
    <linearGradient id="innerGlow" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.35"/>
      <stop offset="50%" stop-color="#FFFFFF" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.15"/>
    </linearGradient>

    <!-- Glyph Drop Shadow -->
    <filter id="glyphShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2.5" stdDeviation="2.5" flood-color="#000000" flood-opacity="0.28"/>
    </filter>
  </defs>

  <!-- Squircle Base with smooth rounded corners -->
  <rect x="6" y="6" width="116" height="116" rx="28" fill="url(#bgGrad)"/>
  <rect x="6.5" y="6.5" width="115" height="115" rx="27.5" fill="none" stroke="url(#innerGlow)" stroke-width="1.5"/>

  <!-- Skip Forward Glyph (▶▌) representing NoReplay -->
  <g filter="url(#glyphShadow)">
    <!-- Play Triangle with softly rounded vertices -->
    <path d="M 41 38.5 
             C 41 35.8 44.0 34.1 46.4 35.5 
             L 75.8 59.8 
             C 78.1 61.3 78.1 64.7 75.8 66.2 
             L 46.4 90.5 
             C 44.0 91.9 41 90.2 41 87.5 
             Z" 
          fill="#FFFFFF"/>
    <!-- Vertical Skip Bar with rounded pill caps -->
    <rect x="80" y="37" width="9" height="54" rx="4.5" fill="#FFFFFF"/>
  </g>
</svg>
'''

def render_icon(size):
    """
    Renders pixel-perfect raster icon using supersampled vector drawing.
    Optical adjustments applied for smaller sizes (16, 32).
    """
    # Supersampling factor: draw at 1024 or 2048, then downsample with Lanczos
    super_size = 1024
    scale = super_size / 128.0

    # Base RGBA canvas
    img = Image.new("RGBA", (super_size, super_size), (0, 0, 0, 0))

    # Gradient buffer
    top_color = (255, 36, 73)      # #FF2449
    bottom_color = (184, 0, 36)    # #B80024

    grad = Image.new("RGBA", (super_size, super_size))
    for y in range(super_size):
        ratio = y / (super_size - 1)
        r = int(top_color[0] + (bottom_color[0] - top_color[0]) * ratio)
        g = int(top_color[1] + (bottom_color[1] - top_color[1]) * ratio)
        b = int(top_color[2] + (bottom_color[2] - top_color[2]) * ratio)
        for x in range(super_size):
            # Subtle diagonal sweep
            hratio = (x - super_size / 2) / super_size * 0.12
            cr = max(0, min(255, int(r * (1 + hratio))))
            cg = max(0, min(255, int(g * (1 + hratio))))
            cb = max(0, min(255, int(b * (1 + hratio))))
            grad.putpixel((x, y), (cr, cg, cb, 255))

    # Mask with rounded rectangle (squircle)
    margin = 6 * scale
    radius = 28 * scale
    mask = Image.new("L", (super_size, super_size), 0)
    draw_mask = ImageDraw.Draw(mask)
    draw_mask.rounded_rectangle(
        [margin, margin, super_size - margin, super_size - margin],
        radius=radius,
        fill=255
    )
    img.paste(grad, (0, 0), mask)

    # Subtle inner highlight stroke along top
    highlight = Image.new("RGBA", (super_size, super_size), (0, 0, 0, 0))
    hl_draw = ImageDraw.Draw(highlight)
    hl_stroke = int(1.5 * scale)
    hl_draw.rounded_rectangle(
        [margin + hl_stroke/2, margin + hl_stroke/2, super_size - margin - hl_stroke/2, super_size - margin - hl_stroke/2],
        radius=radius - hl_stroke/2,
        outline=(255, 255, 255, 75),
        width=hl_stroke
    )
    img = Image.alpha_composite(img, highlight)

    # Optical tuning for small sizes
    if size <= 16:
        # 16x16: wider glyph, slightly bolder, no drop shadow blur to stay razor sharp
        tri_x0 = 36 * scale
        tri_x1 = 75 * scale
        tri_y0 = 35 * scale
        tri_y1 = 93 * scale
        tri_ymid = 64 * scale
        bar_x0 = 80 * scale
        bar_x1 = 92 * scale
        bar_y0 = 35 * scale
        bar_y1 = 93 * scale
        bar_rx = int(5 * scale)
        use_shadow = False
    elif size <= 32:
        # 32x32: slightly bolder for crisp retina toolbar
        tri_x0 = 39 * scale
        tri_x1 = 76 * scale
        tri_y0 = 36 * scale
        tri_y1 = 92 * scale
        tri_ymid = 64 * scale
        bar_x0 = 80 * scale
        bar_x1 = 90 * scale
        bar_y0 = 36 * scale
        bar_y1 = 92 * scale
        bar_rx = int(4.5 * scale)
        use_shadow = True
    else:
        # 48, 96, 128, 256, 512: standard elegant proportions
        tri_x0 = 41 * scale
        tri_x1 = 77 * scale
        tri_y0 = 38 * scale
        tri_y1 = 90 * scale
        tri_ymid = 64 * scale
        bar_x0 = 80 * scale
        bar_x1 = 89 * scale
        bar_y0 = 37 * scale
        bar_y1 = 91 * scale
        bar_rx = int(4.5 * scale)
        use_shadow = True

    # Build glyph layer
    glyph_layer = Image.new("RGBA", (super_size, super_size), (0, 0, 0, 0))
    glyph_draw = ImageDraw.Draw(glyph_layer)

    # Triangle points
    tri_pts = [
        (tri_x0, tri_y0),
        (tri_x1, tri_ymid),
        (tri_x0, tri_y1)
    ]
    glyph_draw.polygon(tri_pts, fill=(255, 255, 255, 255))
    # Soft rounded corners for triangle vertices
    vertex_radius = int(3.5 * scale)
    for px, py in tri_pts:
        glyph_draw.ellipse(
            [px - vertex_radius, py - vertex_radius, px + vertex_radius, py + vertex_radius],
            fill=(255, 255, 255, 255)
        )

    # Bar with rounded capsule ends
    glyph_draw.rounded_rectangle(
        [bar_x0, bar_y0, bar_x1, bar_y1],
        radius=bar_rx,
        fill=(255, 255, 255, 255)
    )

    if use_shadow:
        shadow_layer = Image.new("RGBA", (super_size, super_size), (0, 0, 0, 0))
        shadow_draw = ImageDraw.Draw(shadow_layer)
        s_offset = int(2.5 * scale)
        s_pts = [(x, y + s_offset) for x, y in tri_pts]
        shadow_draw.polygon(s_pts, fill=(0, 0, 0, 65))
        for px, py in s_pts:
            shadow_draw.ellipse(
                [px - vertex_radius, py - vertex_radius, px + vertex_radius, py + vertex_radius],
                fill=(0, 0, 0, 65)
            )
        shadow_draw.rounded_rectangle(
            [bar_x0, bar_y0 + s_offset, bar_x1, bar_y1 + s_offset],
            radius=bar_rx,
            fill=(0, 0, 0, 65)
        )
        shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(int(2.5 * scale)))
        img = Image.alpha_composite(img, shadow_layer)

    img = Image.alpha_composite(img, glyph_layer)

    # Downsample to target size using high-quality Lanczos resampling
    final_img = img.resize((size, size), Image.Resampling.LANCZOS)
    return final_img

def main():
    icons_dir = "/Users/mol/projetos/noreplay/icons"
    os.makedirs(icons_dir, exist_ok=True)

    # 1. Save SVG Master
    svg_content = create_svg()
    svg_path = os.path.join(icons_dir, "icon.svg")
    with open(svg_path, "w", encoding="utf-8") as f:
        f.write(svg_content)
    print(f"Created {svg_path}")

    # 2. Render all PNG sizes
    sizes = [16, 32, 48, 96, 128, 256, 512]
    for sz in sizes:
        png_img = render_icon(sz)
        png_path = os.path.join(icons_dir, f"icon-{sz}.png")
        png_img.save(png_path, "PNG", optimize=True)
        print(f"Created {png_path} ({sz}x{sz})")

if __name__ == "__main__":
    main()
