---
draft: false
title: Preheating Strategy Guide
description: Master ReadAny's intelligent preheating strategies for optimal AI-assisted reading.
---

## Overview

Preheating is an intelligent feature that prepares AI context before you engage with text, making Socratic dialogue and AI assistance more relevant and insightful. This guide explains how to choose and use the right preheating strategy for your reading style.

## What is Preheating?

Preheating allows the AI to:
- **Analyze upcoming content** before you read it
- **Prepare relevant questions** based on chapter themes
- **Build contextual understanding** for better responses
- **Optimize AI performance** by pre-loading information

Think of it as the AI "reading ahead" to be better prepared for your questions and discussions.

## Why Use Preheating?

### Benefits
✅ **More relevant questions** - AI understands context better  
✅ **Faster responses** - Context is pre-loaded  
✅ **Deeper insights** - AI has time to analyze  
✅ **Smoother experience** - No waiting for analysis  
✅ **Better learning** - More targeted guidance  

### When It Matters Most
- Complex technical books
- Dense philosophical texts
- Unfamiliar subjects
- Critical analysis sessions
- Study and exam preparation

## Preheating Strategies

ReadAny offers three preheating strategies, each designed for different reading styles and needs.

### 1. Auto Strategy (自动策略)

**How it works**: Automatically activates for every new chapter without asking.

**Best for**:
- Beginners using Socratic mode
- Complex or unfamiliar texts
- Learners who want maximum support
- Study sessions requiring deep analysis

**Behavior**:
- Triggers on every chapter change
- Shows preheating progress indicator
- Prepares full context automatically
- No user intervention needed

**Pros**:
- ✅ Maximum AI preparation
- ✅ Consistent experience
- ✅ No manual steps required
- ✅ Best for learning

**Cons**:
- ❌ Uses more API calls
- ❌ May feel intrusive
- ❌ Slower chapter transitions
- ❌ Higher API costs

**Configuration**:
```
Settings → AI → Socratic Settings
├─ Enable Preheating: ✓
└─ Preheating Strategy: Auto
```

### 2. Smart Strategy (智能策略)

**How it works**: Activates only if you haven't seen the preheating dialog for this book before.

**Best for**:
- Regular readers
- Balanced efficiency and support
- Users familiar with Socratic mode
- Mixed reading (casual + study)

**Behavior**:
- First chapter: Shows preheating dialog
- Subsequent chapters: Works silently
- Remembers per-book preference
- Adapts to your patterns

**Pros**:
- ✅ One-time explanation
- ✅ Silent operation after first use
- ✅ Good balance of features
- ✅ Efficient API usage

**Cons**:
- ❌ Initial setup required
- ❌ May confuse first-time users
- ❌ Less control than Manual
- ❌ Not fully automatic

**Configuration**:
```
Settings → AI → Socratic Settings
├─ Enable Preheating: ✓
└─ Preheating Strategy: Smart
```

**First-Time Experience**:
1. Open a book with Socratic mode enabled
2. Preheating dialog appears explaining the feature
3. Choose whether to enable preheating
4. Future chapters work silently based on your choice

### 3. Manual Strategy (手动策略)

**How it works**: Never auto-activates; you decide when to preheat.

**Best for**:
- Advanced users
- Casual reading sessions
- Users wanting full control
- API cost-conscious readers

**Behavior**:
- Never triggers automatically
- Preheat button available in toolbar
- User initiates preheating explicitly
- Complete control over timing

**Pros**:
- ✅ Full user control
- ✅ Minimal API usage
- ✅ No interruptions
- ✅ Lowest costs

**Cons**:
- ❌ Requires manual action
- ❌ Easy to forget
- ❌ Less consistent support
- ❌ May miss opportunities

**Configuration**:
```
Settings → AI → Socratic Settings
├─ Enable Preheating: ✓
└─ Preheating Strategy: Manual
```

**How to Trigger**:
1. Look for preheat button in reader toolbar
2. Click when you want AI to prepare
3. Wait for preheating to complete
4. Continue reading with enhanced AI

## Choosing the Right Strategy

### Decision Guide

**Choose Auto if**:
- You're new to Socratic mode
- Reading complex textbooks
- Preparing for exams
- Want maximum AI support
- API costs are not a concern

**Choose Smart if**:
- You're a regular reader
- Mix casual and study reading
- Want balanced experience
- Prefer efficiency
- Moderate API budget

**Choose Manual if**:
- You're an advanced user
- Mostly casual reading
- Want full control
- Concerned about API costs
- Prefer minimal AI intervention

### By Book Type

| Book Type | Recommended Strategy | Reason |
|-----------|---------------------|--------|
| Textbooks | Auto | Need thorough preparation |
| Philosophy | Auto | Complex concepts benefit from context |
| Fiction | Smart | Balance immersion and support |
| Self-help | Smart | Practical application focus |
| News/Articles | Manual | Quick reading, less depth needed |
| Reference | Manual | Lookup-style reading |

## Using Preheating Effectively

### Best Practices

