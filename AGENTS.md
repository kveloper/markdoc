# Build requirements

After completing each user-requested application change, run `npm run dist` to regenerate the MSI installer (`release/Markdoc-1.0.0-setup-x64.msi`) and unpacked application (`release/win-unpacked/Markdoc.exe`). Verify the build succeeds before reporting completion. A Vite-only build is not sufficient.

Do not build portable executables unless the user explicitly requests them again.
