import mongoose from 'mongoose';

export interface IUserProfile extends mongoose.Document {
  userId: string;
  resumeUrl?: string;
  resumeFileId?: string; // the Appwrite file behind resumeUrl, deleted when it's replaced
  resumeSummary?: string;
  createdAt: Date;
  updatedAt: Date;
}

const UserProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
    },
    resumeUrl: {
      type: String,
    },
    resumeFileId: {
      type: String,
    },
    resumeSummary: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

const UserProfile = (mongoose.models
  .UserProfile as mongoose.Model<IUserProfile>) ||
  mongoose.model<IUserProfile>('UserProfile', UserProfileSchema);

export default UserProfile;
