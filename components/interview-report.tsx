'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp,
  Clock,
  Brain,
  Target,
  Award,
  AlertCircle,
  CheckCircle,
  ArrowRight,
  BarChart3,
  Calendar,
  MessageSquareQuote,
  Star,
  Eye
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

import Link from 'next/link';
import { guestHeaders } from '@/lib/utils';

interface InterviewReportProps {
  interviewId: string;
  onBack?: () => void;
}

interface PerformanceScore {
  score: number;
  strengths: string[];
  improvements: string[];
  feedback: string;
}

interface ReportData {
  _id: string;
  jobTitle: string;
  mentorName: string;
  interviewDuration: number;
  generatedAt: string;
  performanceAnalysis: {
    communicationSkills: PerformanceScore;
    technicalKnowledge: PerformanceScore;
    problemSolving: PerformanceScore;
    confidence: {
      score: number;
      analysis: string;
      recommendations: string[];
    };
    // Absent when the session had no camera data — rendered as "Not assessed" rather than
    // a score with nothing behind it.
    bodyLanguage?: {
      score: number;
      observations: string[];
      recommendations: string[];
    };
  };
  detailedFeedback: {
    overallScore: number;
    summary: string;
    keyStrengths: string[];
    areasForImprovement: string[];
    specificFeedback: Array<{
      questionId: string;
      question: string;
      userResponse: string;
      feedback: string;
      score: number;
      suggestions: string[];
    }>;
    behavioralInsights: {
      pauseAnalysis: string;
      speechPaceAnalysis: string;
      confidenceAnalysis: string;
      emotionalStateAnalysis: string;
    };
    recommendations: {
      immediate: string[];
      shortTerm: string[];
      longTerm: string[];
    };
  };
  // Sanitized client data: any field can be missing, so every one is optional and the page only
  // renders what's there (it used to crash on a summary without emotions_avg).
  faceAnalytics?: {
    duration_s?: number;
    frame_count?: number;
    emotions_avg?: Record<string, number>;
    dominant_histogram?: Record<string, number>;
    stress_avg?: number;
    stress_peak?: number;
    engagement_avg?: number;
    confidence_avg?: number;
    attention_avg?: number;
    attention_on_screen_frac?: number;
    total_blinks?: number;
    blinks_per_min_avg?: number;
  };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const NOT_GENERATED = 'Report not generated yet';

const InterviewReport: React.FC<InterviewReportProps> = ({ interviewId, onBack }) => {
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const face = report?.faceAnalytics;
  const emotionRows = face?.emotions_avg ? Object.entries(face.emotions_avg).filter(([, v]) => isNum(v)) : [];
  const signalRows = face
    ? [
        { label: 'Stress', value: face.stress_avg, pct: (v: number) => Math.min(100, Math.round(v * 10)), color: 'bg-rose-500' },
        { label: 'Engagement', value: face.engagement_avg, pct: (v: number) => Math.round(v * 100), color: 'bg-blue-500' },
        { label: 'Confidence', value: face.confidence_avg, pct: (v: number) => Math.round(v * 100), color: 'bg-emerald-500' },
        { label: 'Attention', value: face.attention_avg, pct: (v: number) => Math.round(v * 100), color: 'bg-indigo-500' },
      ].flatMap((row) => (isNum(row.value) ? [{ label: row.label, value: row.pct(row.value), color: row.color }] : []))
    : [];
  const statRows = face
    ? [
        { label: 'On-Screen Focus', value: face.attention_on_screen_frac, format: (v: number) => `${Math.round(v * 100)}%` },
        { label: 'Total Blinks', value: face.total_blinks, format: (v: number) => String(v) },
        { label: 'Blink Rate', value: face.blinks_per_min_avg, format: (v: number) => `${Math.round(v)}/min` },
        { label: 'Peak Stress', value: face.stress_peak, format: (v: number) => `${v.toFixed(1)} / 10` },
      ].flatMap((row) => (isNum(row.value) ? [{ label: row.label, value: row.format(row.value) }] : []))
    : [];
  const hasFaceData = emotionRows.length > 0 || signalRows.length > 0 || statRows.length > 0;

  const fetchReport = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/report/${interviewId}`, { headers: guestHeaders() });
      const data = await response.json();

      if (data.success) {
        setReport(data.report);
      } else {
        setError(data.error || 'Failed to fetch report');
      }
    } catch (err) {
      setError('Failed to fetch report');
      console.error('Error fetching report:', err);
    } finally {
      setLoading(false);
    }
  }, [interviewId]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-emerald-500';
    if (score >= 60) return 'text-amber-500';
    return 'text-rose-500';
  };

  const getScoreBg = (score: number) => {
    if (score >= 80) return 'bg-emerald-500/10 border-emerald-500/20';
    if (score >= 60) return 'bg-amber-500/10 border-amber-500/20';
    return 'bg-rose-500/10 border-rose-500/20';
  };

  const getProgressColor = (score: number) => {
    if (score >= 80) return 'bg-emerald-500';
    if (score >= 60) return 'bg-amber-500';
    return 'bg-rose-500';
  };

  const formatDuration = (milliseconds: number) => {
    const minutes = Math.floor(milliseconds / 60000);
    const seconds = Math.floor((milliseconds % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center space-y-6">
          <div className="relative w-20 h-20">
            <div className="absolute inset-0 border-t-2 border-primary border-solid rounded-full animate-spin"></div>
            <div className="absolute inset-2 border-r-2 border-blue-500 border-solid rounded-full animate-spin direction-reverse"></div>
            <div className="absolute inset-4 border-b-2 border-purple-500 border-solid rounded-full animate-spin"></div>
          </div>
          <p className="text-xl font-medium text-muted-foreground animate-pulse tracking-wide">
            Decrypting Candidate Data...
          </p>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="max-w-md w-full border-border/50 bg-background/50 backdrop-blur-sm text-center">
          <CardContent className="pt-8 pb-8 space-y-4">
            <AlertCircle className="h-16 w-16 text-rose-500 mx-auto opacity-80" />
            <h2 className="text-2xl font-bold tracking-tight">Report Unavailable</h2>
            <p className="text-muted-foreground">
              {error === NOT_GENERATED
                ? "This interview's report hasn't been generated yet. You can generate it from the interview page."
                : error || 'Report not found'}
            </p>
            {error === NOT_GENERATED ? (
              <Button asChild className="mt-4 w-full">
                <Link href={`/interview/${interviewId}`}>Go to the interview</Link>
              </Button>
            ) : (
              <Button onClick={onBack || (() => window.history.back())} className="mt-4 w-full">
                Go Back
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30">
      
      {/* Dynamic Header Background */}
      <div className="absolute top-0 inset-x-0 h-96 bg-gradient-to-b from-primary/10 via-background to-transparent pointer-events-none" />
      
      <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 space-y-8 relative z-10 pt-12">
        
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-border/40">
          <div className="space-y-3">
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 backdrop-blur-sm px-3 py-1 text-xs">
              AI Intelligence Report
            </Badge>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-foreground">
              {report.jobTitle}
            </h1>
            <p className="text-lg text-muted-foreground font-medium">
              Evaluated by <span className="text-foreground">{report.mentorName}</span>
            </p>
          </div>
          
          <div className="flex items-center space-x-6">
            <div className={`p-4 rounded-2xl border backdrop-blur-xl flex flex-col items-center justify-center ${getScoreBg(report.detailedFeedback.overallScore)}`}>
              <span className="text-sm font-semibold uppercase tracking-wider opacity-80 mb-1">Global Score</span>
              <div className="flex items-baseline space-x-1">
                <span className={`text-4xl font-black ${getScoreColor(report.detailedFeedback.overallScore)}`}>
                  {report.detailedFeedback.overallScore}
                </span>
                <span className="text-xl font-medium opacity-50">/100</span>
              </div>
            </div>
          </div>
        </div>

        {/* Global Overview Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
             { icon: Clock, label: "Session Duration", value: formatDuration(report.interviewDuration) },
             { icon: Calendar, label: "Date Evaluated", value: new Date(report.generatedAt).toLocaleDateString() },
             { icon: Award, label: "Recommendation", value: report.detailedFeedback.overallScore >= 75 ? "Strong Candidate" : "Needs Growth" },
             { icon: Target, label: "Core Assessment", value: "Fortune-500 Standard" }
          ].map((item, i) => (
            <Card key={i} className="bg-background/40 border-border/30 backdrop-blur-md">
              <CardContent className="p-5 flex items-center space-x-4">
                <div className="p-3 bg-primary/10 rounded-xl text-primary">
                  <item.icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">{item.label}</p>
                  <p className="text-base font-medium text-foreground mt-0.5">{item.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Executive Summary & Strengths */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 bg-gradient-to-br from-background via-background to-muted/50 border-border/40 shadow-xl">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2 text-xl">
                <Brain className="w-5 h-5 text-primary" />
                <span>Executive Summary</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-foreground/90 text-lg leading-relaxed font-light">
                {report.detailedFeedback.summary}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-background/60 border-border/40 backdrop-blur-sm shadow-xl">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center space-x-2">
                <Target className="w-5 h-5 text-blue-400" />
                <span>Critical Assessment</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h4 className="text-sm font-semibold text-emerald-400 uppercase tracking-wider mb-3 flex items-center">
                  <CheckCircle className="w-4 h-4 mr-2" /> Key Strengths
                </h4>
                <ul className="space-y-2">
                  {report.detailedFeedback.keyStrengths.map((strength, index) => (
                    <li key={index} className="text-sm text-foreground/90 flex items-start">
                      <span className="mr-2 text-emerald-500">•</span>
                      <span className="leading-tight">{strength}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <Separator className="bg-border/30" />
              <div>
                <h4 className="text-sm font-semibold text-amber-500 uppercase tracking-wider mb-3 flex items-center">
                  <TrendingUp className="w-4 h-4 mr-2" /> Priority Growth Areas
                </h4>
                <ul className="space-y-2">
                  {report.detailedFeedback.areasForImprovement.map((area, index) => (
                    <li key={index} className="text-sm text-foreground/90 flex items-start">
                      <span className="mr-2 text-amber-500">•</span>
                      <span className="leading-tight">{area}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Competency Spider/Bars */}
        <div className="space-y-6">
          <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center">
            <BarChart3 className="w-6 h-6 mr-3 text-primary" />
            Competency Breakdown
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              { id: 'tech', title: "Technical Knowledge", data: report.performanceAnalysis.technicalKnowledge },
              { id: 'comm', title: "Communication Skills", data: report.performanceAnalysis.communicationSkills },
              { id: 'prob', title: "Problem Solving", data: report.performanceAnalysis.problemSolving },
              { id: 'conf', title: "Confidence & Presence", data: report.performanceAnalysis.confidence },
              ...(report.performanceAnalysis.bodyLanguage
                ? [{ id: 'body', title: "Body Language", data: report.performanceAnalysis.bodyLanguage }]
                : [])
            ].map((metric) => (
              <Card key={metric.id} className="bg-background/40 border-border/30 group hover:bg-background/60 transition-colors">
                <CardContent className="p-6">
                  <div className="flex justify-between items-end mb-4">
                    <h4 className="font-semibold text-lg text-foreground">{metric.title}</h4>
                    <span className={`text-2xl font-black ${getScoreColor(metric.data.score)}`}>
                      {metric.data.score}
                    </span>
                  </div>
                  {/* Custom Progress styling via manual inline styles to inject color easily */}
                  <div className="h-2.5 w-full bg-muted rounded-full overflow-hidden mb-4">
                    <div
                      className={`h-full rounded-full transition-all duration-1000 ${getProgressColor(metric.data.score)}`}
                      style={{ width: `${metric.data.score}%` }}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed font-light">
                    {metric.id === 'conf'
                      ? (metric.data as unknown as { analysis: string }).analysis
                      : metric.id === 'body'
                        ? (metric.data as unknown as { observations: string[] }).observations.join(' ')
                        : (metric.data as unknown as { feedback: string }).feedback}
                  </p>
                </CardContent>
              </Card>
            ))}
            {!report.performanceAnalysis.bodyLanguage && (
              <Card className="bg-background/40 border-border/30 border-dashed">
                <CardContent className="p-6">
                  <div className="flex justify-between items-end mb-4">
                    <h4 className="font-semibold text-lg text-foreground">Body Language</h4>
                    <span className="text-sm font-medium text-muted-foreground">Not assessed</span>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed font-light">
                    No camera data was captured for this session.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Behavioral Neuro-Insights */}
        <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background relative overflow-hidden">
           <div className="absolute top-0 right-0 p-8 opacity-5">
             <Brain className="w-64 h-64" />
           </div>
           <CardHeader>
             <CardTitle className="text-xl flex items-center space-x-2 relative z-10 text-primary">
               <Brain className="w-5 h-5" />
               <span>Behavioral & Cognitive Profile</span>
             </CardTitle>
           </CardHeader>
           <CardContent className="relative z-10">
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
               <div className="space-y-2">
                 <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Cognitive Pacing</h4>
                 <p className="text-sm text-foreground/90 leading-relaxed font-medium">
                   {report.detailedFeedback.behavioralInsights.speechPaceAnalysis}
                 </p>
               </div>
               <div className="space-y-2">
                 <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Processing Speed</h4>
                 <p className="text-sm text-foreground/90 leading-relaxed font-medium">
                   {report.detailedFeedback.behavioralInsights.pauseAnalysis}
                 </p>
               </div>
               <div className="space-y-2">
                 <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Emotional Control</h4>
                 <p className="text-sm text-foreground/90 leading-relaxed font-medium">
                   {report.detailedFeedback.behavioralInsights.emotionalStateAnalysis}
                 </p>
               </div>
               <div className="space-y-2">
                 <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Authentic Presence</h4>
                 <p className="text-sm text-foreground/90 leading-relaxed font-medium">
                   {report.detailedFeedback.behavioralInsights.confidenceAnalysis}
                 </p>
               </div>
             </div>
           </CardContent>
        </Card>

        {/* Biometric Intelligence — only rendered when the camera produced data */}
        {hasFaceData && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center">
              <Eye className="w-6 h-6 mr-3 text-primary" />
              Biometric Intelligence
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {emotionRows.length > 0 && (
              <Card className="bg-background/40 border-border/30">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Emotion Distribution</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2.5">
                  {[...emotionRows]
                    .sort((a, b) => b[1] - a[1])
                    .map(([emotion, score]) => (
                      <div key={emotion} className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-20 capitalize">{emotion}</span>
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary/80 transition-all duration-700"
                            style={{ width: `${Math.round(score * 100)}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-8 text-right">{Math.round(score * 100)}%</span>
                      </div>
                    ))}
                </CardContent>
              </Card>
              )}

              {(signalRows.length > 0 || statRows.length > 0) && (
              <Card className="bg-background/40 border-border/30">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Physiological Signals</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {signalRows.map(item => (
                    <div key={item.label} className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-20">{item.label}</span>
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${item.color}`} style={{ width: `${item.value}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground w-8 text-right">{item.value}</span>
                    </div>
                  ))}
                  {signalRows.length > 0 && statRows.length > 0 && <Separator className="bg-border/30 my-2" />}
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    {statRows.map(item => (
                      <div key={item.label} className="space-y-0.5">
                        <p className="text-sm font-semibold text-foreground">{item.value}</p>
                        <p className="text-xs text-muted-foreground">{item.label}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
              )}
            </div>
          </div>
        )}

        {/* Q&A Transcripts & Feedback Analysis */}
        {report.detailedFeedback.specificFeedback && report.detailedFeedback.specificFeedback.length > 0 && (
          <div className="space-y-6 pt-10">
            <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center">
              <MessageSquareQuote className="w-6 h-6 mr-3 text-primary" />
              Q&A Specific Analysis
            </h2>
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
              {report.detailedFeedback.specificFeedback.map((qa, index) => (
                <div key={qa.questionId} className="group relative">
                  <div className="absolute -inset-y-4 -inset-x-6 z-0 scale-95 opacity-0 transition group-hover:scale-100 group-hover:opacity-100 bg-muted/40 rounded-2xl" />
                  <div className="relative z-10 grid grid-cols-1 md:grid-cols-12 gap-6">
                    {/* Q&A Column */}
                    <div className="md:col-span-8 space-y-4">
                      <div className="flex items-start space-x-4">
                        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 mt-1 border border-primary/30">
                          <span className="text-primary font-bold text-sm">Q{index + 1}</span>
                        </div>
                        <p className="text-lg font-medium text-foreground leading-relaxed">{qa.question}</p>
                      </div>
                      <div className="flex items-start space-x-4 pl-12">
                        <div className="relative w-full">
                           <div className="absolute left-0 top-0 bottom-0 w-1 bg-border rounded-full" />
                           <p className="text-base text-muted-foreground leading-relaxed font-light italic pl-5 py-1">
                             {qa.userResponse ? <>&quot;{qa.userResponse}&quot;</> : 'No answer given.'}
                           </p>
                        </div>
                      </div>
                    </div>
                    {/* Feedback Column */}
                    <div className="md:col-span-4 bg-muted/50 rounded-xl p-5 border border-border/40 shadow-inner">
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Score</span>
                        <span className={`text-lg font-black ${getScoreColor(qa.score)}`}>{qa.score}/100</span>
                      </div>
                      <p className="text-sm text-foreground/90 leading-relaxed mb-4">
                        {qa.feedback}
                      </p>
                      {qa.suggestions && qa.suggestions.length > 0 && (
                        <div className="space-y-2">
                          <span className="text-xs font-semibold uppercase tracking-widest text-primary">Suggestions</span>
                          <ul className="space-y-1">
                            {qa.suggestions.map((sug, idx) => (
                              <li key={idx} className="text-xs text-muted-foreground flex items-start">
                                <ArrowRight className="w-3 h-3 mt-0.5 mr-1.5 flex-shrink-0 text-primary opacity-70" />
                                <span>{sug}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                  {index < report.detailedFeedback.specificFeedback.length - 1 && (
                    <Separator className="my-8 bg-border/40 relative z-10" />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tactical Development Plan */}
        <div className="pt-10">
          <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center mb-6">
            <Star className="w-6 h-6 mr-3 text-amber-500" />
            Tactical Development Plan
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { title: "Immediate Tactics", items: report.detailedFeedback.recommendations.immediate, color: "text-blue-400", bg: "bg-blue-400/10", border: "border-blue-400/20" },
              { title: "Short-Term Milestones", items: report.detailedFeedback.recommendations.shortTerm, color: "text-amber-400", bg: "bg-amber-400/10", border: "border-amber-400/20" },
              { title: "Long-Term Trajectory", items: report.detailedFeedback.recommendations.longTerm, color: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/20" }
            ].map((plan, i) => (
              <Card key={i} className={`bg-background/40 backdrop-blur-md border ${plan.border}`}>
                <CardHeader className={`pb-4 border-b ${plan.border} ${plan.bg}`}>
                  <CardTitle className={`text-base font-bold ${plan.color}`}>
                    {plan.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-5 flex-grow">
                  <ul className="space-y-4">
                    {plan.items.map((rec, index) => (
                      <li key={index} className="text-sm text-foreground/90 flex items-start leading-relaxed">
                        <span className={`w-1.5 h-1.5 rounded-full mt-1.5 mr-3 flex-shrink-0 bg-current ${plan.color}`} />
                        {rec}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row justify-center items-center gap-4 pt-12 pb-16">
          <Button size="lg" asChild className="h-14 px-8 bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 transition-all active:scale-95 group w-full sm:w-auto">
            <Link href="/interview/new">
              Start Next Assessment
              <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
            </Link>
          </Button>
          <Button variant="outline" size="lg" onClick={onBack || (() => window.history.back())} className="h-14 px-8 border-border/60 hover:bg-muted/50 backdrop-blur-sm transition-all active:scale-95 w-full sm:w-auto">
            Back to Dashboard
          </Button>
        </div>

      </div>
    </div>
  );
};

export default InterviewReport;
