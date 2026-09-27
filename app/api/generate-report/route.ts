import { NextRequest, NextResponse } from 'next/server';
import { generateText } from 'ai';
import { groq } from '@/lib/groq';
import dbConnect from '@/lib/mongodb';
import InterviewSession, { IInterviewMetrics } from '@/lib/models/InterviewSession';
import InterviewReport from '@/lib/models/InterviewReport';
import Interview from '@/lib/models/Interview';
import { mentors } from '@/components/mentors';
import { getReportGenerationPrompt } from '@/lib/promptHelper';
import { findOwned, getRequester } from '@/lib/requester';

async function generateUnifiedReport(
  messages: Array<{ sender: string; text: string }>,
  metrics: IInterviewMetrics,
  jobTitle: string,
  userSummary: string,
  jobSummary: string
) {
  const conversationText = messages
    .filter(msg => msg.sender !== 'system')
    .map(msg => `${msg.sender.toUpperCase()}: ${msg.text}`)
    .join('\n\n');

  const prompt = getReportGenerationPrompt({
    jobTitle,
    userSummary,
    jobSummary,
    speakingTime: Math.round(Number(metrics.userSpeakingTime ?? 0) / 1000),
    wordsPerMinute: Number(metrics.wordsPerMinute ?? 0),
    fillerWordsCount: Number(metrics.fillerWordsCount ?? 0),
    confidenceScore: Math.round(Number(metrics.confidenceScore ?? 0) * 100),
    conversationText
  });

  try {
    let result;
    const modelsToTry = ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"];
    let lastError = null;

    for (const modelName of modelsToTry) {
      try {
        console.log(`Attempting unified report generation with ${modelName}...`);
        result = await generateText({
          model: groq(modelName),
          prompt,
          temperature: 0.3,
          maxRetries: 1,
        });
        console.log(`Successfully generated report with ${modelName}`);
        break; // Success
      } catch (e) {
        console.warn(`Model ${modelName} failed. Evaluating next fallback...`);
        lastError = e;
      }
    }

    if (!result) {
      throw lastError || new Error("All generative AI models failed during report generation");
    }

    const cleanedText = result.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsedReport = JSON.parse(cleanedText);
    
    // Validate and fix specificFeedback array
    if (parsedReport.detailedFeedback?.specificFeedback) {
      parsedReport.detailedFeedback.specificFeedback = parsedReport.detailedFeedback.specificFeedback.filter(
        (item: { question?: string; userResponse?: string; feedback?: string }) => 
          item.question && item.userResponse && item.feedback
      );
    }
    
    return parsedReport;
  } catch (error) {
    console.error('Error in unified report generation (fallback triggered):', error);
    
    // Fallback: calibrated heuristic scoring — brutal, not generous
    const confidenceScore = Number(metrics.confidenceScore ?? 0.5);
    const fillerWords = Number(metrics.fillerWordsCount ?? 0);
    const speakingTime = Number(metrics.userSpeakingTime ?? 0) / 1000; // seconds
    const wpm = Number(metrics.wordsPerMinute ?? 0);

    // Penalize short sessions hard
    const effortPenalty = speakingTime < 60 ? 15 : speakingTime < 120 ? 8 : 0;

    // Communication: filler words tank this directly
    const commBase = fillerWords > 15 ? 28 : fillerWords > 10 ? 38 : fillerWords > 5 ? 48 : fillerWords > 2 ? 58 : 65;
    const communicationScore = Math.max(10, commBase - effortPenalty);

    // Confidence from metrics — no free points
    const confidenceScorePercent = Math.max(15, Math.round(confidenceScore * 70)); // cap at 70 from metrics alone

    // WPM score — penalize too fast or too slow
    const wpmScore = wpm === 0 ? 20 : wpm < 80 ? 32 : wpm > 200 ? 38 : wpm >= 130 && wpm <= 160 ? 62 : 48;
    const problemSolvingScore = Math.max(15, wpmScore - effortPenalty);

    // Reconstruct QA pairs
    const specificFeedback: unknown[] = [];
    let currentQuestion = "";
    for (const msg of messages) {
      if (msg.sender === "interviewer") {
        currentQuestion = msg.text;
      } else if (msg.sender === "user" && currentQuestion) {
        const wordCount = msg.text.trim().split(/\s+/).length;
        // Score by word count as proxy for depth — no content analysis available in fallback
        const qaScore = wordCount < 10 ? 20
          : wordCount < 25 ? 32
          : wordCount < 50 ? 42
          : wordCount < 100 ? 52
          : 58;
        specificFeedback.push({
          question: currentQuestion,
          userResponse: msg.text,
          feedback: `AI deep analysis unavailable (fallback mode). Based on response length (${wordCount} words): ${
            wordCount < 25
              ? 'Answer is too brief to demonstrate competency. A complete answer requires structured reasoning, a concrete example, and a result — none of which are present here.'
              : wordCount < 50
              ? 'Partial answer. Length suggests some attempt at structure but likely missing specific examples, metrics, or a clear conclusion.'
              : 'Moderate length. Without AI analysis, depth and relevance cannot be confirmed. Rerun report when AI is available for accurate scoring.'
          }`,
          score: Math.max(15, qaScore - effortPenalty),
          suggestions: [
            "Structure every answer: Situation → Task → Action → Result",
            "Add one specific metric or outcome to every answer",
            `Current answer is ${wordCount} words — aim for 80–150 words per answer`
          ]
        });
        currentQuestion = "";
      }
    }

    const qaScores = (specificFeedback as Array<{ score: number }>).map(f => f.score);
    const qaAvg = qaScores.length > 0 ? Math.round(qaScores.reduce((a, b) => a + b, 0) / qaScores.length) : 25;
    // Hard cap: 1 answer = max 45, 2 answers = max 55, otherwise average-driven
    const answerCap = qaScores.length <= 1 ? 45 : qaScores.length === 2 ? 55 : 75;
    const overallScore = Math.min(answerCap, Math.round((qaAvg + communicationScore + confidenceScorePercent) / 3));

    return {
      performanceAnalysis: {
        communicationSkills: {
          score: communicationScore,
          strengths: communicationScore >= 55 ? ["Filler word usage within acceptable range"] : [],
          improvements: [
            fillerWords > 5 ? `${fillerWords} filler words detected — this signals nervous speaking habits to interviewers` : "Improve precision and executive vocabulary",
            speakingTime < 60 ? "Total speaking time was under 60 seconds — not enough content to evaluate fairly" : "Work on answer structure and signposting",
          ],
          feedback: `Fallback mode — AI semantic analysis unavailable. Metrics: ${fillerWords} filler words, ${Math.round(speakingTime)}s speaking time, ${Math.round(wpm)} WPM. ${effortPenalty > 0 ? `Effort penalty of -${effortPenalty} applied for insufficient speaking time.` : ''}`
        },
        technicalKnowledge: {
          score: Math.max(15, qaAvg - 5),
          strengths: qaAvg >= 55 ? ["Responses suggest some domain familiarity"] : [],
          improvements: [
            "Use STAR method — no evidence of structured answers in this session",
            "Add quantifiable outcomes: percentages, timelines, dollar values",
            "Answers must demonstrate domain depth, not surface-level awareness"
          ],
          feedback: "AI fallback: technical depth cannot be assessed without semantic analysis. Score derived from answer length and speech metrics only. Actual technical score may be significantly lower."
        },
        problemSolving: {
          score: problemSolvingScore,
          strengths: problemSolvingScore >= 55 ? ["Response cadence indicates deliberate thinking"] : [],
          improvements: [
            wpm < 100 ? "Speaking pace is too slow — may signal lack of preparation or uncertainty" : wpm > 180 ? "Pace too fast — rushing through answers signals anxiety, not confidence" : "Improve logical flow and answer completion",
            "Every answer must end with a clear result or decision — not just a description of actions"
          ],
          feedback: `Speech rate: ${Math.round(wpm)} WPM. Optimal range is 130–160 WPM for interview settings. ${wpm < 100 || wpm > 180 ? 'Current pace is outside the effective range.' : 'Pace is acceptable.'}`
        },
        confidence: {
          score: confidenceScorePercent,
          analysis: `Confidence index from speech metrics: ${confidenceScorePercent}%. ${confidenceScorePercent < 40 ? 'Vocal patterns indicate high uncertainty. Candidate hesitated frequently.' : confidenceScorePercent < 60 ? 'Moderate confidence. Inconsistent assertiveness detected.' : 'Acceptable confidence baseline — must be validated with content quality.'}`,
          recommendations: [
            "Prepare 5 core stories using STAR before any interview",
            "Record yourself answering questions — identify hesitation patterns",
            "Slow down and breathe — rushing signals anxiety, not competence"
          ]
        },
        bodyLanguage: {
          score: 50,
          observations: ["Visual analysis unavailable in fallback mode"],
          recommendations: ["Maintain direct eye contact with camera", "Keep posture upright — slouching signals low confidence", "Minimize hand-to-face movements"]
        }
      },
      detailedFeedback: {
        overallScore,
        summary: `FALLBACK REPORT — AI model unavailable; scores derived from speech metrics and answer length only. Overall: ${overallScore}/100. ${overallScore < 40 ? 'This performance is significantly below the bar for the target role. The candidate would not advance past initial screening.' : overallScore < 55 ? 'Below the hiring bar. Structural improvements to answer quality are required before the next attempt.' : 'Marginally passable based on metrics alone — content quality must be confirmed with a full AI analysis.'}`,
        keyStrengths: qaAvg >= 52
          ? ["Attempted to answer questions with some substance"]
          : ["None identified at this performance level — insufficient data from this session"],
        areasForImprovement: [
          `Answer depth is the primary failure — ${qaScores.length} answer(s) detected, average score ${qaAvg}/100`,
          fillerWords > 5 ? `${fillerWords} filler words undermine credibility — eliminate 'um', 'uh', 'like', 'you know'` : "Sharpen vocabulary — avoid vague qualifiers",
          speakingTime < 90 ? "Session too short — more complete answers are required to demonstrate competency" : "Improve STAR structure in every response",
          "No quantifiable results detected in any answer — metrics and outcomes are mandatory at this level"
        ],
        behavioralInsights: {
          pauseAnalysis: `Response latency data suggests ${wpm < 100 ? 'significant hesitation — candidate struggled to formulate answers quickly' : 'acceptable cognitive processing speed'}.`,
          speechPaceAnalysis: `${Math.round(wpm)} WPM detected. ${wpm >= 130 && wpm <= 160 ? 'Pace is within the professional range.' : wpm < 130 ? 'Speaking too slowly — sounds uncertain and unprepared.' : 'Speaking too fast — interviewer cannot absorb content at this rate.'}`,
          confidenceAnalysis: `Confidence index: ${confidenceScorePercent}%. ${confidenceScorePercent < 50 ? 'Below threshold. Candidate likely under-prepared or experiencing high interview anxiety.' : 'Moderate. Must be paired with strong content to be convincing.'}`,
          emotionalStateAnalysis: "Emotional state cannot be accurately assessed in fallback mode. Run with ML sidecar active for full biometric analysis."
        },
        recommendations: {
          immediate: [
            "Re-do this interview immediately with more complete, structured answers",
            `Your answers averaged ${qaAvg}/100 — review what a ${qaAvg < 40 ? 'failing' : 'below-average'} answer looks like vs. a passing one`,
            "Write out 3 full STAR answers for this role before your next attempt"
          ],
          shortTerm: [
            "Practice answering interview questions aloud — not in your head",
            "Eliminate all filler words: record yourself, count them, drop to zero",
            "Research the role requirements and map your experience to each one explicitly"
          ],
          longTerm: [
            "Build a library of 10 core career stories that map to common competency questions",
            "Do weekly mock interviews — treat each one as a real interview",
            "Work on executive presence: pacing, vocabulary, and assertive framing of your experience"
          ]
        },
        specificFeedback: specificFeedback.length > 0 ? specificFeedback : [{
          question: "General Assessment",
          userResponse: "No answers detected in transcript",
          feedback: "No candidate responses were captured. This scores 0. Either the microphone was not active, the session was too short, or the transcript was malformed. A session with no answers cannot be evaluated.",
          score: 0,
          suggestions: ["Ensure microphone is working before starting", "Speak clearly and completely into your microphone", "Answer every question — silence is an automatic 0"]
        }]
      }
    };
  }
}

