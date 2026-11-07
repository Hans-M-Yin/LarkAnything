# LarkAnything glass-ribbon icon

Approved image: `larkanything-master.png` (image_gen, blue/aquamarine glass ribbon).

Production export source: `larkanything-icon.svg`. It embeds the approved opaque master and applies a continuous rounded-square silhouette. This avoids alpha noise from generated cutouts: the exterior is transparent and the interior stays opaque.

Regenerate platform icons from the Tauri workspace:

```powershell
node node_modules/@tauri-apps/cli/tauri.js icon desktop/assets/brand/larkanything-icon.svg
Copy-Item src-tauri/icons/128x128@2x.png desktop/assets/larkanything.png
npm run desktop:build
```

After compiling the Windows executable, verify its actual native icon resource (not just the web UI asset):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-windows-icon.ps1 -ExePath src-tauri/target/release/larkanything-desktop.exe
```

The build script watches `src-tauri/icons` so icon changes also rebuild native resources during incremental builds. Verification compares the embedded icon with the source ICO at 16, 32, 48, and 256 pixels.

The previous white-exterior proposal is not the production icon. The original image_gen transparent attempt is retained as `larkanything-transparent-source.png` for provenance, not used at runtime.
