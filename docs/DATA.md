# Original data and interpretation · 1.1.0

The release stores original image bytes directly in Git. `PACKAGE_MANIFEST.json` inventories release files. `data/manifest.json` records original SPHEREx sizes, SHA256, observation IDs and URLs where known. Downloads never replace missing originals during an offline reproduction.

## Saved NEOWISE field

`data/neowise/reference.json` records the six selected W2 exposures, each science/uncertainty/mask URL, raw SHA256 and field/date query. The original 18 files are in `data/neowise/frames/`. Files with `.gz` names are decoded by their actual magic bytes rather than their filename.

`scripts/build_reference.mjs` regenerates the display images, diagonal variances, raw-pixel aperture peaks, and track candidates without network access or target ephemerides. It checks each raw hash first. It uses a common celestial grid (2.75 arcsec/pixel), MAGZP=20 and a per-frame median background. The display's resampling correlates nearby pixels; display variance is not a calibrated discovery statistic.

The selection was located using IRSA MOST for asteroid **128 Nemesis**. Detection is then run on the images without those positions. `validation_truth.json` retains independent MOST positions, `wcs_reference.json` independent Astropy/WCSLIB checks, and `identification.json` the actual retained JPL check. The valid recovered track has three measured epochs within the six-image sequence; the other images do not all contain a usable source core. A saved identity result is marked as saved, not presented as a new live query.

`nemesis.json` is a recorded six-image selection, not a claim of complete archive coverage. `observations_2018_2019.json` combines the same six cached images with 46 actual metadata rows from the recorded two-year query in `catalog_2018_2019.json`. Those 46 rows are not 46 cached image triplets; loading other rows requires the archive. The recorded search time and query are retained.

## SPHEREx

`data/reference/m31/observation_A.fits` and `observation_B.fits` are the original user-supplied cutouts. Their exact initial download URLs were not supplied, so the repository does not invent them. Hashes and original IDs establish file identity. Their saved session is rebuilt from those bytes, not an independent new sky observation.

M31 is stationary on these timescales. The two images sample different local wavelengths (about 2.44189 and 2.54184 µm); changes in appearance do not demonstrate motion or variability. Named IMAGE, FLAGS and VARIANCE extensions and alternate WCS/WCS-WAVE mappings are checked. Blank pixels represent missing or rejected data.

`data/validation/` includes additional real Pleiades and M101 cutouts and recorded small-body checks. Spectral mismatch or inadequate signal is retained as an exclusion, not turned into a positive detection. Independent SPHEREx WCS reference coordinates are in `data/spherex_wcs_reference.json`.

## Live searches and identity

The app's supported collection definitions are in `web/model.mjs`. Live discovery partitions long date ranges and retains returned metadata, including overlapping and low-quality exposures when the selected filters permit them. It reports failed windows, row limits and failed images. Groups of up to 12 loaded images bound memory; they do not remove metadata from the observation list.

An automatic candidate requires at least three independent epochs within 48 hours, a linear trajectory, stationary comparison sources and compatible bands. This is a screening heuristic, not a completeness or false-alarm calibration across all fields. Saturation, source blending, low signal, masks, variable PSFs and color-dependent SPHEREx passbands can prevent or imitate a candidate.

Identity preselection uses IMCCE SkyBoT and then NASA/JPL Horizons at the actual times, with WISE or SPHEREx as observer. Geocentric preselection can miss close bodies. At most three nearby candidates are checked. A positional or track-consistent match is a candidate; no match is not a new-object announcement.

Historical live-service responses are in `data/service_checks/`; their timestamps state when they were retrieved. They are not a guarantee of future service availability. All-sky reference stars/constellations are a J2000 navigation guide, not a dated NASA image.

## Unified motion assessment in 1.1.0

Manual selections and automatic proposals use `web/motion.mjs` for the same measurement result. It reports the largest separation among marked positions, a common-grid linear rate, independent epochs and stationary controls. A one-epoch mark is incomplete; two epochs show a provisional position change. A resolved motion assessment requires three independent epochs, compatible observers/bands/scales, valid marked pixels with source support, at least two stationary references and a consistent linear path. Unresolved shifts and inconsistent or unsupported measurements are labelled explicitly. Marks must have a measured source peak or a local image excess relative to the local background and pixel variance; coherent clicks on empty background are rejected. Selections that mostly jump among repeated stationary sources remain for review. These resolution/alignment/source-support guards are screening rules, not calibrated statistical confidence. SPHEREx additionally requires compatible source-local wavelengths; a mark without those wavelengths remains for review.

`Sources to inspect` includes the user's selected source even when the automatic detector finds none. A selected source is not counted twice when it matches a proposal. Stationary selections remain visible with **No resolved motion**; catalogue matches remain possible identities with their own provenance. Saved sessions include the result and measurement origin, but results are recomputed when opened. An older selection with no recoverable origin is labelled Saved selection rather than assigned a false manual/automatic origin. Individual marks can be removed from Positions & measurement.

Automatic seed pairs can come from any two usable epochs. Potentially fixed source locations that repeat in at least three epochs are excluded from seed selection. A source crossing a stationary object can still contribute an interior measurement. At least three supported epochs and adequate coverage among usable frames are required. This removes the previous mandatory first/last-image detection while retaining conservative source and stationary-reference controls; slowly moving or blended objects may still be missed.

`sequence_reference.json` records a fresh 2 November 2026 search of the original field: 12 metadata rows, nine accepted original image triplets, three coverage rejections. Original bytes for three additional exposures are retained beside the earlier six. Each product has its official URL and SHA256. `consecutive.json` is regenerated offline as the fourth saved session. `sequence_identification.json` retains the actual independent JPL spacecraft check of all four recovered positions: a possible match with 128 Nemesis, maximum offset about 0.51 arcseconds. Detection does not read this identity evidence. The last loaded image contributes no accepted asteroid peak; the preceding measurements still form the candidate.
