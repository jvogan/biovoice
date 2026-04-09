#!/usr/bin/env bash
set -uo pipefail

OPENAI_KEY="${OPENAI_API_KEY:?Set OPENAI_API_KEY before running}"
GEMINI_KEY="${GOOGLE_API_KEY:?Set GOOGLE_API_KEY before running}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/docs/banners"
mkdir -p "$OUT"

openai_gen() {
  local name="$1" prompt="$2"
  local outfile="$OUT/openai-${name}.png"
  [ -f "$outfile" ] && { echo "SKIP openai-$name"; return; }
  echo "START openai-$name"
  local resp
  resp=$(curl -s --max-time 120 -X POST "https://api.openai.com/v1/images/generations" \
    -H "Authorization: Bearer $OPENAI_KEY" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg p "$prompt" '{model:"gpt-image-1","size":"1536x1024",prompt:$p,quality:"high",n:1}')")
  local b64
  b64=$(echo "$resp" | jq -r '.data[0].b64_json // empty')
  if [ -n "$b64" ]; then
    echo "$b64" | base64 -d > "$outfile"
    echo "DONE openai-$name ($(wc -c < "$outfile" | tr -d ' ') bytes)"
  else
    echo "FAIL openai-$name: $(echo "$resp" | jq -r '.error.message // "unknown"' | head -c 120)"
  fi
}

gemini_gen() {
  local name="$1" prompt="$2"
  local outfile="$OUT/gemini-${name}.png"
  [ -f "$outfile" ] && { echo "SKIP gemini-$name"; return; }
  echo "START gemini-$name"
  local resp
  resp=$(curl -s --max-time 120 -X POST \
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent" \
    -H "x-goog-api-key: $GEMINI_KEY" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg p "$prompt" '{
      contents:[{parts:[{text:$p}]}],
      generationConfig:{
        responseModalities:["TEXT","IMAGE"],
        imageConfig:{aspectRatio:"16:9"}
      }
    }')")
  local b64
  b64=$(echo "$resp" | jq -r '.candidates[0].content.parts[] | select(.inlineData) | .inlineData.data // empty' 2>/dev/null | head -1)
  if [ -z "$b64" ]; then
    b64=$(echo "$resp" | jq -r '.candidates[0].content.parts[] | select(.inline_data) | .inline_data.data // empty' 2>/dev/null | head -1)
  fi
  if [ -n "$b64" ]; then
    echo "$b64" | base64 -d > "$outfile"
    echo "DONE gemini-$name ($(wc -c < "$outfile" | tr -d ' ') bytes)"
  else
    echo "FAIL gemini-$name: $(echo "$resp" | jq -r '.error.message // .candidates[0].finishReason // "unknown"' 2>/dev/null | head -c 120)"
  fi
}

# ---- 12 OpenAI prompts (gpt-image-1) ----

openai_gen "01-isometric" \
  "Isometric 3D illustration of a biotech lab workstation. A scientist in a lab coat speaks into a glowing microphone. Floating above: colorful protein ribbon structures (alpha helices, beta sheets) manipulated by visible sound waves. Two dark monitors show molecular visualization UI. Soft shadows, clean isometric perspective. Banner format 3:2 ratio. No text." &

openai_gen "02-ukiyo-e" \
  "Japanese ukiyo-e woodblock print. A scholar in traditional robes speaks toward a scroll that unfurls into an elaborate protein alpha-helix structure rendered as flowing brushwork. Mount Fuji background. Traditional wave patterns (Hokusai-style) form sound waves from the scholar. Rich indigo, vermillion, gold leaf tones. Woodblock texture. Banner 3:2. No text." &

openai_gen "03-cyberpunk" \
  "Cyberpunk neon laboratory. A researcher in AR glasses speaks voice commands while holographic protein structures rotate mid-air in electric blue and hot pink neon. Rain-streaked windows, futuristic cityscape. Monitors show molecular data green-on-black. Volumetric fog, lens flares, chromatic aberration. Blade Runner meets molecular biology. Banner 3:2. No text." &

