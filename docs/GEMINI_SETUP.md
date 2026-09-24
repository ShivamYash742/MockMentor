# 🤖 Gemini AI Setup Guide for MockMentor

## 🚀 Quick Setup (5 minutes)

### Step 1: Get Your Free Gemini API Key

1. **Visit Google AI Studio**: Go to [https://aistudio.google.com/](https://aistudio.google.com/)
2. **Sign in** with your Google account
3. **Click "Get API Key"** in the top navigation
4. **Create API Key** → Choose "Create API key in new project" or select existing project
5. **Copy your API key** (starts with `AIza...`)

### Step 2: Add API Key to Your Project

1. **Open your `.env.local` file** in the MockMentor project root
2. **Add this line**:
   ```
   GEMINI_API_KEY=your_api_key_here
   ```
3. **Replace `your_api_key_here`** with your actual API key
4. **Save the file**

### Step 3: Test the Setup

1. **Start your development server**:
   ```bash
   npm run dev
   ```
2. **Take a mock interview**
3. **Complete the interview**
4. **Click "Generate Detailed Report"**
5. **View your AI-powered report!**

## 🎯 What You Get

✅ **Free AI Analysis** - No cost for reasonable usage  
✅ **Detailed Performance Scores** - Communication, technical skills, confidence  
✅ **Behavioral Insights** - Pause analysis, speech patterns, filler words  
✅ **Actionable Feedback** - Specific recommendations for improvement  
✅ **Professional Reports** - Beautiful UI with charts and metrics  

## 🔧 API Limits

- **Free Tier**: 15 requests per minute, 1,500 requests per day
- **Perfect for**: Personal use and testing
- **Upgrade**: Available if you need higher limits

## 🆘 Troubleshooting

**Issue**: "API key not found" error  
**Solution**: Make sure your `.env.local` file has `GEMINI_API_KEY=your_key`

**Issue**: "Rate limit exceeded"  
**Solution**: Wait a minute and try again (free tier limits)

**Issue**: Report generation fails  
**Solution**: Check your API key is valid and has quota remaining

## 🎉 You're All Set!

Your MockMentor platform now has AI-powered interview analysis using Google's Gemini AI - completely free! 

The system will analyze:
- Your conversation patterns
- Response timing and pauses  
- Communication effectiveness
- Technical knowledge demonstration
- Confidence levels and emotional tone

Enjoy your enhanced interview practice experience! 🚀
