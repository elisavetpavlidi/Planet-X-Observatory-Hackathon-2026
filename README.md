# Planet X Observatory · 1.1.0

Explore a sky field and date range, compare real NASA infrared observations, mark a moving source and check a possible identity.

**This is the final application release, with English UI and a Greek operating guide.** Use the `v1.1.0` tag to reproduce this exact version. Source and data live in this private repository. No site is deployed by these instructions.

## Start

Install **Node.js 24.22.1** (the tested version; Node 22+ is supported). No npm packages, Python, API key or account are required to run the app and its offline checks.

Open a terminal **inside this repository folder**, then run:

```bash
bash scripts/setup.sh
bash scripts/run.sh
```

Open **http://127.0.0.1:8501**. Keep the terminal open; stop with **Ctrl+C**.

`setup.sh` verifies every release file, regenerates all four saved sessions from original hash-verified FITS into `outputs/reproduced/`, compares them with this release, and runs the Node tests. It works offline once Node and this repository are on the computer. Running it again does not modify release files.

## Use

1. Choose a position with **Choose on sky**, an object name, or RA / Dec.
2. Choose an archive and dates, then **Find observations**.
3. Use **Play**, the timeline, thumbnails and **Earlier / Later images**. The observation list retains returned metadata; pixels load in groups of up to 12.
4. Click the same source in successive images, or choose an automatic suggestion. **Your source** shows the measured shift, rate and motion assessment for either method. **Sources to inspect** keeps your selection alongside automatic suggestions without double counting it. **Check identity** compares positions at the actual observing times.
5. **Save session** stores loaded image arrays, your marks and any identity result. **Open saved session** restores them offline. Future image downloads still require internet.

**Saved observations** contains six real NEOWISE W2 exposures of a field crossed by asteroid **128 Nemesis**, and two original SPHEREx images of stationary **M31**. The latter have incompatible local wavelengths and are for inspection only. An additional **NEOWISE · consecutive images** session contains nine real images from a complete 12-row query, retaining three coverage rejections. The source is recovered from four measured epochs even though its last image position is near the boundary. There is no simulated observation mode in the app.

Full instructions: [Greek user guide](docs/USER_GUIDE_EL.md), [PDF](docs/Planet_X_User_Guide_EL.pdf), [exact reproduction](REPRODUCE.md), [release record](docs/RELEASE.md).

## Scope

- **WISE / NEOWISE:** public W1/W2 single exposures from All-Sky, 3-band, Post-Cryo and Reactivation collections; actual mission coverage in 2010–2011 and 2013–2024.
- **SPHEREx:** public QR2 / QR3 Wide and Deep collections, subject to the release's published dates and coverage.
- You can choose any celestial position and dates. The app returns observations only where a supported mission observed. It does not include every NASA mission, all wavelengths or continuous coverage.
- Long searches run in date windows; incomplete requests and failed images are reported. No silent time sampling removes returned metadata. Safety limits: 150,000 rows per session, at most 12 loaded images, 4–12 arcminute fields in the interface.
- Automatic linear tracks require at least three independent epochs within 48 hours, stationary controls and compatible bands. They can start and end in any usable epoch; visibility in the first or last loaded image is not required. They are exploratory candidates. Galaxies normally form the stationary background; image differences alone do not establish motion.
- IMCCE SkyBoT preselects possible Solar System objects; NASA/JPL Horizons checks the selected spacecraft and observation times. A possible match needs review. No match is not a discovery.

Read [data provenance](docs/DATA.md), [science methods and limits](docs/SCIENCE.md) and [acknowledgements](THIRD_PARTY_NOTICES.md).

## Files and checks

| Location | Purpose |
|---|---|
| `web/` | English app, local Node server, archive adapters, FITS/WCS, motion candidates and identity checks |
| `data/` | Original FITS, hashes, recorded metadata, saved sessions and independent validation references |
| `scripts/reproduce.sh` | Full offline release verification and deterministic rebuild |
| `tests/` | Automated checks, including synthetic controls confined to tests |
| `docs/` | User guide, science/data record and release instructions |
| `planetx/` | Optional Python SPHEREx quality/difference analysis tools |
| `.github/workflows/verify.yml` | Clean-checkout reproduction and science checks on macOS and Linux |

```bash
bash scripts/reproduce.sh            # Same complete check as setup
node scripts/check_services.mjs      # Optional live NASA service check; writes outputs/
```

The optional Python tools use Python **3.12.14**, pinned dependencies and their own instructions in [SCIENCE.md](docs/SCIENCE.md). They are not needed to open the website. The complete saved datasets are stored directly in Git; no Git LFS or external preparation is required.

## Updating from v1.0.0

Save your current session first. Download the **v1.1.0** ZIP into a new folder, stop the old server with Ctrl+C, and run setup/start from the new folder. Open the saved JSON using **Open saved session**. The new version recomputes the motion assessment from its marks and images; an old stored result is not trusted. The frozen v1.0.0 tag remains available. See [UPDATE.md](docs/UPDATE.md).
