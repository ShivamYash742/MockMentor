/**
 * Shared PDF parsing utility.
 * Uses pdf2json library for extracting text from PDF buffers.
 */
export async function parsePDF(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      // Dynamically import pdf2json
      import('pdf2json').then((module) => {
        const PDFParser = module.default;
        const pdfParser = new PDFParser(null, true); // Enable raw text mode

        pdfParser.on('pdfParser_dataError', (errData: Error | { parserError: Error }) => {
          const cause = 'parserError' in errData ? errData.parserError : errData;
          reject(new Error(`PDF parsing failed: ${cause.message}`));
        });

        pdfParser.on('pdfParser_dataReady', (pdfData: { Pages?: Array<{ Texts?: Array<{ R?: Array<{ T?: string }> }> }> }) => {
          try {
            // Extract text from all pages
            let text = '';
            
            if (pdfData && pdfData.Pages) {
              for (const page of pdfData.Pages) {
                if (page.Texts) {
                  for (const textItem of page.Texts) {
                    if (textItem.R) {
                      for (const run of textItem.R) {
                        if (run.T) {
                          // Decode URI component (pdf2json encodes text)
                          text += decodeURIComponent(run.T) + ' ';
                        }
                      }
                    }
                  }
                  text += '\n'; // New line after each text block
                }
              }
            }
            
            // Clean up the text
            text = text.trim();
            
            if (!text || text.length === 0) {
              reject(new Error('No text content extracted from PDF. The PDF might be scanned images or empty.'));
              return;
            }
            
            resolve(text);
          } catch (err) {
            reject(new Error(`Failed to extract text: ${err instanceof Error ? err.message : 'Unknown error'}`));
          }
        });

        // Parse the buffer
        pdfParser.parseBuffer(buffer);
      }).catch((err) => {
        reject(new Error(`Failed to load PDF parser: ${err.message}`));
      });
    } catch (error) {
      reject(new Error(`PDF parsing error: ${error instanceof Error ? error.message : 'Unknown error'}`));
    }
  });
}

/**
 * Truncate content to keep AI prompts (and their cost) bounded.
 * @param content - Raw text content
 * @param maxChars - Maximum characters (default 8000)
 */
export function truncateForAI(content: string, maxChars = 8000): string {
  if (content.length <= maxChars) return content;
  return content.substring(0, maxChars) + '\n\n[Content truncated due to length]';
}