export async function POST(req: NextRequest) {
  try {
    const requester = await getRequester(req);
    if (!requester) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { interviewId, faceAnalytics } = await req.json().catch(() => ({}));

    if (!interviewId) {
      return NextResponse.json(
        { error: 'Interview ID is required' },
        { status: 400 }
      );
    }

    await dbConnect();

    const interview = await findOwned(Interview, interviewId, requester);

    if (!interview) {
      return NextResponse.json(
        { error: 'Interview not found' },
        { status: 404 }
      );
    }

    const existingReport = await InterviewReport.findOne({ interviewId: String(interview._id) });
    if (existingReport) {
      return NextResponse.json({
        success: true,
        report: existingReport,
        message: 'Report already exists'
      });
    }

    // The session is taken from the interview, never from the client.
    const session = interview.sessionId
      ? await InterviewSession.findById(interview.sessionId)
      : null;

    if (!session) {
      return NextResponse.json(
        { error: 'No session found for this interview' },
        { status: 404 }
      );
    }

    const mentor = mentors.find(m => m.id === interview.mentorId);
    const mentorName = mentor ? mentor.name : 'AI Interviewer';

    // 1. Generate Unified Report using Groq
    const aiAnalysis = await generateUnifiedReport(
      session.messages,
      session.metrics as IInterviewMetrics,
      interview.jobTitle,
      interview.userSummary,
      interview.jobSummary
    );

    // 2. Map QA specificFeedback to include unique IDs
    let qIdCounter = 1;
    const mappedSpecificFeedback = aiAnalysis.detailedFeedback.specificFeedback.map((fb: Record<string, unknown>) => ({
      ...fb,
      questionId: `q${qIdCounter++}`
    }));

    aiAnalysis.detailedFeedback.specificFeedback = mappedSpecificFeedback;

    // 3. Save to database
    const report = new InterviewReport({
      interviewId: String(interview._id),
      sessionId: String(session._id),
      userId: interview.userId,
      guestId: interview.guestId,
      jobTitle: interview.jobTitle,
      mentorName,
      performanceAnalysis: aiAnalysis.performanceAnalysis,
      detailedFeedback: aiAnalysis.detailedFeedback,
      ...(faceAnalytics ? { faceAnalytics } : {}),
      interviewDuration: session.metrics.totalDuration || 0,
      generatedAt: new Date(),
      reportVersion: '3.0',
    });

    await report.save();

    await Promise.all([
      Interview.findByIdAndUpdate(interview._id, {
        reportId: report._id,
        status: 'completed'
      }),
      InterviewSession.findByIdAndUpdate(session._id, {
        status: 'completed'
      })
    ]);

    return NextResponse.json({ success: true, report });
  } catch (error) {
    console.error('Error generating report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report' },
      { status: 500 }
    );
  }
}
