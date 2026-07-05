#!/usr/bin/env bash
#
# Renomme en masse les fichiers AMSPIRIT_X_YYYY.{SNA,PNG} d'un repertoire
# en <Test>_CRTC<X>_<Subset>.{SNA,WEBP}, a partir d'un CSV de correspondance
# RefHexa;Test;Subset. Les copies renommees sont ecrites dans <repertoire>/shakerland
# (le repertoire source n'est jamais modifie). Les PNG sont convertis en WEBP (convert).
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
    echo "Erreur: ImageMagick ('magick' ou 'convert') est requis pour la conversion PNG -> WEBP." >&2
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
files=("$SRC_DIR"/AMSPIRIT_*.SNA "$SRC_DIR"/AMSPIRIT_*.PNG)
shopt -u nocaseglob

if [[ ${#files[@]} -eq 0 ]]; then
    echo "Aucun fichier AMSPIRIT_*.{SNA,PNG} trouve dans $SRC_DIR" >&2
    exit 0
fi

count_ok=0
count_skip=0

for src_path in "${files[@]}"; do
    filename=$(basename "$src_path")
    ext="${filename##*.}"
    base="${filename%.*}"

    # base = AMSPIRIT_X_YYYY -> on retire le prefixe puis on isole le dernier
    # segment (YYYY) ; tout le reste (avant le dernier underscore) est X.
    rest="${base#AMSPIRIT_}"
    if [[ "$rest" == "$base" || "$rest" != *_* ]]; then
        echo "Ignore (nom inattendu): $filename" >&2
        count_skip=$((count_skip + 1))
        continue
    fi
    x_part="${rest%_*}"
    yyyy="${rest##*_}"
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

    case "${ext^^}" in
        SNA)
            dest="$OUT_DIR/${new_base}.SNA"
            cp -n -- "$src_path" "$dest"
            ;;
        PNG)
            dest="$OUT_DIR/${new_base}.webp"
            "${CONVERT_CMD[@]}" -- "$src_path" "$dest"
            ;;
        *)
            echo "Ignore (extension inattendue): $filename" >&2
            count_skip=$((count_skip + 1))
            continue
            ;;
    esac

    echo "OK: $filename -> $(basename "$dest")"
    count_ok=$((count_ok + 1))
done

echo ""
echo "Termine: $count_ok fichier(s) traite(s), $count_skip ignore(s). Sortie: $OUT_DIR"
