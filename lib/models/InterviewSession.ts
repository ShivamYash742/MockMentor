import mongoose from 'mongoose';

export interface IMessage {
  id: string;
  sender: 'user' | 'interviewer';
  text: string;
  timestamp: Date;
  duration?: number; // Duration of speech in milliseconds
  pauseBefore?: number; // Pause before this message in milliseconds
  confidence?: number; // Speech recognition confidence (0-1)
  emotion?: string; // Detected emotion
  volume?: number; // Audio volume level
}

export interface IInterviewMetrics {
  totalDuration: number; // Total interview duration in milliseconds
  userSpeakingTime: number; // Total time user was speaking
  interviewerSpeakingTime: number; // Total time interviewer was speaking
  totalPauses: number; // Number of pauses
  averagePauseLength: number; // Average pause length in milliseconds
  longestPause: number; // Longest pause in milliseconds
  averageResponseTime: number; // Average time to respond to questions
  wordsPerMinute: number; // User's speaking pace
  interruptionCount: number; // Number of times user interrupted
  fillerWordsCount: number; // Count of filler words (um, uh, like, etc.)
  confidenceScore: number; // Overall confidence score (0-1)
  emotionalTone: {
    positive: number;
    neutral: number;
    negative: number;
    confident: number;
    nervous: number;
  };
}

export interface IInterviewSession extends mongoose.Document {
  interviewId: string;
  userId?: string;
  guestId?: string;
  messages: IMessage[];
  metrics: IInterviewMetrics;
  startTime: Date;
  endTime?: Date;
  status: 'active' | 'completed' | 'abandoned';
  reportGenerated: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const MessageSchema = new mongoose.Schema({
  id: { type: String, required: true },
  sender: { type: String, enum: ['user', 'interviewer'], required: true },
  text: { type: String, required: true },
  timestamp: { type: Date, required: true },
  duration: { type: Number },
  pauseBefore: { type: Number },
  confidence: { type: Number, min: 0, max: 1 },
  emotion: { type: String },
  volume: { type: Number }
});

const MetricsSchema = new mongoose.Schema({
  totalDuration: { type: Number, default: 0 },
  userSpeakingTime: { type: Number, default: 0 },
  interviewerSpeakingTime: { type: Number, default: 0 },
  totalPauses: { type: Number, default: 0 },
  averagePauseLength: { type: Number, default: 0 },
  longestPause: { type: Number, default: 0 },
  averageResponseTime: { type: Number, default: 0 },
  wordsPerMinute: { type: Number, default: 0 },
  interruptionCount: { type: Number, default: 0 },
  fillerWordsCount: { type: Number, default: 0 },
  confidenceScore: { type: Number, default: 0 },
  emotionalTone: {
    positive: { type: Number, default: 0 },
    neutral: { type: Number, default: 0 },
    negative: { type: Number, default: 0 },
    confident: { type: Number, default: 0 },
    nervous: { type: Number, default: 0 }
  }
});

const InterviewSessionSchema = new mongoose.Schema(
  {
    interviewId: {
      type: String,
      required: true,
      unique: true, // one session per interview; makes the 'start' upsert race-safe
    },
    userId: {
      type: String,
    },
    guestId: {
      type: String,
    },
    messages: [MessageSchema],
    metrics: {
      type: MetricsSchema,
      default: () => ({})
    },
    startTime: {
      type: Date,
      required: true,
    },
    endTime: {
      type: Date,
    },
    status: {
      type: String,
      enum: ['active', 'completed', 'abandoned'],
      default: 'active',
    },
    reportGenerated: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
InterviewSessionSchema.index({ userId: 1 });
InterviewSessionSchema.index({ guestId: 1 });
InterviewSessionSchema.index({ status: 1 });

const InterviewSessionModel = (mongoose.models.InterviewSession as mongoose.Model<IInterviewSession>) ||
  mongoose.model<IInterviewSession>('InterviewSession', InterviewSessionSchema);

export default InterviewSessionModel;
