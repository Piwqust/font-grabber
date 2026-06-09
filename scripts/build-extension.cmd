@echo off
setlocal

where cargo >nul 2>nul
if errorlevel 1 (
  echo Rust cargo was not found on PATH.
  echo Install Rust from https://rustup.rs/ and try again.
  exit /b 1
)

echo Adding wasm target (no-op if already installed)...
rustup target add wasm32-unknown-unknown

echo Building the WASM converter...
cargo build --manifest-path "%~dp0..\wasm\Cargo.toml" --target wasm32-unknown-unknown --release
if errorlevel 1 exit /b 1

echo Copying convert.wasm into the extension...
copy /Y "%~dp0..\wasm\target\wasm32-unknown-unknown\release\font_convert_wasm.wasm" "%~dp0..\extension\convert.wasm" >nul

echo.
echo Done. Now load the extension in Chrome:
echo   1. Open chrome://extensions
echo   2. Enable "Developer mode" (top-right)
echo   3. Click "Load unpacked" and select the "extension" folder:
echo      %~dp0..\extension
echo.
