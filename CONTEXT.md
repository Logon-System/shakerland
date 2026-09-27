# Shakerland

Frontend + scripts for managing and comparing CPC test-program screenshots ("Amspirit"/CRTC test suite) across emulator/hardware architectures.

## Language

**Arch**:
A system that produces SHAKER screenshots: real hardware, or one emulator. Identified by its id (e.g. `amspirit`). An Arch can have several Arch versions.
_Avoid_: emulator (too narrow: real hardware is an Arch too)

**Arch version**:
One version of an Arch whose results are published (e.g. `amspirit` 0.953 and `amspirit` lite-1.15). Each Arch version has its own Dataset. Several versions of the same Arch can coexist to compare their results.

**Dataset** (per arch/version):
The set of image files expected in `PictureBank/{archId}/{version}/`, one per subtest × CRTC combination declared in `data/tests.json`.

**Missing file**:
An expected file (per `data/tests.json`) that is absent from a dataset's directory. Determines whether a dataset is complete.
_Avoid_: mismatch, error (too broad — see Extra file)

**Extra file**:
A file present in a dataset's directory that does not match any expected name from `data/tests.json`. Does not affect completeness; may indicate a mis-renamed capture.
_Avoid_: mismatch, orphan

**Complete dataset**:
A dataset with zero missing files. Extra files do not affect this status.