openai_gen "04-watercolor" \
  "Delicate scientific watercolor. Protein backbone ribbons in soft blues, greens, golds flow from a researcher's spoken words rendered as gentle brushstroke sound waves. Proteins dissolve into watercolor splashes at edges. Laptop glows showing molecular viewer. White paper background with paint bleeding at edges. Banner 3:2. No text." &

openai_gen "05-art-deco" \
  "Art Deco poster design for molecular science. Bold geometric shapes form a stylized protein helix at center. A scientist in profile speaks with radiating gold lines for voice commands. Symmetrical composition, strong verticals. Navy blue, gold, cream palette. 1930s streamlined borders. Gatsby elegance meets structural biology. Banner 3:2. No text." &

openai_gen "06-retro-scifi" \
  "1950s retro sci-fi magazine cover. Scientist in silver jumpsuit before a massive computer console with vacuum tubes, speaking into a chrome microphone. Giant transparent protein molecule hovers above, atoms glowing. Dramatic lighting, saturated reds and teals, halftone dots. Pulp sci-fi optimism about biology's future. Banner 3:2. No text." &

wait
echo "--- Batch 1 done ---"

openai_gen "07-pixel-art" \
  "Detailed 16-bit pixel art scene of a scientist at a computer. Monitor shows pixel-art protein structure viewer with ribbon diagrams. Sound wave pixels emanate from scientist toward screen. Desk lamp, coffee mug, papers. Rich dithering gradients. Nostalgic video game aesthetic for molecular biology. Banner 3:2. No text." &

openai_gen "08-engraving" \
  "Victorian copper engraving of scientific discovery. A natural philosopher speaks toward apparatus projecting a detailed protein backbone in fine crosshatch lines. Surrounded by microscopes, flasks, specimen jars. Dense parallel line shading. Sepia on cream. 19th century scientific illustration style. Banner 3:2. No text." &

openai_gen "09-abstract-geo" \
  "Abstract geometric composition. Sound wave frequencies transform into protein secondary structures through geometric metamorphosis. Left: clean parallel sine waves in cyan. Center: waves folding into angular shapes. Right: fully formed alpha helices and beta sheets in warm amber and teal. Dark charcoal background. Bauhaus-influenced, mathematically precise. Banner 3:2. No text." &

openai_gen "10-oil-painting" \
  "Renaissance oil painting. A scholar in chiaroscuro-lit study speaks to a floating molecular structure glowing with inner light. Rich impasto brushwork on protein ribbons. Rembrandt lighting, single strong source. Deep browns, luminous golds, ethereal blues. Classical mastery meets modern science. Banner 3:2. No text." &

openai_gen "11-stained-glass" \
  "Medieval stained glass window depicting molecular science. A robed figure speaks toward an elaborate protein rosette pattern. Alpha helices form leading lines between colored glass. Jewel tones: ruby, sapphire, emerald, amber. Black lead came outlines. Light shining through from behind. Gothic cathedral meets structural biology. Banner 3:2. No text." &

openai_gen "12-ghibli" \
  "Studio Ghibli anime illustration. A young researcher in a cozy plant-filled lab with large sunset windows speaks gently to a whimsical protein structure floating like a friendly spirit creature with sparkles. Warm golden hour light, detailed background art, soft palette. Miyazaki wonder applied to molecular biology. Banner 3:2. No text." &

wait
echo "--- Batch 2 done ---"

# ---- 12 Gemini prompts ----

gemini_gen "01-chinese-ink" \
  "Traditional Chinese ink wash painting (sumi-e style). A sage scholar contemplates a protein helix that forms from flowing ink brushstrokes like a dragon emerging from mist. Bamboo and mountains in background with empty space. Black ink gradients, minimalist and meditative. Red seal stamp in corner. Wide banner composition. No text or words." &

gemini_gen "02-pop-art" \
  "Bold pop art composition like Roy Lichtenstein. A scientist in profile speaks with a thought bubble containing a protein structure in flat bold colors. Primary palette: red blue yellow, black outlines. Halftone Ben-Day dot patterns throughout. Comic book panel energy. Warhol meets molecular biology. Wide banner. No text." &

