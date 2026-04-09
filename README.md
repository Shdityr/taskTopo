# TaskTopo — Smart Task Scheduler

A desktop app that automatically computes the optimal task execution order using **Kahn's topological sort** and a **priority scoring algorithm**.

Built with [Tauri 2](https://v2.tauri.app) (Rust + HTML/JS), runs natively on **macOS** and **Windows**.

---

## Features

- **Add tasks** with name, description, deadline, estimated hours, and willingness level
- **Set dependencies** — visually connect tasks in the graph view (drag-free click-to-link)
- **Auto scheduling** — Kahn's topological sort + priority score ensures both dependency order and urgency are respected
- **Dependency graph** — interactive SVG visualization with score badges per node
- **Mark complete** — track progress with a live completion bar
- **Local persistence** — all data stored in `localStorage`, no server needed

## Scheduling Algorithm

```
Priority Score = willingness × 40 + urgency

willingness : High = 3, Med = 2, Low = 1
urgency     : 120 (overdue) → 100 (today) → 80 (≤3d) → 60 (≤7d) → 20 (≤30d) → 5
```

Kahn's algorithm processes tasks in topological order, always picking the highest-score ready task next.

---

## Tech Stack

| Layer    | Technology                        |
|----------|-----------------------------------|
| Shell    | Tauri 2 (Rust)                    |
| Frontend | Vanilla HTML + CSS + JavaScript   |
| Storage  | localStorage (offline, no server) |
| Build    | Cargo + npm                       |

---

## Development

### Prerequisites

- [Rust](https://rustup.rs) (stable)
- [Node.js](https://nodejs.org) (v18+)
- Tauri system dependencies — [macOS](https://v2.tauri.app/start/prerequisites/#macos) · [Windows](https://v2.tauri.app/start/prerequisites/#windows)

### Run locally

```bash
npm install
npm run dev
```

### Build

```bash
npm run build
```

Output: `src-tauri/target/release/bundle/`
- macOS → `.dmg`
- Windows → `.msi` / `.exe`

---

## CI Builds (GitHub Actions)

Every push to `main` triggers a cross-platform build.
Download the latest artifacts from the [Actions tab](../../actions).
