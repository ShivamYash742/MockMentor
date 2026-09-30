import type { Mongoose } from 'mongoose';

// The cached connection in lib/mongodb.ts. (`typeof mongoose` here used to refer to this global
// itself rather than the library, which is why lib/mongodb.ts needed a @ts-ignore.)
declare global {
  var mongoose: {
    conn: Mongoose | null;
    promise: Promise<Mongoose> | null;
  };
}
