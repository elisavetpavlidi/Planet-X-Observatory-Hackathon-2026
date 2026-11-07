# EUREKA | Open Astronomy

Citizen-science astronomy prototype based on the NASA Space Apps Challenge Planet X / SPHEREx project.

## Upload status

**The full v4 source and observational data have NOT been imported into this repository yet.**

The uploaded `EUREKA_Open_Astronomy_FULL_v4.zip` contains **175 files** and approximately **78 MB** of uncompressed material, including original astronomical FITS products. The separate `EUREKA_UI_PATCH_v4.zip` has **20 files that match exactly** the corresponding files inside the full v4 ZIP.

The full v4 project passed **43/43 JavaScript tests** in local verification.

The repository contains a vetted importer script at `tools/IMPORT_FULL_EUREKA_V4.sh`. On the Mac with the original ZIP in Downloads, run:

```bash
curl -fsSL https://raw.githubusercontent.com/elisavetpavlidi/Planet-X-Observatory-Hackathon-2026/main/tools/IMPORT_FULL_EUREKA_V4.sh -o "$HOME/Downloads/IMPORT_FULL_EUREKA_V4.sh"
bash "$HOME/Downloads/IMPORT_FULL_EUREKA_V4.sh" "$HOME/Downloads/EUREKA_Open_Astronomy_FULL_v4.zip"
```

The importer checks all 175 ZIP entries, copies byte-for-byte, clones the remote repository to a new Desktop folder, commits the complete application, and pushes to main. It does not overwrite the existing Planet X project on the Mac. It uses existing GitHub credentials and requires Git and Python 3.

**Do not describe the repository as containing the complete EUREKA implementation before the full import is successfully pushed.**

Once imported, follow `01_ΞΕΚΙΝΑ_ΕΔΩ.txt`, `EUREKA_README.md`, and the included launch scripts.
