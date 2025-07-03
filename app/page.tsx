'use client';

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Mic, Play, Pause, SkipForward } from "lucide-react";
import { motion } from 'framer-motion';

/**
 * PodcastGenerator – client‑side component that:
 * 1. Persists the user‑provided OpenAI key in localStorage.
 * 2. Generates a host/guest transcript (labels "Host:" / "Guest:") via Chat Completions.
 * 3. Splits the transcript into speaker chunks, then calls TTS once per chunk with
 *    different voices (male = "alloy" for host, female = "nova" for guest).
 * 4. Plays the resulting audio segments sequentially with minimal controls.
 */
export default function PodcastGenerator() {
  const [apiKey, setApiKey] = useState('');
  const [topic, setTopic] = useState('');
  const [transcript, setTranscript] = useState('');
  const [segments, setSegments] = useState<{ url: string; speaker: 'host' | 'guest'; text: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentIdx, setCurrentIdx] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  /** Load persisted key once */
  useEffect(() => {
    const stored = localStorage.getItem('openai_api_key') ?? '';
    if (stored) setApiKey(stored);
  }, []);

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const key = e.target.value.trim();
    setApiKey(key);
    localStorage.setItem('openai_api_key', key);
  };

  /** Generate transcript → TTS segments */
  const generatePodcast = async () => {
    setError('');
    if (!apiKey) return setError('Please provide your OpenAI API key.');
    if (!topic) return setError('Please enter a topic.');

    setLoading(true);
    setTranscript('');
    setSegments([]);
    setCurrentIdx(0);

    try {
      /* ---------- 1) Chat transcript ---------- */
      const chatRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content:
                'You are a podcast script writer. Generate a lively podcast transcript with one host (labelled "Host:") and one guest (labelled "Guest:"), 8‑10 dialogue turns (~800‑1000 words). Reply only with the transcript.',
            },
            { role: 'user', content: `Podcast topic: ${topic}` },
          ],
          temperature: 0.8,
        }),
      });
      if (!chatRes.ok) throw new Error(`Chat API → ${chatRes.status} ${chatRes.statusText}`);
      const chatData = await chatRes.json();
      const content = chatData.choices?.[0]?.message?.content ?? '';
      setTranscript(content);

      /* ---------- 2) Split by speaker ---------- */
      const lines = content.split(/\n+/).filter(Boolean);
      type Chunk = { speaker: 'host' | 'guest'; text: string };
      const chunks: Chunk[] = [];
      let curr: 'host' | 'guest' | null = null;
      let buf = '';
      const who = (l: string): 'host' | 'guest' | null =>
        l.startsWith('Host:') ? 'host' : l.startsWith('Guest:') ? 'guest' : null;

      for (const line of lines) {
        const s = who(line);
        if (s !== null) {
          if (curr && s !== curr) {
            chunks.push({ speaker: curr, text: buf });
            buf = '';
          }
          curr = s;
          buf += line.replace(/^.*?[:：]\s*/, ' ') + ' ';
        } else {
          buf += line + ' ';
        }
      }
      if (curr && buf) chunks.push({ speaker: curr, text: buf });

      /* ---------- 3) TTS per chunk ---------- */
      const segs: { url: string; speaker: 'host' | 'guest'; text: string }[] = [];
      for (const chunk of chunks) {
        const voice = chunk.speaker === 'host' ? 'alloy' : 'nova'; // male vs female
        const speechRes = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
          },
          body: JSON.stringify({ model: 'tts-1', voice, input: chunk.text, format: 'mp3' }),
        });
        if (!speechRes.ok) throw new Error(`TTS API → ${speechRes.status} ${speechRes.statusText}`);
        const bufArr = await speechRes.arrayBuffer();
        segs.push({ url: URL.createObjectURL(new Blob([bufArr], { type: 'audio/mpeg' })), speaker: chunk.speaker, text: chunk.text });
      }
      setSegments(segs);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  /** Sequential playback helpers */
  const playCurrent = () => {
    if (!audioRef.current || segments.length === 0) return;
    audioRef.current.src = segments[currentIdx].url;
    audioRef.current.play();
  };
  const pauseCurrent = () => audioRef.current?.pause();
  const skipNext = () => {
    if (currentIdx + 1 < segments.length) setCurrentIdx((i) => i + 1);
  };
  useEffect(() => {
    if (!audioRef.current) return;
    const onEnded = () => {
      if (currentIdx + 1 < segments.length) setCurrentIdx((i) => i + 1);
    };
    audioRef.current.addEventListener('ended', onEnded);
    return () => audioRef.current?.removeEventListener('ended', onEnded);
  }, [currentIdx, segments.length]);
  useEffect(() => {
    if (segments.length && audioRef.current) {
      audioRef.current.src = segments[currentIdx].url;
      audioRef.current.play();
    }
  }, [currentIdx, segments]);

  /* ---------------- UI ---------------- */
  return (
    <main className="min-h-screen flex flex-col items-center justify-start p-4 gap-6 bg-gradient-to-b from-slate-50 to-slate-100">
      <Card className="w-full max-w-2xl shadow-xl rounded-2xl">
        <CardContent className="flex flex-col gap-4 p-6">
          <h1 className="text-2xl font-bold mb-2">🎙️ AI Podcast Generator</h1>

          {/* API key */}
          <label className="flex flex-col gap-1">
            <span className="font-medium">OpenAI API Key</span>
            <Input type="password" placeholder="sk-..." value={apiKey} onChange={handleApiKeyChange} />
          </label>

          {/* Topic */}
          <label className="flex flex-col gap-1">
            <span className="font-medium">Podcast Topic / Prompt</span>
            <Input placeholder="The charm of classical music" value={topic} onChange={(e) => setTopic(e.target.value)} />
          </label>

          <Button onClick={generatePodcast} disabled={loading} className="self-start">
            {loading ? (
              <motion.div initial={{ rotate: 0 }} animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }}>
                <Loader2 className="w-4 h-4" />
              </motion.div>
            ) : (
              <>
                <Mic className="w-4 h-4 mr-2" /> Generate Podcast
              </>
            )}
          </Button>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          {transcript && (
            <Textarea className="h-64 mt-4" value={transcript} readOnly />
          )}

          {/* Playback controls */}
          {segments.length > 0 && (
            <div className="flex items-center gap-3 mt-4">
              <Button size="icon" onClick={playCurrent}>
                <Play className="w-4 h-4" />
              </Button>
              <Button size="icon" onClick={pauseCurrent}>
                <Pause className="w-4 h-4" />
              </Button>
              <Button size="icon" onClick={skipNext} disabled={currentIdx + 1 >= segments.length}>
                <SkipForward className="w-4 h-4" />
              </Button>
              <span className="text-sm">{currentIdx + 1}/{segments.length}</span>
              <audio ref={audioRef} hidden />
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
