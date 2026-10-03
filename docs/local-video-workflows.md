# Local video workflows

OpenAware 0.3 adds VSS-inspired workflows using the existing desktop/camera capture and local LM Studio, Ollama and llama.cpp adapters. No NVIDIA VSS server, GPU containers, RTSP server, model download or cloud account is required. NVIDIA's CLI is a client for its deployed services, so these are OpenAware commands and an original local implementation rather than an API-compatible VSS server.

## In the app

Connect sources through **Add source**. In **Connections**, choose LM Studio, Ollama or llama.cpp as the running local provider, select a vision model and pass the synthetic vision probe. Enable AI analysis for the desired sources and click **Start watching**. Live previews remain independent of inference speed.

The temporal option retains up to three chronological masked samples per source spanning at most four seconds. The newest frame must be fresh when dispatched. Background inference uses one source at a time and only the selected model. Footers show the analyzed interval, sample count and age. Background captions and historical summaries have a 60-second deadline to accommodate slower local inference; late captions remain historical and rule evidence older than 15 seconds becomes unknown. Current questions and Operator retain their 20-second deadline and 15-second completion freshness. The model sees sampled images; this does not establish native continuous-video ingestion or every-frame understanding.

The lower **Video memory** pane contains session captions. Search ranks caption words locally and can filter sources or capture times. Summaries run asynchronously over up to 25 retained captions and send only caption text to the selected local model. A summary shows its source/time scope and never claims to inspect the current desktop. A single-source filter excludes captions that also cite another source.

Add an alert rule in Connections with a name, visible condition and explicit sources. Rules need two distinct matching observations and have a 30-second cooldown. Missing, malformed, uncertain, stale or mismatched rule evidence does not alert. Disable or edit a rule to reset its state. Alerts appear in activity/Event log; they do not run Operator actions.

Session memory remains bounded: 100 captions, 100 chat messages, 1000 events and 16 MiB combined. No raw video recording or vector database is added. Pause, Stop, source/model/mask changes and clearing history invalidate affected work. Stop also releases capture; reconnect sources through the app to resume.

## Agent and CLI access

Build from source, then launch:

```powershell
npm run build
node_modules/.bin/electron.cmd . --enable-cli
node dist/cli.cjs status
node dist/cli.cjs sources
```

The installed app accepts `OpenAware.exe --enable-cli`; its CLI is shipped at `resources/cli.cjs`. Node.js 24 or later is required for the CLI, but the desktop app itself uses its bundled Electron runtime. `--background --enable-cli` starts an idle tray session. Configure a fresh session using tray Show.

```powershell
node dist/cli.cjs ask "Describe the selected monitor" --sources SOURCE_UUID
node dist/cli.cjs captions search "chart" --limit 20
node dist/cli.cjs captions summary --question "Summarize the recorded changes"
node dist/cli.cjs rules add --name "Activity" --condition "A person is visible" --sources SOURCE_UUID
node dist/cli.cjs rules list
node dist/cli.cjs watch start
node dist/cli.cjs watch pause
node dist/cli.cjs watch stop
```

Use UUIDs returned by `sources`, not names. See `node dist/cli.cjs --help` for source/time scopes and rule editing. `captions summary` returns a job state immediately; check `status` for completion. Time scopes use ISO dates with timezone.

The opt-in control listener binds only 127.0.0.1 on a random port. The CLI reads a private user-data connection file containing its bearer token. Browser-origin requests, alternate Hosts, unauthenticated requests, oversized bodies and commands outside the whitelist are rejected. CLI Stop goes through main-process immediate capture teardown. The interface cannot acquire sources, inject pixels, select providers/models, authorize native input or invoke a shell.

The portable [OpenAware skill](../skills/openaware-video-workflows/SKILL.md) describes these commands. After building, run `powershell -File scripts/install-video-skill.ps1` to install the instructions and bundled CLI under your Codex skills folder. Future Codex sessions can discover it as `$openaware-video-workflows`. The script copies only those two files and no private connection descriptor. A custom destination can be supplied with `-Destination`.

## Relationship to NVIDIA VSS

Chunked observations, time-associated captions, rules, memory queries and summary command groups are inspired by [NVIDIA Video Search and Summarization](https://github.com/NVIDIA-AI-Blueprints/video-search-and-summarization). NVIDIA's DeepStream/NVDEC, CUDA inference, EVS++, NIM containers and distributed infrastructure are not included. OpenAware does not advertise NVIDIA VSS compatibility, VSS deployment, NVIDIA model weights or Axelera Metis acceleration. Its original code remains MIT.

## Direct llama.cpp (0.3.1)

Choose **llama.cpp** in Connections and enter the local server origin, usually `http://127.0.0.1:8080` (omit `/v1`). Discover models, select the returned model ID and run the same synthetic vision test before starting monitoring. Unknown capability metadata remains unverified until that test succeeds. Existing captions, semantic rules, source scopes, search, summaries and the CLI use this binding.

Start your existing compatible vision model and projector with `llama-server`, for example:

```powershell
.\llama-server.exe -m "C:\Models\vision.gguf" --mmproj "C:\Models\mmproj.gguf" --host 127.0.0.1 --port 8080 --alias openaware-vision
```

Replace the example files with a matched supported model/projector. OpenAware neither installs the server nor downloads models or calls model-management endpoints. Your server controls inference-time model loading, caching and logging. Text-only models cannot watch screens; successful synthetic probing is still required. The adapter reads `/v1/models` and sends image content parts or caption text to `/v1/chat/completions`, per the [llama.cpp server](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) and [multimodal](https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md) documentation. A real llama.cpp model/runtime performance check remains an acceptance gate.
