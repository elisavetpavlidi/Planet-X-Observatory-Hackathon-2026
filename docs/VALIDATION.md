# Release validation · 1.1.0

2 November 2026. Local Linux, Node 24.22.1, Python 3.12.14 and Chrome through managed local preview. This record states observed checks, not universal scientific completeness or guaranteed upstream availability.

## Motion result and detector

The Node suite now has **31 tests**: the previous 22 plus nine motion regressions. New checks cover a real manually selected source when its automatic proposals are deliberately suppressed, common manual/automatic measurement and deduplication, missing first/last detections, a stationary manual source, insufficient independent epochs, bad marks, coherent empty-background clicks, switching among fixed stars, missing controls, incompatible bands, masked marks, source-local SPHEREx wavelengths, old-session frame ordering, and the unmodified real consecutive NEOWISE sequence. The full package check reconstructs four canonical sessions from original hashes with network access forbidden. HTTP tests restore both six-image and nine-image cases and identify their tracks with all external fetches disabled.

The actual archived consecutive query contains 12 metadata rows and nine usable original image triplets; three inputs were rejected for insufficient coverage. The new automatic search recovers four source positions and excludes the final boundary image from its accepted measurements. A fresh JPL check is consistent with **128 Nemesis**, maximum offset about **0.51 arcseconds**. `data/service_checks/V1_1_SEQUENCE.json` and `data/neowise/sequence_identification.json` retain the actual timestamps and responses. The detector never reads the JPL positions to generate the track.

The optional Python suite remains **42 tests**, covering original SPHEREx FITS/flags/noise/WCS/wavelength, injection/null controls confined to tests, independent propagation, incompatibility exclusions and service schemas. The Actions workflow checks the exact release source and pinned environments in clean macOS/Linux jobs; consult that commit's actual run result.

## Actual interface checks

- Empty launch showed the search workspace and version 1.1.0.
- An imported controlled session used the real original six image arrays with the moving source's automatic peak proposals suppressed. Importing recomputed the motion result and ignored a deliberately stale stored result.
- After Clear, three source positions were marked through real canvas clicks in three real epochs. One mark showed **One position marked**; two showed **Position change measured**; three showed **Motion measured**, **285.7 arcseconds**, about **16.57 arcseconds/hour**, and five stationary references. There were no automatic source proposals in that controlled fixture. This tests the manual path; the altered peak lists are not a new NASA observation or a production dataset.
- Check identity returned a retained possible match with 128 Nemesis, maximum offset about 1.3 arcseconds for those actual pointer marks. The selected source appeared in **Sources to inspect**, count 1, with **Manual selection**, rather than a misleading zero-motion count.
- Save session downloaded a real JSON containing the measurement and origin. Clear and re-import restored the original images, all marks, the recomputed motion result and the identity marked **From saved session**.
- The unmodified nine-image consecutive session loaded all 12 metadata rows. Selecting its automatic source produced the same result card with **Automatic suggestion**, four measured positions, about **16.55 arcseconds/hour**, and a saved JPL check within 0.51 arcseconds.
- The viewer identifies the loaded field independently of pending search-form coordinates. Old unsorted session frame indexes are remapped before rendering and measuring.
- The updated four-page Greek PDF was rendered and all four pages visually inspected.

Screenshots in `docs/validation/` show the manual and automatic paths. They are interface evidence, not separate scientific exposures.

## Limits retained

The method uses linear-track and image-resolution screening rules. Its motion label is not a calibrated global false-alarm probability, orbit solution or discovery announcement. Slowly moving, blended, curved or faint sources can be missed. Missing data and incompatible local wavelengths remain for review. New live downloads and new catalogue checks depend on their external services. Earlier dated partial service checks remain in `data/service_checks/` and do not imply that every release, sky region or date interval was successfully fetched today.
