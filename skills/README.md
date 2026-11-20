# Fount for AI agents

[`grab-fonts`](grab-fonts/SKILL.md) is an [Agent Skill](https://agentskills.io): give your
agent a website and it saves the site's fonts as TTF/OTF files.

```text
/grab-fonts https://displaay.net/typeface/perfektta
/grab-fonts vercel.com Geist Mono
скачай шрифты с https://vercel.com в папку ~/Downloads/fonts
```

Nothing has to be installed first. On the first request the skill's launcher downloads
Fount's portable binary (about 10 MB) from this repository's
[releases](https://github.com/Piwqust/font-grabber/releases), checks it against the
release's `SHA256SUMS.txt`, keeps it in a per-user cache and runs it from there. No admin
rights, no PATH changes, no package manager. Later requests start at once; a newer release
is picked up at most once a day.

## Add the skill to your agent

**Claude Code**, as a plugin (one command, updates with `/plugin update`):

```text
/plugin install fount --marketplace Piwqust/font-grabber
```

On Claude Code older than 2.1.275, run `/plugin marketplace add Piwqust/font-grabber` and
then `/plugin install fount@fount`. Plugin skills are namespaced, so the command is
`/fount:grab-fonts`; asking in plain words ("grab the fonts from …") works too.

**Any agent that reads `SKILL.md`** (Claude Code, Codex, Cursor, Gemini CLI and others):
copy the `grab-fonts` folder into the agent's skills folder, for example
`~/.claude/skills/` for Claude Code (then `/grab-fonts`) or `~/.codex/skills/` for Codex.

```bash
git clone --depth 1 https://github.com/Piwqust/font-grabber /tmp/fount
cp -r /tmp/fount/skills/grab-fonts ~/.claude/skills/
```

```powershell
git clone --depth 1 https://github.com/Piwqust/font-grabber "$env:TEMP\fount"
Copy-Item -Recurse "$env:TEMP\fount\skills\grab-fonts" "$HOME\.claude\skills\"
```

With Node.js available, `npx skills add Piwqust/font-grabber` installs it for the agents it
detects.

## What it runs

The skill tells the agent to run one launcher with Fount's normal CLI arguments:

| Shell | Command |
| --- | --- |
| PowerShell / cmd (Windows) | `powershell -NoProfile -ExecutionPolicy Bypass -File grab-fonts/scripts/fount.ps1 grab <url> --all` |
| sh (macOS, Linux, WSL, Git Bash) | `sh grab-fonts/scripts/fount.sh grab <url> --all` |

Fonts are saved to `fonts/<domain>` under the agent's working folder unless you name
another folder. Chrome, Chromium or Edge already on the machine is used to catch fonts
loaded by JavaScript; without one, Fount reads the page source only.

| Platform | Binary |
| --- | --- |
| Windows x64 (also runs on Windows on Arm) | `font-grabber-windows-x64.zip` |
| Linux x64 / arm64 (glibc 2.36+) | `font-grabber-linux-x64.tar.gz`, `font-grabber-linux-arm64.tar.gz` |
| macOS Apple Silicon / Intel | `font-grabber-macos-arm64.tar.gz`, `font-grabber-macos-x64.tar.gz` |

Elsewhere the shell launcher builds Fount once with `cargo` when Rust is present.

| Variable | Effect |
| --- | --- |
| `FOUNT_BIN` | Run this `font-grabber` binary instead of downloading one |
| `FOUNT_VERSION` | Use a release tag such as `v3.2.0` instead of the latest |
| `FOUNT_CACHE` | Cache folder. Default `%LOCALAPPDATA%\fount`, `~/.cache/fount`, `~/Library/Caches/fount` |
| `CHROME` | The browser used for dynamic discovery |

Fonts are licensed software. Use the files for inspection and testing, or for type you have
the right to use, and check the foundry's licence before putting them in a project.
