'use client';

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Mic, Play, Pause, SkipForward, History } from "lucide-react";
import { motion } from 'framer-motion';
import { GoogleGenAI } from "@google/genai";

type PodcastSegment = { url: string; speaker: 'host' | 'guest'; text: string };

type StoredPodcast = {
  id: string;
  topic: string;
  transcript: string;
  segments: PodcastSegment[];
  createdAt: number;
};

/**
 * PodcastGenerator – client‑side component that:
 * 1. Persists the user‑provided Gemini API key in localStorage.
 * 2. Generates a host/guest transcript (labels "Host:" / "Guest:") via Gemini Pro 2.5 with thinking and web search.
 * 3. Splits the transcript into speaker chunks, then calls TTS once per chunk with
 *    different voices (male = "alloy" for host, female = "nova" for guest).
 * 4. Plays the resulting audio segments sequentially with minimal controls.
 * 5. Stores podcast history in localStorage and allows different playback speeds.
 */
export default function PodcastGenerator() {
  const [apiKey, setApiKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [topic, setTopic] = useState('');
  const [transcript, setTranscript] = useState('');
  const [segments, setSegments] = useState<PodcastSegment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showHistory, setShowHistory] = useState(false);
  const [podcastHistory, setPodcastHistory] = useState<StoredPodcast[]>([]);
  const [audioReady, setAudioReady] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const speedOptions = [0.5, 0.75, 1, 1.25, 1.5, 2];

  /** Load persisted keys and history once */
  useEffect(() => {
    const geminiKey = localStorage.getItem('gemini_api_key') ?? '';
    const openaiApiKey = localStorage.getItem('openai_api_key') ?? '';
    if (geminiKey) setApiKey(geminiKey);
    if (openaiApiKey) setOpenaiKey(openaiApiKey);
    
    loadPodcastHistory();
  }, []);

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const key = e.target.value.trim();
    setApiKey(key);
    localStorage.setItem('gemini_api_key', key);
  };

  const handleOpenaiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const key = e.target.value.trim();
    setOpenaiKey(key);
    localStorage.setItem('openai_api_key', key);
  };

  /** Load podcast history from localStorage */
  const loadPodcastHistory = () => {
    try {
      const stored = localStorage.getItem('podcast_history');
      if (stored) {
        const history = JSON.parse(stored) as StoredPodcast[];
        setPodcastHistory(history.sort((a, b) => b.createdAt - a.createdAt));
      }
    } catch (err) {
      console.error('Failed to load podcast history:', err);
    }
  };

  /** Save podcast to history */
  const savePodcastToHistory = (topic: string, transcript: string, segments: PodcastSegment[]) => {
    try {
      const newPodcast: StoredPodcast = {
        id: Date.now().toString(),
        topic,
        transcript,
        segments,
        createdAt: Date.now()
      };

      const existing = localStorage.getItem('podcast_history');
      const history = existing ? JSON.parse(existing) as StoredPodcast[] : [];
      history.unshift(newPodcast);
      
      // Keep only the last 10 podcasts
      const trimmed = history.slice(0, 10);
      localStorage.setItem('podcast_history', JSON.stringify(trimmed));
      setPodcastHistory(trimmed);
    } catch (err) {
      console.error('Failed to save podcast to history:', err);
    }
  };

  /** Load a podcast from history */
  const loadPodcastFromHistory = (podcast: StoredPodcast) => {
    setTopic(podcast.topic);
    setTranscript(podcast.transcript);
    setSegments(podcast.segments);
    setCurrentIdx(0);
    setAudioReady(false);
    setShowHistory(false);
  };

  /** Clear podcast history */
  const clearHistory = () => {
    localStorage.removeItem('podcast_history');
    setPodcastHistory([]);
  };

  /** Generate transcript → TTS segments */
  const generatePodcast = async () => {
    setError('');
    if (!apiKey) return setError('Please provide your Gemini API key.');
    if (!openaiKey) return setError('Please provide your OpenAI API key for TTS.');
    if (!topic) return setError('Please enter a topic.');

    setLoading(true);
    setTranscript('');
    setSegments([]);
    setCurrentIdx(0);
    setAudioReady(false);

    try {
      /* ---------- 1) Chat transcript using Gemini ---------- */
      const ai = new GoogleGenAI({ apiKey });

      // Configure grounding tool for web search
      const groundingTool = {
        googleSearch: {},
      };

      // Configure generation settings with thinking and web search
      const config = {
        tools: [groundingTool],
        thinkingConfig: {
          thinkingBudget: 30000, // Enable thinking
        },
      };

      const systemPrompt = [
        'You are a podcast script writer. Generate a lively, engaging podcast script',
        'with one host (labelled "Host:") and one guest (labelled "Guest:"). Host is a man, and the guest is a woman.',
        'The full script should run approximately 10 minutes when read aloud',
        '(around 1 200–1 500 English words, adjust as needed).',
        'Make the content highly creative and immersive: for history topics, invent a',
        'fictional eyewitness as the guest, who recounts events with twists and dramatic turns.',
        'Structure the conversation in 8–10 back-and-forth dialogue turns, each revealing',
        'new surprises or emotional beats to keep listeners hooked.',
        'The script should use the same language as the prompt language',
        '(except for the `Host:` and `Guest:` labels).',
        'For example, if the prompt is in Chinese, your script must be in Chinese too.',
        'Reply only with the script of the conversation between the host and the guest. No Music or other content.'
      ].join(' ');

      const response = await ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: `${systemPrompt}\n\nPodcast topic: ${topic}`,
        config,
      });
      
      const content = response.text || '';
      setTranscript(content);

      /* ---------- 2) Split by speaker ---------- */
      const lines = content.split(/\n+/).filter(Boolean);
      type Chunk = { speaker: 'host' | 'guest'; text: string };
      const chunks: Chunk[] = [];
      let curr: 'host' | 'guest' | null = null;
      let buf = '';
      
      const who = (l: string): 'host' | 'guest' | null =>
        l.includes('Host:') ? 'host' : l.includes('Guest:') ? 'guest' : null;

      for (const line of lines) {
        const s = who(line);
        if (s !== null) {
          if (curr && s !== curr) {
            chunks.push({ speaker: curr, text: buf });
            buf = '';
          }
          curr = s;
          buf += line.replace(/^.*?[:：]\s*/, ' ') + ' ';
        } else if (curr) {
          // Only add content to buffer if we're already inside a speaker section
          buf += line + ' ';
        }
        // Skip lines that don't have Host: or Guest: and we're not in a speaker section
      }
      if (curr && buf) chunks.push({ speaker: curr, text: buf });

      /* ---------- 3) TTS per chunk ---------- */
      const segs: PodcastSegment[] = [];
      for (const chunk of chunks) {
        const voice = chunk.speaker === 'host' ? 'alloy' : 'nova'; // male vs female
        const speechRes = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${openaiKey}`,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
          },
          body: JSON.stringify({ 
            model: 'tts-1', 
            voice, 
            input: chunk.text, 
            format: 'mp3' 
          }),
        });
        
        if (!speechRes.ok) {
          throw new Error(`TTS API → ${speechRes.status} ${speechRes.statusText}`);
        }
        
        const bufArr = await speechRes.arrayBuffer();
        segs.push({ 
          url: URL.createObjectURL(new Blob([bufArr], { type: 'audio/mpeg' })), 
          speaker: chunk.speaker, 
          text: chunk.text 
        });
      }
      setSegments(segs);
      
      // Save to history
      savePodcastToHistory(topic, content, segs);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  /** Sequential playback helpers */
  const playCurrent = () => {
    if (!audioRef.current || segments.length === 0) return;
    
    const currentSegment = segments[currentIdx];
    if (!currentSegment) return;
    
    // Ensure audio source is set (important for iOS)
    if (audioRef.current.src !== currentSegment.url) {
      audioRef.current.src = currentSegment.url;
      audioRef.current.playbackRate = playbackSpeed;
    }
    
    // iOS Safari sometimes needs a fresh load for the first segment
    if (currentIdx === 0 && audioRef.current.readyState === 0) {
      audioRef.current.load();
    }
    
    console.log(`Playing segment ${currentIdx + 1}/${segments.length} (${currentSegment.speaker})`);
    
    audioRef.current.play().catch(error => {
      console.error(`Failed to play segment ${currentIdx + 1}:`, error);
      setError(`Failed to play audio segment ${currentIdx + 1}. Try tapping the play button again.`);
    });
  };
  
  const pauseCurrent = () => audioRef.current?.pause();
  
  const skipNext = () => {
    if (currentIdx + 1 < segments.length) setCurrentIdx((i) => i + 1);
  };

  /** Update playback speed */
  const changePlaybackSpeed = (speed: number) => {
    setPlaybackSpeed(speed);
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  };

  useEffect(() => {
    if (!audioRef.current) return;
    
    const audio = audioRef.current;
    
    const onEnded = () => {
      if (currentIdx + 1 < segments.length) setCurrentIdx((i) => i + 1);
    };
    
    const onCanPlay = () => {
      console.log('Audio can play - ready state:', audio.readyState);
      setAudioReady(true);
    };
    
    const onLoadStart = () => {
      console.log('Audio loading started');
      setAudioReady(false);
    };
    
    const onError = (e: Event) => {
      console.error('Audio error:', e);
      setError('Audio playback error occurred');
    };
    
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('loadstart', onLoadStart);
    audio.addEventListener('error', onError);
    
    return () => {
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('loadstart', onLoadStart);
      audio.removeEventListener('error', onError);
    };
  }, [currentIdx, segments.length]);

  useEffect(() => {
    if (segments.length && audioRef.current) {
      const currentSegment = segments[currentIdx];
      if (!currentSegment) return;
      
      // Set up the audio source and playback rate
      audioRef.current.src = currentSegment.url;
      audioRef.current.playbackRate = playbackSpeed;
      
      // iOS Safari requires user interaction to play audio
      // Don't auto-play the first segment, let user click play button
      if (currentIdx === 0) {
        // Just load the first segment, don't auto-play
        audioRef.current.load();
        console.log('First segment loaded, waiting for user interaction (iOS compatibility)');
      } else {
        // Auto-play subsequent segments (this should work as it's triggered by ended event)
        audioRef.current.play().catch(error => {
          console.error(`Failed to auto-play segment ${currentIdx + 1}:`, error);
        });
      }
    }
  }, [currentIdx, segments, playbackSpeed]);

  /* ---------------- UI ---------------- */
  return (
    <main className="min-h-screen flex flex-col items-center justify-start p-4 gap-6 bg-gradient-to-b from-slate-50 to-slate-100">
      <Card className="w-full max-w-2xl shadow-xl rounded-2xl">
        <CardContent className="flex flex-col gap-4 p-6">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-2xl font-bold">🎙️ AI Podcast Generator</h1>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-2"
            >
              <History className="w-4 h-4" />
              History
            </Button>
          </div>

          {/* History Panel */}
          {showHistory && (
            <Card className="border-2 border-dashed border-gray-300">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold">Podcast History</h3>
                  {podcastHistory.length > 0 && (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={clearHistory}
                    >
                      Clear All
                    </Button>
                  )}
                </div>
                {podcastHistory.length === 0 ? (
                  <p className="text-gray-500 text-sm">No podcasts generated yet.</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {podcastHistory.map((podcast) => (
                      <div 
                        key={podcast.id}
                        className="p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors"
                        onClick={() => loadPodcastFromHistory(podcast)}
                      >
                        <div className="font-medium text-sm">{podcast.topic}</div>
                        <div className="text-xs text-gray-500">
                          {new Date(podcast.createdAt).toLocaleDateString()} • {podcast.segments.length} segments
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* API keys */}
          <div className="space-y-4">
            <label className="flex flex-col gap-1">
              <span className="font-medium">Gemini API Key</span>
              <Input 
                type="password" 
                placeholder="AIza..." 
                value={apiKey} 
                onChange={handleApiKeyChange} 
              />
            </label>
            
            <label className="flex flex-col gap-1">
              <span className="font-medium">OpenAI API Key (for TTS)</span>
              <Input 
                type="password" 
                placeholder="sk-..." 
                value={openaiKey} 
                onChange={handleOpenaiKeyChange} 
              />
            </label>
          </div>

          {/* Topic */}
          <label className="flex flex-col gap-1">
            <span className="font-medium">Podcast Topic / Prompt</span>
            <Input 
              placeholder="The charm of classical music" 
              value={topic} 
              onChange={(e) => setTopic(e.target.value)} 
            />
          </label>

          <Button 
            onClick={generatePodcast} 
            disabled={loading} 
            className="self-start"
          >
            {loading ? (
              <motion.div 
                initial={{ rotate: 0 }} 
                animate={{ rotate: 360 }} 
                transition={{ repeat: Infinity, duration: 1 }}
              >
                <Loader2 className="w-4 h-4" />
              </motion.div>
            ) : (
              <>
                <Mic className="w-4 h-4 mr-2" /> Generate Podcast (Gemini Pro 2.5)
              </>
            )}
          </Button>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          {transcript && (
            <Textarea 
              className="h-64 mt-4" 
              value={transcript} 
              readOnly 
            />
          )}

          {/* Playback controls */}
          {segments.length > 0 && (
            <div className="space-y-4 mt-4">
              {/* Main playback controls */}
              <div className="flex items-center gap-3">
                <Button 
                  size="icon" 
                  onClick={playCurrent}
                  disabled={!audioReady && currentIdx === 0}
                  className={!audioReady && currentIdx === 0 ? 'opacity-50' : ''}
                >
                  <Play className="w-4 h-4" />
                </Button>
                <Button size="icon" onClick={pauseCurrent}>
                  <Pause className="w-4 h-4" />
                </Button>
                <Button 
                  size="icon" 
                  onClick={skipNext} 
                  disabled={currentIdx + 1 >= segments.length}
                >
                  <SkipForward className="w-4 h-4" />
                </Button>
                <span className="text-sm">{currentIdx + 1}/{segments.length}</span>
                {!audioReady && currentIdx === 0 && (
                  <span className="text-xs text-gray-500">Loading audio...</span>
                )}
              </div>

              {/* Speed controls */}
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Speed:</span>
                <div className="flex gap-1">
                  {speedOptions.map((speed) => (
                    <Button
                      key={speed}
                      variant={playbackSpeed === speed ? "default" : "outline"}
                      size="sm"
                      onClick={() => changePlaybackSpeed(speed)}
                      className="px-3 py-1 text-xs"
                    >
                      {speed}x
                    </Button>
                  ))}
                </div>
              </div>

              {/* Current segment info */}
              {segments[currentIdx] && (
                <div className="p-3 bg-gray-50 rounded-lg">
                  <div className="text-xs text-gray-500 mb-1">
                    {segments[currentIdx].speaker === 'host' ? '🎙️ Host' : '👤 Guest'}
                  </div>
                  <div className="text-sm">
                    {segments[currentIdx].text.slice(0, 150)}...
                  </div>
                </div>
              )}

              <audio ref={audioRef} hidden />
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
