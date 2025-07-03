# AI Podcast Generator

Generate full podcast episodes on‑demand with OpenAI—one **Host** (male voice) and one **Guest** (female voice).  Runs 100 % on the client side; users paste their own API key, type a topic, and get a transcript plus playable audio.

Demo Link: https://ai-podcast-one.vercel.app
---

## ✨ Features

* **Chat‑powered script** · 8–10 turns (\~1 k words) with `Host:` / `Guest:` labels.
* **Dual‑voice TTS** · Host → `alloy` (male), Guest → `nova` (female).
* **Segmented playback** with Play / Pause / Skip and turn counter.
* **Key stored locally** (no server; nothing leaves the browser).
* Beautiful UI built with **Next.js 14 / React Server Components**, **Tailwind CSS v4**, **shadcn/ui**, **Lucide icons**, **Framer Motion**.

---

## 🖥️ Quick start

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000), paste your **OpenAI API key**, enter a topic like *“The future of quantum computing”*, click **Generate Podcast**.

---

## 🔧 How it works

1. **Transcript** — Calls the Chat Completions endpoint (`gpt-4o-mini`) with a system prompt that enforces the Host/Guest format.
2. **Chunking** — Splits the returned text into speaker‑specific chunks.
3. **TTS** — Sends each chunk to the Audio → Speech endpoint (`tts-1`) with the appropriate voice; receives MP3 blobs.
4. **Playback** — Queues blobs in an `<audio>` tag and exposes minimal controls.

Everything happens in the browser—no serverless functions, no env vars.

---

## 🚀 Deploying to Vercel

Connect the repo at [https://vercel.com/new](https://vercel.com/new), accept defaults, **Deploy**.  Since all calls are client‑side, no additional Vercel settings are required.