gemini_gen "03-claymation" \
  "Claymation stop-motion style. A clay scientist figure with big glasses at a tiny clay computer. Above the desk a wobbly clay protein structure hovers connected by clay sound wave squiggles. Visible fingerprint textures, slightly imperfect surfaces, warm studio lighting. Charming and tactile, like Aardman Animations. Wide banner. No text." &

gemini_gen "04-synthwave" \
  "Synthwave retrowave aesthetic. Chrome grid landscape stretching to pink-purple sunset horizon. Wireframe protein structure rises like a monument with scan lines. Silhouetted scientist before dual monitors. Chrome reflections, VHS tracking artifacts. Hot pink, electric purple, cyan palette. Outrun style. Wide banner. No text." &

wait
echo "--- Batch 3 done ---"

gemini_gen "05-noir" \
  "Film noir black and white. A lone scientist at a lab bench lit by single desk lamp speaks into a vintage microphone. Protein structure appears as ghostly double exposure, ribbons swirling like cigarette smoke. High contrast, dramatic shadows, venetian blind light stripes. Moody noir atmosphere. Wide banner. No text." &

gemini_gen "06-botanical" \
  "Scientific botanical illustration. A protein structure drawn as a plant specimen: alpha helices as tendrils, beta sheets as leaves, amino acid chains as flowers. Researcher hands hold magnifying glass. Fine pen and ink with precise watercolor tints. Mounted on aged cream paper. Wide banner. No text." &

gemini_gen "07-woodcut" \
  "Medieval European woodcut print. An alchemist speaks incantations toward a flask from which a protein chain emerges like a serpent. Dense parallel line carving, stark black and white contrast. Decorative border with botanical motifs. Printing press texture, slight ink bleed. 15th century manuscript style. Wide banner. No text." &

gemini_gen "08-low-poly" \
  "Low-polygon 3D render of a scientist at geometric desk. Protein structure floating above in beautiful faceted low-poly with gradient coloring across triangular faces. Visible edges, ambient occlusion. Minimal palette: teals, corals, deep navy. Modern, clean, architectural. Wide banner. No text." &

wait
echo "--- Batch 4 done ---"

gemini_gen "09-vaporwave" \
  "Vaporwave aesthetic collage. Marble bust of classical Greek figure wearing modern headphones, surrounded by floating protein fragments as glitchy color-shifted 3D. Windows 95 dialog boxes, tropical plants, checkerboard perspective floor. Pastel pink and turquoise. Deliberately surreal and artificial. Wide banner. No text." &

gemini_gen "10-glitch" \
  "Digital glitch art. A protein structure visualization being deconstructed through pixel sorting, channel shifting, data moshing. Sound wave patterns create interference bands. Underlying clean molecular visualization artistically disrupted. Cyan and magenta channel separation. Digital artifacts as art. Wide banner. No text." &

gemini_gen "11-cartoon" \
  "Friendly cartoon illustration. Diverse scientists excitedly use voice commands to manipulate a giant colorful protein structure floating between them. Protein has fun exaggerated look. Speech bubbles with sound wave symbols. Bright cheerful colors, thick outlines, rounded shapes. Welcoming and accessible. Wide banner. No text." &

gemini_gen "12-blueprint" \
  "Technical blueprint on dark blue paper with white and cyan lines. Architectural plans of a voice-controlled molecular visualization system. Cross sections showing microphone input, waveform processing, protein structure on monitor. Dimension lines, annotation arrows, dashed construction lines. Engineering meets bioinformatics. Wide banner. No text." &

wait
echo "--- Batch 5 done ---"

echo ""
echo "=== RESULTS ==="
for f in "$OUT"/*.png; do
  [ -f "$f" ] && echo "  $(basename "$f") ($(wc -c < "$f" | tr -d ' ') bytes)"
done
echo ""
echo "Total: $(ls "$OUT"/*.png 2>/dev/null | wc -l | tr -d ' ') images"