#### For Auto Strategy
1. **Let it work** - Don't interrupt preheating
2. **Review prepared questions** - See what AI identified as important
3. **Provide feedback** - Rate question relevance
4. **Adjust if needed** - Switch strategy if too intrusive

#### For Smart Strategy
1. **Pay attention to first dialog** - Make informed choice
2. **Remember your decision** - It applies to the whole book
3. **Try different books** - Each book has separate settings
4. **Switch if needed** - Change strategy mid-book if necessary

#### For Manual Strategy
1. **Create a habit** - Preheat at chapter starts
2. **Watch for cues** - Preheat before difficult sections
3. **Use consistently** - Regular preheating improves results
4. **Monitor effectiveness** - Track if manual triggering helps

### Timing Tips

**When to Preheat**:
- ✅ Start of new chapters
- ✅ Before difficult passages
- ✅ After breaks in reading
- ✅ When switching topics
- ✅ Before discussion sessions

**When NOT to Preheat**:
- ❌ Skimming or speed reading
- ❌ Re-reading familiar content
- ❌ Looking up specific facts
- ❌ Casual browsing
- ❌ Time-constrained sessions

## Monitoring Preheating

### Progress Indicators

Visual feedback shows preheating status:
- 🔄 Spinning icon during preheating
- ⏱️ Estimated time remaining
- ✅ Checkmark when complete
- ❌ Error indicator if failed

### Status Information

Access preheating details:
1. Open Socratic panel
2. Look for preheating status section
3. View:
   - Last preheated chapter
   - Preheating duration
   - Context items prepared
   - API calls used

### Performance Metrics

Track preheating effectiveness:
- Question relevance scores
- Response quality ratings
- Time saved vs. no preheating
- API cost per session

## Troubleshooting

### Preheating Not Activating

**Problem**: Preheating doesn't start when expected.

**Solutions**:
1. Verify preheating is enabled in settings
2. Check strategy selection (Auto/Smart/Manual)
3. For Smart: Clear "has shown dialog" flag
4. For Manual: Look for preheat button
5. Ensure AI provider is configured
6. Check internet connection

### Preheating Too Slow

**Problem**: Preheating takes too long.

**Solutions**:
1. Check internet speed
2. Try faster AI model
3. Reduce chapter length if possible
4. Preheat during breaks
5. Consider switching to Smart/Manual strategy

### Preheating Uses Too Many API Calls

**Problem**: High API costs from frequent preheating.

**Solutions**:
1. Switch to Smart or Manual strategy
2. Disable preheating for casual reading
3. Use cheaper AI models for preheating
4. Batch preheating sessions
5. Monitor API usage regularly

### Preheating Dialog Keeps Appearing

**Problem**: Smart strategy shows dialog repeatedly.

**Solutions**:
1. Make a definitive choice in dialog
2. Check if settings are saving
3. Clear browser/app cache
4. Update ReadAny to latest version
5. Switch to Auto or Manual if persistent

## Advanced Configuration

### Per-Book Settings

Override global strategy for specific books:
1. Open book settings
2. Find preheating options
3. Select custom strategy
4. Save per-book preference

### Custom Triggers

Set up custom preheating triggers (if supported):
- Chapter length thresholds
- Keyword detection
- Difficulty assessment
- Time-based triggers
- User behavior patterns

### Integration with Other Features

**With Annotations**:
- Preheat before annotating important sections
- Use preheated context for better notes
- Link annotations to preheated insights

**With Mini Reviews**:
- Generate mini reviews after preheating
- Use preheated context for better reviews
- Combine for comprehensive understanding

**With Reading Stats**:
- Track preheating frequency
- Monitor effectiveness over time
- Optimize strategy based on data

## Cost Management

### API Usage Optimization

Minimize costs while maintaining quality:
1. **Use Smart strategy** - Balances usage and support
2. **Choose efficient models** - Some models are cheaper
3. **Batch operations** - Preheat multiple chapters together
4. **Monitor usage** - Track API call counts
5. **Set budgets** - Limit daily/monthly spending

### Cost Estimates

Typical preheating costs (varies by provider):
- **Auto strategy**: ~$0.01-0.03 per chapter
- **Smart strategy**: ~$0.005-0.015 per chapter (after first)
- **Manual strategy**: Only when triggered

Monthly estimates (reading 10 chapters/day):
- **Auto**: $3-9/month
- **Smart**: $1.5-4.5/month
- **Manual**: $0.5-2/month (depending on usage)

*Note: Costs vary significantly by AI provider and model.*

## Privacy Considerations

### Data Handling

Preheating data:
- Sent to your configured AI provider only
- Not stored by ReadAny
- Deleted after session (unless cached locally)
- Included in your privacy controls

### Control Your Data

You can:
- Disable preheating entirely
- Choose which books to preheat
- Clear preheating cache
- Export/delete preheating history
- Control data retention settings

## Next Steps

- [Socratic Mode Guide](/ReadAny/support/socratic-mode/) - Learn about Socratic dialogue
- [AI Providers](/ReadAny/support/ai/providers/) - Configure your AI provider
- [Mini Reviews](/ReadAny/support/mini-reviews/) - Enhance with AI-generated insights
