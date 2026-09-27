import { NextRequest, NextResponse } from 'next/server';
import { getRequester } from '@/lib/requester';
import { serverStorage, BUCKET_ID } from '@/lib/appwrite-server';
import { ID } from 'node-appwrite';
import { parsePDF } from '@/lib/pdf';
import { summarizeAndSaveResume } from '@/lib/resumeProfile';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const requester = await getRequester(req);
    if (!requester) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('resume') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'File is too large (max 5MB)' }, { status: 400 });
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const lowerName = file.name.toLowerCase();
    const isPdf = file.type === 'application/pdf' || lowerName.endsWith('.pdf');
    const isTxt = file.type === 'text/plain' || lowerName.endsWith('.txt');

    // Parse and validate content BEFORE anything is uploaded to Appwrite.
    let fileContent: string;
    if (isPdf) {
      if (fileBuffer.subarray(0, 4).toString('latin1') !== '%PDF') {
        return NextResponse.json({ error: 'File is not a valid PDF' }, { status: 400 });
      }
      try {
        fileContent = await parsePDF(fileBuffer);
      } catch (pdfError) {
        console.error('Error parsing PDF:', pdfError);
        return NextResponse.json(
          { error: 'Failed to parse PDF file. Please ensure the file is a valid PDF.' },
          { status: 400 }
        );
      }
    } else if (isTxt) {
      fileContent = fileBuffer.toString('utf-8');
    } else {
      return NextResponse.json({ error: 'Only PDF and TXT resumes are supported' }, { status: 400 });
    }

    if (!fileContent || fileContent.trim().length === 0) {
      return NextResponse.json(
        { error: 'No text content could be extracted from the file. The PDF may be scanned images or empty.' },
        { status: 400 }
      );
    }

    // Upload only now that the file has passed every check.
    const fileId = ID.unique();
    const uploadFile = new File([fileBuffer], file.name, { type: file.type });
    await serverStorage.createFile(BUCKET_ID, fileId, uploadFile);

    const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
    const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
    const fileUrl = `${endpoint}/storage/buckets/${BUCKET_ID}/files/${fileId}/view?project=${projectId}`;

    const { resumeSummary, userProfile } = await summarizeAndSaveResume(fileContent, fileUrl, requester);

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
