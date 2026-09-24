# 🎤 Speech API Testing Guide

## 🚀 Quick Start

Your new test page is ready at: **http://localhost:3001/test-speech**

This page allows you to:

- ✅ Test Text-to-Speech (TTS) independently
- ✅ Test Speech-to-Text (STT) independently
- ✅ Run combined tests (speak then listen)
- ✅ See real-time logs of all events
- ✅ Check browser support status

---

## 🔧 Common Issues & Solutions

### 1. **Can't Hear Anything (TTS Not Working)**

#### Check Browser Support:

- ✅ **Chrome/Edge**: Full support
- ⚠️ **Firefox**: Limited support
- ⚠️ **Safari**: Partial support (may have issues)

#### Solutions:

```javascript
// Check if TTS is supported
if (!window.speechSynthesis) {
  console.error("TTS not supported in this browser");
}

// Ensure volume is not muted
const utterance = new SpeechSynthesisUtterance(text);
utterance.volume = 1.0; // 0.0 to 1.0

// Check if voices are loaded
const voices = window.speechSynthesis.getVoices();
console.log("Available voices:", voices.length);
```

#### Quick Fixes:

1. **Check system volume** - Make sure your speakers/headphones work
2. **Try different browser** - Chrome is most reliable
3. **Reload voices** - Click "Speak Text" button multiple times
4. **Check browser console** - Look for errors (F12 → Console)

---

### 2. **Microphone Not Listening (STT Not Working)**

#### Check Microphone Permissions:

1. Click the 🔒 lock icon in browser address bar
2. Ensure microphone is set to "Allow"
3. Reload the page if you just granted permission

#### Browser Issues:

- ⚠️ **HTTPS Required**: Web Speech API requires HTTPS in production (localhost works)
- ⚠️ **Firefox**: Very limited STT support
- ⚠️ **Safari**: Limited support, may not work reliably

#### Solutions:

```javascript
// Check if STT is supported
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SpeechRecognition) {
  console.error("STT not supported in this browser");
}

// Test microphone access
navigator.mediaDevices
  .getUserMedia({ audio: true })
  .then(() => console.log("Microphone access granted"))
  .catch((err) => console.error("Microphone access denied:", err));
```

#### Quick Fixes:

1. **Grant microphone permission** when prompted
2. **Check microphone hardware** - Test in another app
3. **Use Chrome or Edge** - Best browser support
4. **Reload page** after granting permissions
5. **Check for "not-allowed" error** in logs - means permission denied

---

### 3. **STT Stops Immediately**

This usually happens when the browser doesn't receive audio input.

#### Common Causes:

- No microphone connected
- Microphone permission denied
- Wrong microphone selected in browser settings
- Microphone being used by another application

#### Fix:

```bash
# On Linux, check microphone:
pactl list sources short

# Test microphone with:
arecord -d 5 test.wav && aplay test.wav
```

---

### 4. **Silence Detection Not Working**

The default silence timeout is **3 seconds**. If you speak continuously, it won't trigger.

#### Adjust in the hook:

```typescript
useSpeechToText({
  silenceTimeoutMs: 2000, // Reduce to 2 seconds
  onSilenceTimeout: (text) => {
    console.log("User stopped speaking:", text);
  },
});
```

---

## 🧪 Testing Workflow

### Step 1: Check Support

1. Go to http://localhost:3001/test-speech
2. Look at the two status cards at top
3. Both should show "✅ Supported"

### Step 2: Test TTS (Text-to-Speech)

1. Type or keep default text in the text area
2. Click "▶️ Speak Text"
3. You should hear the text spoken out loud
4. Check logs for "✅ TTS completed successfully"

### Step 3: Test STT (Speech-to-Text)

1. Click "🎙️ Start Listening"
2. Grant microphone permission if prompted
3. Speak clearly into your microphone
4. You should see:
   - Yellow "Interim" text appearing as you speak
   - White "Current transcript" updating
   - Green "Final result" after 3 seconds of silence
5. Check logs for transcript updates

### Step 4: Combined Test

1. Click "🔄 Run Combined Test"
2. The system will:
   - Speak the text (TTS)
   - Automatically start listening (STT)
   - Try to recognize its own speech
3. This tests if both systems work together

---

## 📋 Debugging Checklist

When STT/TTS isn't working, check these in order:

