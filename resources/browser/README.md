# Offline render browser

Install with `scripts/setup-render-browser.ps1`. The script pins Chrome for Testing Headless Shell **152.0.7977.75**, Windows x64, and validates the archive SHA-256 before extraction. It records the hash of every extracted runtime file in `manifest.json`, including the bundled license/credits file. The renderer uses this explicit path and never downloads a browser at runtime. Developers may override it with `VOXWEAVE_CHROME`.

Source: https://storage.googleapis.com/chrome-for-testing-public/152.0.7977.75/win64/chrome-headless-shell-win64.zip

Archive SHA-256: `97bf78fdb5eba45b19ba875e2215cf02813c576780ad406ad7d2a003eef4b956`
