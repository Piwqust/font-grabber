@echo off
setlocal

where cargo >nul 2>nul
if errorlevel 1 (
  echo Rust cargo was not found on PATH.
  echo Install Rust from https://rustup.rs/ and try again.
  exit /b 1
)

cargo run --manifest-path "%~dp0rust\Cargo.toml" -- grab %*
