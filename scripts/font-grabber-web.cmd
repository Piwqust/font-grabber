@echo off
setlocal

where cargo >nul 2>nul
if errorlevel 1 (
  echo Rust cargo was not found on PATH.
  echo Install Rust from https://rustup.rs/ and try again.
  exit /b 1
)

echo Starting Font Grabber web app...
echo The browser will open automatically. Press Ctrl+C in this window to stop.
echo (First launch compiles in release mode and may take a minute.)
echo.

cargo run --release --manifest-path "%~dp0..\core\Cargo.toml" -- serve %*
