import mongoose from 'mongoose';

export interface IGuestUser extends mongoose.Document {
  guestId: string;
  interviewCount: number;
  lastInterviewAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const GuestUserSchema = new mongoose.Schema(
  {
    guestId: {
      type: String,
      required: true,
      unique: true,
    },
    interviewCount: {
      type: Number,
      default: 0,
    },
    lastInterviewAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

const GuestUserModel = (mongoose.models.GuestUser as mongoose.Model<IGuestUser>) ||
  mongoose.model<IGuestUser>('GuestUser', GuestUserSchema);

export default GuestUserModel;