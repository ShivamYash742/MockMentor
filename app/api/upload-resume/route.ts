import { NextRequest, NextResponse } from 'next/server';
import { getRequester } from '@/lib/requester';
import { parsePDF } from '@/lib/pdf';
import { saveResumeProfile, summarizeResume } from '@/lib/resumeProfile';
import { INPUT_LIMITS } from '@/lib/inputLimits';
import { aiLimits, rateLimit } from '@/lib/rateLimit';

const MAX_FILE_BYTES = INPUT_LIMITS.resumeBytes;
// Room for the multipart envelope around the file itself.
const MAX_BODY_BYTES = MAX_FILE_BYTES + 64 * 1024;

export async function POST(req: NextRequest) {
  try {
    const requester = await getRequester(req);
    if (!requester) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Refuse an oversized upload before reading it into memory.
    const declaredBytes = Number(req.headers.get('content-length') ?? 0);
    if (declaredBytes > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'File is too large (max 5MB)' }, { status: 413 });
    }

    const formData = await req.formData();
    const file = formData.get('resume');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'File is too large (max 5MB)' }, { status: 400 });
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const lowerName = file.name.toLowerCase();
    const isPdf = file.type === 'application/pdf' || lowerName.endsWith('.pdf');
    const isTxt = file.type === 'text/plain' || lowerName.endsWith('.txt');

    // Parse and validate content BEFORE anything is stored.
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

    const limited = await rateLimit(aiLimits(req, requester));
    if (limited) return limited;

    const resumeSummary = await summarizeResume(fileContent);

    // Only a signed-in user's resume is stored, and only the latest one. Guests have no profile,
    // so their files used to be kept with nothing pointing to them. Appwrite is loaded here, not
    // at the top, so guest uploads work even where storage isn't configured.
    let userProfile = null;
    if (requester.userId) {
      const { serverStorage, BUCKET_ID } = await import('@/lib/appwrite-server');
      const { ID } = await import('node-appwrite');
      const fileId = ID.unique();
      await serverStorage.createFile(BUCKET_ID, fileId, new File([fileBuffer], file.name, { type: file.type }));
      const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
      const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
      const url = `${endpoint}/storage/buckets/${BUCKET_ID}/files/${fileId}/view?project=${projectId}`;

      const saved = await saveResumeProfile(requester.userId, resumeSummary, { url, fileId });
      userProfile = saved.userProfile;
      if (saved.replacedFileId) {
        await serverStorage.deleteFile(BUCKET_ID, saved.replacedFileId).catch((err: unknown) => {
          console.warn('Could not delete the replaced resume file:', err);
        });
      }
    }

    return NextResponse.json({
      success: true,
      resumeSummary,
      userProfile,
      extractedTextLength: fileContent.length,
    });
  } catch (error) {
    // Details stay in the server log; they used to be sent to the client.
    console.error('Error uploading resume:', error);
    return NextResponse.json(
      { error: 'Failed to upload your resume. Please try again.' },
      { status: 500 }
    );
  }
}
