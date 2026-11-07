# EUREKA v4 — Verification report

- Baseline package: Planet X Observatory v1.1.0 (pinned original reference).
- 152 original manifest entries are unchanged byte-for-byte. `web/index.html`, `web/app.mjs`, `web/server.mjs` extended intentionally. Original science algorithms, FITS and JSON reference data unchanged.
- `scripts/check_eureka.sh`: full **43/43 Node tests passed** on 7 November 2026 (36 baseline/EUREKA-v2 + 7 new candidate pipeline tests).
- `GET /api/health`: HTTP 200, returns original archive list and version.
- `GET /`: HTTP 200.
- `GET /eureka-tutorial.mp4`: HTTP 200; playable encoded MP4 is 39s, actual NASA/IPAC processed FITS slides; caption file `GET /eureka-tutorial.vtt`: HTTP 200.
- JavaScript syntax checks: pass.

**Limitation:** The container's Chromium browser policy returned `ERR_BLOCKED_BY_ADMINISTRATOR` even for localhost and file URLs. Therefore we **could not** complete genuine mouse-click end-to-end browser automation. Do not interpret the 43 automated tests as confirmation that every Safari control works in a real session. Manual Safari checks are still required, especially open-sky discovery, JPL identity calls, notebook, import/export and mobile responsiveness.

**Scientific limitation:** No verified unknown object or discovery was identified. Local-screened cases are not reviewed by real astronomers, and no independent multi-user backend exists.
