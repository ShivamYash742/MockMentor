# 🎤 Quick Start: Test Your Speech API

## ✅ Your Test Page is Ready!

**URL**: http://localhost:3001/test-speech

---

## 🚀 How to Use

### 1️⃣ Open the Test Page
```bash
# Your dev server is already running on port 3001
# Open your browser and go to:
http://localhost:3001/test-speech
```

### 2️⃣ Test Text-to-Speech (TTS)
1. Look at the top-left status card - it should show "✅ Supported"
2. Keep the default text or type your own
3. Click **"▶️ Speak Text"**
4. You should hear the text spoken out loud
5. Check the logs at the bottom for confirmation

**If you can't hear anything:**
- Check your system volume
- Check browser isn't muted (right-click on browser tab)
- Try a different browser (Chrome/Edge recommended)
- Look for errors in the Activity Logs

### 3️⃣ Test Speech-to-Text (STT)
1. Look at the top-right status card - it should show "✅ Supported"
2. Click **"🎙️ Start Listening"**
3. Grant microphone permission when prompted (very important!)
4. Speak clearly into your microphone
5. You should see:
   - **Yellow text** appearing as you speak (interim results)
   - **White text** with your full transcript
   - **Green box** after 3 seconds of silence with final result

**If it's not listening:**
- Grant microphone permission (click lock icon in browser URL bar)
- Check microphone is working in other apps
- Use Chrome or Edge (Firefox has very limited support)
- Look for "not-allowed" error in the logs

### 4️⃣ Run Combined Test
Click **"🔄 Run Combined Test"** to:
1. Speak the text (TTS)
2. Automatically start listening (STT)
3. Try to recognize its own speech

---

## 🎯 What Each Section Does

### Support Status Cards (Top)
- Shows if TTS and STT are supported in your browser
- Shows number of voices available
- Shows current listening/speaking status

### Test Text-to-Speech
- Type any text you want to hear
- Click "Speak Text" to test audio output
- Use "Stop" to interrupt

### Test Speech-to-Text
- Click "Start Listening" to begin microphone capture
- Speak clearly
- Click "Stop Listening" to end capture manually
- Use "Clear" to reset the transcript

### Activity Logs
- Shows everything happening in real-time
- Timestamps for all events
- Error messages if something goes wrong
- Very helpful for debugging!

---

## ⚠️ Most Common Issues

### Issue: "Can't hear anything"
**Solution:**
1. Check system volume is not muted
2. Check browser tab audio (right-click tab → Unmute)
3. Try Chrome or Edge browser
4. Reload the page

### Issue: "Microphone not working"
**Solution:**
1. Click the 🔒 lock icon in browser address bar
2. Set Microphone to "Allow"
3. Reload the page
4. Try speaking again

### Issue: "Not supported in browser"
**Solution:**
1. Use Chrome or Edge (best support)
2. Avoid Firefox (limited STT support)
3. Avoid Safari (partial support)

### Issue: "Listening stops immediately"
**Solution:**
1. Check microphone permission is granted
2. Verify microphone is working in other apps
3. Check for "not-allowed" error in logs
4. Make sure no other app is using microphone

---

## 🔧 Quick Diagnostic

Run this command to check your setup:
```bash
./check-speech-api.sh
```

This will check:
- ✅ Dev server status
- ✅ Audio devices
- ✅ Required files
- ✅ Environment setup

---

## 📊 System Status (Current)

From the diagnostic, your system shows:
- ✅ Dev server running on port 3001
- ✅ All speech hooks present
- ✅ Test page created
- ✅ 2 audio output devices available
- ✅ 2 microphone devices detected
- ⚠️ Chrome not detected (Firefox has limited STT support)

**Recommendation**: Install Chrome or Chromium for best results.

---

## 🌐 Browser Recommendations

| Browser | TTS | STT | Recommendation |
|---------|-----|-----|----------------|
| Chrome | ✅ Excellent | ✅ Excellent | **Best choice** |
| Edge | ✅ Excellent | ✅ Excellent | **Best choice** |
| Firefox | ⚠️ Limited | ❌ Poor | Not recommended for STT |
| Safari | ⚠️ Limited | ⚠️ Limited | Not recommended |

---

## 📖 Full Documentation

For complete troubleshooting and advanced topics:
- **SPEECH_API_TESTING.md** - Complete testing guide
- **hooks/useSpeechToText.ts** - STT implementation
- **hooks/useTextToSpeech.ts** - TTS implementation

---

## 🎉 Success Checklist

Your speech API is working correctly if:
- [ ] Both status cards show "✅ Supported"
- [ ] You can hear the test text when clicking "Speak Text"
- [ ] You see yellow interim text as you speak
- [ ] You see white transcript text updating
- [ ] You see green final result after silence
- [ ] Activity logs show no errors
- [ ] Combined test works end-to-end

---

## 💡 Pro Tips

1. **Always grant microphone permission** - Without this, STT won't work
2. **Use Chrome or Edge** - Best compatibility with Web Speech API
3. **Speak clearly** - Better recognition accuracy
4. **Wait for silence detection** - Give it 3 seconds after speaking
5. **Check the logs** - They show exactly what's happening
6. **Test TTS first** - Easier to debug than STT

---

**Happy Testing! 🚀**

If you still have issues, check the Activity Logs and browser console (F12).
