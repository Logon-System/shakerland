#!/usr/bin/env bash
#
# Renomme en masse les fichiers <PREFIXE>_X_YYYY.<ext> d'un repertoire
# (AMSPIRIT_..., CPCSE_..., quel que soit le prefixe emulateur) en
# <Test>_CRTC<X>_<Subset>.{SNA,webp}, a partir d'un CSV de correspondance
# RefHexa;Test;Subset. Les copies renommees sont ecrites dans <repertoire>/shakerland
# (le repertoire source n'est jamais modifie). Les images (PNG, BMP, ...) sont
# converties en WEBP (ImageMagick), les SNA sont copies tels quels.
#
# Usage: ./rename_shaker.sh <repertoire_source> <fichier_csv>

set -euo pipefail

if [[ $# -ne 2 ]]; then
    echo "Usage: $0 <repertoire_source> <fichier_csv>" >&2
    exit 1
fi

SRC_DIR=$1
CSV_FILE=$2
OUT_DIR="$SRC_DIR/shakerland"

if [[ ! -d "$SRC_DIR" ]]; then
    echo "Erreur: repertoire source introuvable: $SRC_DIR" >&2
    exit 1
fi
if [[ ! -f "$CSV_FILE" ]]; then
    echo "Erreur: fichier CSV introuvable: $CSV_FILE" >&2
    exit 1
fi
if command -v magick >/dev/null 2>&1; then
    CONVERT_CMD=(magick)
elif command -v convert >/dev/null 2>&1; then
    CONVERT_CMD=(convert)
else
    echo "Erreur: ImageMagick ('magick' ou 'convert') est requis pour la conversion image -> WEBP." >&2
    exit 1
fi

mkdir -p "$OUT_DIR"

declare -A TEST_BY_HEXA
declare -A SUBSET_BY_HEXA

# En-tete ignoree; comparaison des codes hexa insensible a la casse.
{
    read -r _header
    while IFS=';' read -r ref_hexa test subset; do
        [[ -z "$ref_hexa" ]] && continue
        key="${ref_hexa^^}"
        TEST_BY_HEXA["$key"]="$test"
        SUBSET_BY_HEXA["$key"]="$subset"
    done
} < "$CSV_FILE"

shopt -s nullglob nocaseglob
IMAGE_EXTS=(PNG BMP JPG JPEG GIF TGA TIF TIFF)
files=("$SRC_DIR"/*_*_*.SNA)
for img_ext in "${IMAGE_EXTS[@]}"; do
    files+=("$SRC_DIR"/*_*_*."$img_ext")
done
shopt -u nocaseglob

if [[ ${#files[@]} -eq 0 ]]; then
    echo "Aucun fichier <PREFIXE>_X_YYYY.{SNA,${IMAGE_EXTS[*]}} trouve dans $SRC_DIR" >&2
    exit 0
fi

count_ok=0
count_skip=0

for src_path in "${files[@]}"; do
    filename=$(basename "$src_path")
    ext="${filename##*.}"
    base="${filename%.*}"

    # base = <PREFIXE>_X_YYYY -> YYYY est le dernier segment, X l'avant-dernier ;
    # le prefixe (nom de l'emulateur, peut contenir des underscores) est ignore.
    yyyy="${base##*_}"
    rest="${base%_*}"
    x_part="${rest##*_}"
    if [[ "$rest" != *_* || -z "$x_part" || ! "$yyyy" =~ ^[0-9A-Fa-f]{4}$ ]]; then
        echo "Ignore (nom inattendu): $filename" >&2
        count_skip=$((count_skip + 1))
        continue
    fi
    hexa_key="${yyyy^^}"

    test="${TEST_BY_HEXA[$hexa_key]:-}"
    subset="${SUBSET_BY_HEXA[$hexa_key]:-}"

    if [[ -z "${TEST_BY_HEXA[$hexa_key]+x}" ]]; then
        echo "Ignore (code hexa $yyyy absent du CSV): $filename" >&2
        count_skip=$((count_skip + 1))
        continue
    fi
    if [[ -z "$test" ]]; then
        echo "Ignore (colonne Test vide pour $yyyy): $filename" >&2
        count_skip=$((count_skip + 1))
        continue
    fi

    new_base="${test}_CRTC${x_part}_${subset}"

    if [[ "${ext^^}" == SNA ]]; then
        dest="$OUT_DIR/${new_base}.SNA"
        cp -n -- "$src_path" "$dest"
    else
        dest="$OUT_DIR/${new_base}.webp"
        "${CONVERT_CMD[@]}" -- "$src_path" "$dest"
    fi

    echo "OK: $filename -> $(basename "$dest")"
    count_ok=$((count_ok + 1))
done

echo ""
echo "Termine: $count_ok fichier(s) traite(s), $count_skip ignore(s). Sortie: $OUT_DIR"
