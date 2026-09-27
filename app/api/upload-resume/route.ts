import { NextRequest, NextResponse } from 'next/server';
import { getRequester } from '@/lib/requester';
import { serverStorage, BUCKET_ID } from '@/lib/appwrite-server';
import { ID } from 'node-appwrite';
import { generateWithGroq } from '@/lib/groq';
import { parsePDF, truncateForAI } from '@/lib/pdf';
import dbConnect from '@/lib/mongodb';
import UserProfile from '@/lib/models/User';
import { getResumeSummaryPrompt } from '@/lib/promptHelper';

export async function POST(req: NextRequest) {
  try {
    const requester = await getRequester(req);
    const formData = await req.formData();

    if (!requester) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const file = formData.get('resume') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Convert the Web API File to a Buffer for node-appwrite
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    // Upload file to Appwrite using server SDK (node-appwrite v24+)
    const fileId = ID.unique();
    const uploadFile = new File([fileBuffer], file.name, { type: file.type });
    await serverStorage.createFile(BUCKET_ID, fileId, uploadFile);

    // Build the file view URL
    const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
    const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
    const fileUrl = `${endpoint}/storage/buckets/${BUCKET_ID}/files/${fileId}/view?project=${projectId}`;

    // Parse file content for AI processing
    let fileContent = '';

    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      try {
        fileContent = await parsePDF(fileBuffer);
        console.log('PDF parsed successfully, extracted text length:', fileContent.length);
      } catch (pdfError) {
        console.error('Error parsing PDF:', pdfError);
        return NextResponse.json(
          { error: 'Failed to parse PDF file. Please ensure the file is a valid PDF.' },
          { status: 400 }
        );
      }
    } else {
      fileContent = fileBuffer.toString('utf-8');
    }

    // Check if we extracted any content
    if (!fileContent || fileContent.trim().length === 0) {
      return NextResponse.json(
        { error: 'No text content could be extracted from the file. The PDF may be scanned images or empty.' },
        { status: 400 }
      );
    }

    // Truncate file content to avoid API size limits
    const truncatedContent = truncateForAI(fileContent);

    // Generate resume summary using Groq (with automatic model fallback)
    const prompt = getResumeSummaryPrompt(truncatedContent);
    const { text: resumeSummary } = await generateWithGroq(prompt);

    // Connect to database and save/update user profile if logged in
    await dbConnect();

    let userProfile = null;
    if (requester.userId) {
      userProfile = await UserProfile.findOneAndUpdate(
        { userId: requester.userId },
        {
          resumeUrl: fileUrl,
          resumeSummary,
        },
        { upsert: true, new: true }
      );
    }

    return NextResponse.json({
      success: true,
      fileUrl,
      resumeSummary,
      userProfile,
      extractedTextLength: fileContent.length,
    });
  } catch (error) {
    console.error('Error uploading resume:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to upload resume';
    return NextResponse.json(
      { error: 'Failed to upload resume', details: errorMessage },
      { status: 500 }
    );
  }
}
