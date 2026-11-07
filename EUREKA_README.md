# EUREKA — OPEN ASTRONOMY · v4 (complete-data local research prototype)

**Purpose:** a citizen-led exploration workspace for real astronomy observations. People can look for **unclassified moving-source candidates**, document evidence, and prepare a portable case for an astronomer to review independently. The bundled known-asteroid demo is **training only**. The SPHEREx galaxy/star-cluster gallery is **field inspection only**, not a moving-object detection claim.

## Open on macOS

- Download and unzip `EUREKA_Open_Astronomy_FULL_v4.zip` (the large complete-data bundle).
- Open Terminal and navigate into the unzipped folder: type `cd `, drag the folder into Terminal, press Enter.
- Check `bash scripts/check_eureka.sh` (original science suite + candidate-screening tests).
- Start `bash scripts/run.sh` and open `http://127.0.0.1:8501` in Safari.
- Leave Terminal running. Stop with `Ctrl+C`.

**No npm install necessary** for the bundled data and tests. Live archive searching needs an internet connection and accessible NASA/IPAC archive services. New fields may have no coverage or insufficient compatible epochs.

## Where to click

1. **Explore unclassified candidates / Search the real sky:** opens original research search form, with NASA archive selector, date range, target resolver, sky map, and RA/Dec. Choose a **different sky field** (the default coordinates are from the known training example). Use published dates appropriate to the selected archive.
2. **Practice with Nemesis:** a known NEOWISE asteroid. Play the original frames and learn source selection. Training notes never become unclassified candidates.
3. **SPHEREx field gallery:** Andromeda/Pleiades/M101/3I-ATLAS *field inspection only*; different wavelengths do not establish motion.
4. **Video tutorial:** embedded narrated-by-text/English-caption 39-second visual guide using genuine processed IRSA image arrays, no audio narration. The interactive three-step guide remains available.
5. **My notebook:** position-linked local annotation plus quality flags; saves in browser storage and supports JSON/CSV exports.
6. **Review desk:** local provisional queue for open-sky possible-motion notes. Requires matched bands/wavelengths, image quality, at least three independent timestamped marks and a recorded identity check before the **preliminary** screen yields “expert review needed”. Never asserts that something is newly discovered. Export/import JSON for independent offline analysis, no network submission.

## Scientific boundaries

- A source without an immediate catalog match is **not** evidence of an unidentified, newly discovered planet or other novel celestial object.
- An apparent shift can arise from image registration error, wavelength-dependent morphology, partial coverage or artifacts; known objects may also be absent from a limited positional lookup.
- A basic screening pass is not a validated astrometric detection. Expert analysis requires calibrated, repeatable detections, uncertainty accounting, independent catalog/ephemeris work and follow-up.
- The NEOWISE moving example is **128 Nemesis**, a known asteroid; it is NOT evidence of Planet Nine.
- M31 and the Pleiades are not candidate moving objects. The supplied M31 SPHEREx pair has different wavelengths.
- SPHEREx **can in principle** support motion analysis in scientifically compatible repeated observations; the curated gallery examples do not establish it.

## What is not yet implemented

This is **not yet** a public Zooniverse-like service: no login or authenticated astronomer portal, multi-user centralized candidate records, independent volunteer consensus, automated expert notifications, real-time cross-user ranking, or discovery publishing. No local note is automatically sent to NASA or to researchers. The review decision controls are self-annotations, NOT true expert approval.

## Preservation of scientific code

Full original Planet X Observatory 1.1.0 reference inputs are bundled (50 source FITS, original JSON cases, Python/JS modules). Original science algorithms are unmodified. Three original UI/server files were extended: `web/index.html`, `web/app.mjs`, `web/server.mjs`. Additive EUREKA files supply CSS, notebook, video, candidate-screening, UI and tests. The `PACKAGE_MANIFEST.json` describes the original reference version, **not** this customized variant; use `scripts/check_eureka.sh`, not the original exact-byte verification command.

For the full conceptual and feature changelog, see [EUREKA_V4_CHANGES_GR.md](EUREKA_V4_CHANGES_GR.md). For collaboration, see [EUREKA_PATCH_INSTRUCTIONS_GR.md](EUREKA_PATCH_INSTRUCTIONS_GR.md).
