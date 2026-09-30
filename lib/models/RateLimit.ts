import mongoose from 'mongoose';

// One fixed-window counter per (limit, identity, window). MongoDB's TTL monitor deletes each
// document once its window has passed.
export interface IRateLimit extends mongoose.Document {
  key: string;
  count: number;
  expiresAt: Date;
}

const RateLimitSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  count: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
});

RateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const RateLimitModel = (mongoose.models.RateLimit as mongoose.Model<IRateLimit>) ||
  mongoose.model<IRateLimit>('RateLimit', RateLimitSchema);

export default RateLimitModel;