- [ ] Browser is Chrome or Edge (not Firefox/Safari)
- [ ] Page is loaded over HTTPS or localhost
- [ ] Microphone permission is granted (check browser URL bar)
- [ ] System volume is not muted
- [ ] Microphone hardware is working (test in other apps)
- [ ] No other app is using the microphone
- [ ] Browser console shows no errors (F12)
- [ ] Voices are loaded (check TTS section shows voice count)
- [ ] `navigator.mediaDevices` exists (open console and type it)
- [ ] Page was not opened in incognito/private mode (may block media)

---

## 🔍 Browser Console Commands

Open browser console (F12) and try these:

### Check TTS Support:

```javascript
console.log("TTS Supported:", !!window.speechSynthesis);
console.log("Voices:", window.speechSynthesis.getVoices());
```

### Check STT Support:

```javascript
const STT = window.SpeechRecognition || window.webkitSpeechRecognition;
console.log("STT Supported:", !!STT);
```

### Check Microphone:

```javascript
navigator.mediaDevices
  .getUserMedia({ audio: true })
  .then(() => console.log("✅ Microphone access granted"))
  .catch((err) => console.error("❌ Microphone error:", err));
```

### Test Quick TTS:

```javascript
const utterance = new SpeechSynthesisUtterance("Hello, this is a test");
window.speechSynthesis.speak(utterance);
```

---

## 🌐 Browser Compatibility

| Feature              | Chrome  | Edge    | Firefox         | Safari     |
| -------------------- | ------- | ------- | --------------- | ---------- |
| TTS (Text-to-Speech) | ✅ Full | ✅ Full | ⚠️ Limited      | ⚠️ Limited |
| STT (Speech-to-Text) | ✅ Full | ✅ Full | ❌ Very Limited | ⚠️ Limited |
| Interim Results      | ✅ Yes  | ✅ Yes  | ❌ No           | ⚠️ Partial |
| Voice Selection      | ✅ Yes  | ✅ Yes  | ⚠️ Limited      | ⚠️ Limited |

**Recommendation**: Use Chrome or Edge for best results.

---

## 📱 Mobile Testing

Web Speech API works on mobile but has limitations:

### Android Chrome:

- ✅ TTS works well
- ✅ STT works well
- ⚠️ Requires user interaction to start

### iOS Safari:

- ⚠️ TTS limited support
- ❌ STT very limited/unreliable
- ⚠️ May not work in standalone PWA mode

---

## 🔧 Environment Variables

Make sure you have these in your `.env.local`:

```bash
# For AI responses (used in interview page)
NEXT_PUBLIC_GROQ_API_KEY=your_groq_key
NEXT_PUBLIC_APPWRITE_ENDPOINT=your_appwrite_endpoint
NEXT_PUBLIC_APPWRITE_PROJECT_ID=your_project_id
```

**Note**: The test page works independently and doesn't need API keys.

---

## 🎯 Project Structure

```
hooks/
  ├── useSpeechToText.ts    # STT Hook (Web Speech API)
  └── useTextToSpeech.ts    # TTS Hook (Web Speech API)

app/
  ├── test-speech/          # NEW: Testing page
  │   └── page.tsx
  └── interview/[id]/       # Main interview page
      └── page.tsx
```

---

## 🐛 Known Issues

### Issue 1: Voices Not Loading

**Symptom**: TTS works but uses robotic voice  
**Fix**: Reload page or wait a few seconds for voices to load

### Issue 2: "not-allowed" Error

**Symptom**: STT immediately shows error  
**Fix**: Grant microphone permission in browser settings

### Issue 3: STT Stops After Few Seconds

**Symptom**: Listening stops automatically  
**Fix**: This is the silence detection feature working. Keep speaking or adjust `silenceTimeoutMs`

### Issue 4: Can't Hear on Linux

**Symptom**: TTS seems to work but no sound  
**Fix**: Check PulseAudio/PipeWire mixer, ensure correct output device

---

## 📞 Getting Help

If issues persist:

1. Check the **Activity Logs** on the test page
2. Open browser console (F12) and look for errors
3. Try the test page in a different browser
4. Ensure microphone works in other applications
5. Check browser microphone permissions in settings

---

## ✅ Success Criteria

Your speech APIs are working correctly if:

1. ✅ Both status cards show "Supported"
2. ✅ You can hear the test text when clicking "Speak Text"
3. ✅ You see real-time transcription when speaking
4. ✅ Final result appears after 3 seconds of silence
5. ✅ Logs show no errors
6. ✅ Combined test works end-to-end

---

**Happy Testing! 🎉**

For more details, check:

- `/hooks/useSpeechToText.ts` - STT implementation
- `/hooks/useTextToSpeech.ts` - TTS implementation
- `/app/interview/[id]/page.tsx` - Main interview page using both hooks
