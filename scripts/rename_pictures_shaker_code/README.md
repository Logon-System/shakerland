# rename_shaker.sh

Bulk-renames `<PREFIX>_X_YYYY.<ext>` files (any emulator prefix: `AMSPIRIT_`, `CPCSE_`, ...) into `<Test>_CRTC<X>_<Subset>.{SNA,webp}`,
based on a CSV lookup table (`RefHexa;Test;Subset`).

- Renamed copies are written to `<source_dir>/shakerland` — the source directory is never modified.
- `.SNA` files are copied as-is; images (`.png`, `.bmp`, `.jpg`, `.gif`, `.tga`, `.tif`) are converted to `.webp` (via ImageMagick's `magick`, or `convert` as a fallback).
- `X` is the second-to-last `_` segment, `YYYY` (4 hex digits) the last one; the prefix is ignored.
- The hex code (`YYYY`) is matched against the CSV's `RefHexa` column, case-insensitively.
- Files with an unexpected name, an unknown hex code, or an empty `Test` column are skipped and reported.

## Usage

```bash
./rename_shaker.sh <source_directory> <csv_file>
```

Example:

```bash
./rename_shaker.sh ../../../Shaker_CSL/MODULE_A/ ./shakerland_code_to_test_id.csv
```

## Requirements

- `bash`
- ImageMagick (`magick` or `convert`)
