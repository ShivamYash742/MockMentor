'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Camera, CameraOff, Loader2, ShieldCheck } from 'lucide-react';
import Navbar from '@/components/navbar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useFaceTracker } from '@/hooks/useFaceTracker';

const EMOTIONS = ['happy', 'neutral', 'surprised', 'sad', 'angry', 'fear', 'disgust'] as const;
const EMOJI: Record<string, string> = {
  happy: '😊', neutral: '😐', surprised: '😲', sad: '😢', angry: '😠', fear: '😨', disgust: '🤢',
};
const BAR: Record<string, string> = {
  happy: 'bg-green-500', neutral: 'bg-slate-400', surprised: 'bg-yellow-400', sad: 'bg-blue-400',
  angry: 'bg-red-500', fear: 'bg-purple-500', disgust: 'bg-orange-500',
};

// Public demo of the emotion model used in interviews. Everything runs in the browser:
// the camera feed never leaves the device.
export default function EmotionDemoPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const { lastFrame, emotionSource } = useFaceTracker(videoRef, cameraOn);

  const stopCamera = () => {
    (videoRef.current?.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  };
  useEffect(() => stopCamera, []); // release the camera when leaving the page

  const startCamera = async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setCameraOn(true);
    } catch (err) {
      setCameraError(
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Camera access was denied. Allow it in your browser settings to try the demo.'
          : 'Could not start the camera.',
      );
    }
  };

  const face = lastFrame?.face_detected ? lastFrame : null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="container mx-auto max-w-5xl px-4 py-10">
        <div className="mb-8 max-w-2xl">
          <h1 className="text-3xl font-bold tracking-tight">See the emotion model live</h1>
          <p className="mt-2 text-muted-foreground">
            This is the model that reads facial expressions during your mock interview. Turn on your camera and try a
            few expressions.
          </p>
          <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 shrink-0 text-green-600" />
            Runs entirely in your browser. Your video is never uploaded or saved.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-[3fr_2fr]">
          <Card className="relative aspect-video overflow-hidden bg-muted p-0">
            <video ref={videoRef} playsInline muted className="h-full w-full -scale-x-100 object-cover" />
            {!cameraOn && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                <Button size="lg" onClick={startCamera}>
                  <Camera className="mr-2 h-4 w-4" /> Turn on camera
                </Button>
                <p className="text-xs text-muted-foreground">First run downloads the model (about 44 MB).</p>
                {cameraError && <p role="alert" className="text-sm text-destructive">{cameraError}</p>}
              </div>
            )}
            {cameraOn && !face && (
              <div className="absolute inset-x-0 bottom-4 text-center">
                <span className="rounded-full bg-black/60 px-3 py-1 text-sm text-white">Looking for a face…</span>
              </div>
            )}
          </Card>

          <Card className="flex flex-col gap-5 p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">What the model sees</h2>
              {cameraOn && (
                <Badge variant={emotionSource === 'model' ? 'default' : 'secondary'} aria-live="polite">
                  {emotionSource === 'loading' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  {emotionSource === 'loading' ? 'Loading model' : emotionSource === 'model' ? 'Model running' : 'Basic mode'}
                </Badge>
              )}
            </div>

            <div className="text-center" aria-live="polite">
              <div className="text-6xl" aria-hidden>{face ? EMOJI[face.dominant] : '🙂'}</div>
              <div className="mt-2 text-xl font-semibold capitalize">{face ? face.dominant : '—'}</div>
            </div>

            <ul className="space-y-2">
              {EMOTIONS.map((e) => {
                const pct = Math.round((face?.emotions[e] ?? 0) * 100);
                return (
                  <li key={e} className="flex items-center gap-3 text-sm">
                    <span className="w-20 capitalize text-muted-foreground">{e}</span>
                    <div
                      className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
                      role="meter" aria-label={e} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
                    >
                      <div className={`h-full rounded-full transition-all duration-500 ${BAR[e]}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-10 text-right tabular-nums">{pct}%</span>
                  </li>
                );
              })}
            </ul>

            {emotionSource === 'heuristic' && cameraOn && (
              <p className="text-xs text-muted-foreground">
                The full model couldn&apos;t load on this connection, so a simpler estimate is shown instead.
              </p>
            )}

            <div className="mt-auto flex flex-wrap gap-2">
              {cameraOn && (
                <Button variant="outline" onClick={stopCamera}>
                  <CameraOff className="mr-2 h-4 w-4" /> Turn off camera
                </Button>
              )}
              <Button asChild>
                <Link href="/interview/new">Start a mock interview</Link>
              </Button>
            </div>
          </Card>
        </div>
      </main>
    </div>
  );
}
