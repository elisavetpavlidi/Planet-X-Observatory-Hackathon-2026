# Planet X Observatory · v1.1.0

The result now follows the user's selected source, whether marked manually or suggested automatically. **Your source** shows measured shift, fitted rate, time span, motion assessment and possible catalogue identity. **Sources to inspect** includes the manual selection alongside automatic proposals and avoids double counting. A missing automatic proposal no longer appears to negate a user's measurement.

The automatic detector uses any usable epoch pair rather than requiring source detections in the first and last loaded images. Repeated fixed-source positions are excluded from trajectory seeds, while stationary alignment controls, independent times, supported detections and compatible bands remain required. Manually selected stationary sources, incomplete selections, invalid marks and spectral incompatibility receive explicit statuses. A motion assessment is a screening result, not an orbit or discovery confirmation.

A fourth offline session retains the real consecutive NEOWISE query: 12 rows, nine usable original image triplets, three coverage rejections, and four recovered source positions. An independent JPL check is consistent with 128 Nemesis within about 0.51 arcseconds. The source is not required to be detected in the final image. Original URLs and hashes, including three additional exposures, are bundled for exact offline reconstruction.

## Reproduce

Use tag **v1.1.0** and Node **24.22.1**. From the extracted project folder:

```bash
bash scripts/setup.sh
bash scripts/run.sh
```

Open http://127.0.0.1:8501. Setup verifies the package, original FITS and four byte-identical reconstructed sessions, then runs the Node tests. Python is optional; its pinned environment and quality tools remain separate. No npm runtime dependency is added.

## Existing work

Save the current session before updating. Stop the old server, start this release in its own folder, then open the saved JSON. Older sessions remain supported, including frame-index remapping when their observations were saved out of time order. The motion result is recomputed rather than trusted from an imported report. See [UPDATE.md](UPDATE.md). The v1.0.0 tag is preserved.

## Validation and scope

See [VALIDATION.md](VALIDATION.md) and the actual Actions run for this commit. The four CI jobs check the web application and optional science tools on clean macOS/Linux checkouts. The Greek guide and reproduction instructions accompany this exact version.

Supported archives remain WISE/NEOWISE W1/W2 and SPHEREx QR2/QR3 Wide/Deep, where public coverage exists. New remote requests depend on upstream services. Linear-track screening is not complete for all speeds, backgrounds, blends, masks, wavelength differences or curved motion. Catalogue matches remain candidates. Scientific limitations are documented in [DATA.md](DATA.md) and [SCIENCE.md](SCIENCE.md).

The repository remains private. This release does not deploy a public website or modify the frozen v1.0.0 release.
