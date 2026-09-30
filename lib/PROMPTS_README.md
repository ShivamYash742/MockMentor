# AI Prompts Management

This directory contains the centralized prompt management system for MockMentor.

## Files

- **`prompts.json`** - All AI prompts used across the application
- **`promptHelper.ts`** - Helper functions to load and format prompts

## How to Update Prompts

### 1. Edit `prompts.json`

All prompts are stored in JSON format. Simply edit the file to update any prompt:

```json
{
  "resumeSummary": {
    "description": "What this prompt does",
    "prompt": "Your prompt text with {variables}"
  }
}
```

### 2. Available Prompts

#### Resume Summary
- **File**: `resumeSummary.prompt`
- **Variables**: `{resumeText}`
- **Used in**: Resume upload and processing

#### Job Summary
- **File**: `jobSummary.withDescription` or `jobSummary.withoutDescription`
- **Variables**: `{jobTitle}`, `{jobDescription}`
- **Used in**: Job description analysis

#### Interview Welcome
- **File**: `interviewWelcome.prompt`
- **Variables**: `{knowledgeBase}`, `{role}`
- **Used in**: Starting an interview session

#### Interview Conversation
- **File**: `interviewConversation.systemPrompt`
- **Variables**: `{knowledgeBase}`, `{role}`, `{candidateBackground}`, `{duration}`, `{conversationHistory}`, `{message}`, `{responseGuidelines}`
- **Used in**: Real-time interview Q&A

#### Report Generation
- **File**: `reportGeneration.mainPrompt`
- **Variables**: `{jobTitle}`, `{userSummary}`, `{jobSummary}`, `{speechMetricsSection}`, `{bodyLanguageSection}`, `{conversationText}` (the two sections are built in `app/api/generate-report/route.ts`)
- **Used in**: Generating performance reports

## Variable Syntax

Use `{variableName}` in your prompts. The system will automatically replace them:

```
"Hello {name}, welcome to {company}"
```

With variables `{name: "John", company: "MockMentor"}` becomes:
```
"Hello John, welcome to MockMentor"
```

## Best Practices

1. **Keep prompts clear and concise**
2. **Use descriptive variable names**
3. **Add descriptions to explain what each prompt does**
4. **Test prompts after changes**
5. **Version control your changes** (prompts.json is tracked in git)

## Example: Updating Interview Welcome Message

1. Open `lib/prompts.json`
2. Find `interviewWelcome.prompt`
3. Edit the text:
```json
{
  "interviewWelcome": {
    "description": "Prompt for generating interview welcome messages",
    "prompt": "{knowledgeBase}\n\nYou are starting a mock interview for: {role}\n\nGenerate an enthusiastic, professional welcome message. Make it:\n- Warm and inviting\n- Brief (2-3 sentences)\n- Motivating\n- Role-specific\n\nRespond ONLY with your welcome message."
  }
}
```
4. Save the file
5. Restart the dev server (`npm run dev`)
6. Test the new prompt

## No Code Changes Needed!

Once the prompt system is set up, you can update all prompts by simply editing `prompts.json`. No need to touch any TypeScript/JavaScript code!

## Debugging

To see all prompts in use:
```typescript
import prompts from '@/lib/prompts.json';

console.log(prompts);
```
