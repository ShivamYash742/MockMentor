#!/bin/bash

# Speech API Diagnostic Script
# Run this to check if your environment is properly set up for Web Speech API

echo "🔍 MockMentor Speech API Diagnostics"
echo "===================================="
echo ""

# Check if dev server is running
echo "1️⃣ Checking Development Server..."
if curl -s http://localhost:3001 > /dev/null 2>&1; then
    echo "   ✅ Dev server is running on port 3001"
    echo "   🌐 Main app: http://localhost:3001"
    echo "   🎤 Test page: http://localhost:3001/test-speech"
elif curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo "   ✅ Dev server is running on port 3000"
    echo "   🌐 Main app: http://localhost:3000"
    echo "   🎤 Test page: http://localhost:3000/test-speech"
else
    echo "   ❌ Dev server is NOT running"
    echo "   💡 Start it with: npm run dev"
fi
echo ""

# Check Node.js
echo "2️⃣ Checking Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    echo "   ✅ Node.js installed: $NODE_VERSION"
else
    echo "   ❌ Node.js not found"
fi
echo ""

# Check npm packages
echo "3️⃣ Checking Dependencies..."
if [ -d "node_modules" ]; then
    echo "   ✅ node_modules exists"
else
    echo "   ❌ node_modules missing - run: npm install"
fi
echo ""

# Check critical files
echo "4️⃣ Checking Speech Hook Files..."
if [ -f "hooks/useSpeechToText.ts" ]; then
    echo "   ✅ useSpeechToText.ts found"
else
    echo "   ❌ useSpeechToText.ts missing"
fi

if [ -f "hooks/useTextToSpeech.ts" ]; then
    echo "   ✅ useTextToSpeech.ts found"
else
    echo "   ❌ useTextToSpeech.ts missing"
fi

if [ -f "app/test-speech/page.tsx" ]; then
    echo "   ✅ Test page created"
else
    echo "   ❌ Test page missing"
fi
echo ""

# Check audio system (Linux only)
echo "5️⃣ Checking Audio System..."
if command -v pactl &> /dev/null; then
    echo "   ℹ️ PulseAudio/PipeWire detected"
    
    # Check for audio sinks (output devices)
    SINKS=$(pactl list short sinks 2>/dev/null | wc -l)
    if [ "$SINKS" -gt 0 ]; then
        echo "   ✅ Audio output devices found: $SINKS"
    else
        echo "   ⚠️ No audio output devices detected"
    fi
    
    # Check for audio sources (input devices - microphones)
    SOURCES=$(pactl list short sources 2>/dev/null | grep -v monitor | wc -l)
    if [ "$SOURCES" -gt 0 ]; then
        echo "   ✅ Microphone devices found: $SOURCES"
    else
        echo "   ⚠️ No microphone devices detected"
    fi
else
    echo "   ℹ️ PulseAudio/PipeWire not detected (might be using ALSA or other)"
fi
echo ""

# Check browser availability
echo "6️⃣ Checking Available Browsers..."
if command -v google-chrome &> /dev/null; then
    echo "   ✅ Google Chrome installed (Recommended)"
elif command -v chromium &> /dev/null; then
    echo "   ✅ Chromium installed (Recommended)"
elif command -v chromium-browser &> /dev/null; then
    echo "   ✅ Chromium Browser installed (Recommended)"
else
    echo "   ⚠️ Chrome/Chromium not found - Web Speech API works best in Chrome"
fi

if command -v firefox &> /dev/null; then
    echo "   ℹ️ Firefox installed (Limited STT support)"
fi
echo ""

# Environment check
echo "7️⃣ Checking Environment Variables..."
if [ -f ".env.local" ]; then
    echo "   ✅ .env.local exists"
    
    # Check for required keys (without revealing values)
    if grep -q "NEXT_PUBLIC_GROQ_API_KEY" .env.local; then
        echo "   ✅ GROQ_API_KEY configured"
    else
        echo "   ⚠️ GROQ_API_KEY not found in .env.local"
    fi
else
    echo "   ⚠️ .env.local not found (needed for AI features, not for test page)"
fi
echo ""

# Summary
echo "===================================="
echo "📊 Summary & Next Steps"
echo "===================================="
echo ""
echo "To test your Speech APIs:"
echo "1. Ensure dev server is running: npm run dev"
echo "2. Open Chrome browser"
echo "3. Navigate to: http://localhost:3001/test-speech"
echo "4. Grant microphone permission when prompted"
echo "5. Test TTS first, then STT"
echo ""
echo "For detailed troubleshooting, see:"
echo "📖 docs/SPEECH_API_TESTING.md"
echo ""
echo "Common issues:"
echo "• No sound: Check system volume and browser audio settings"
echo "• Microphone not working: Grant permission in browser (check URL bar lock icon)"
echo "• Use Chrome or Edge for best compatibility"
echo "• Ensure HTTPS or localhost (required for Web Speech API)"
echo ""
