---
title: Deployment (Windows Service)
---

On Windows, manage `rolecall --serve` as a long-lived service through a dedicated supervisor, because RoleCall ships no built-in Windows service installer. Three community tools commonly fill that role, all third-party and unendorsed, listed here purely as approaches people take rather than recommendations. NSSM registers the exe with `nssm install Rolecall "C:\path\to\rolecall-windows-x64.exe" --serve`; WinSW uses an XML manifest plus its installer (`winsw install rolecall.xml`); Shawl offers a small .NET lifecycle wrapper around a cmd.exe invocation. Whichever you pick, pin the executable path to the correct published binary such as `dist/bin/rolecall-windows-x64`.

Consider hiding the console window so no interactive terminal appears when the service starts. Build the Windows binary itself with `node scripts/build-bin.mjs --target windows-x64`, optionally threaded through the builder's banner flags to request `--windows-hide-console`. Then register whatever tool you chose against that pinned path and confirm it comes back healthy after a reboot.

Keep expectations grounded: these steps describe configuration, not a supported installer. Nothing here changes how RoleCall behaves at runtime, and the underlying serve subsystem boots a real HTTP server today (scheduled/cron/webhook/UI triggers remain scaffolded). For the endpoints the service exposes once running, read [/reference/serve-command](/reference/serve-command); for building the binaries these supervisors wrap, see [/deployment/native-binaries](/deployment/native-binaries).
