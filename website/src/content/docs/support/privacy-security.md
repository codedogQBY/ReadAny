---
draft: false
title: Privacy & Security
description: Understanding ReadAny's privacy-first approach and security features.
---

## Privacy Philosophy

ReadAny is designed with a **local-first** philosophy. Your reading data, annotations, and personal information stay on your device by default. We believe you should have complete control over your data.

## Data Storage

### Local Storage
All your data is stored locally on your device:
- **Books**: Stored in their original location or imported to ReadAny's data directory
- **Annotations**: Highlights, notes, and bookmarks saved locally
- **Reading Progress**: Position, time spent, and statistics stored locally
- **Settings**: All preferences and configurations saved locally

### No Cloud Dependency
ReadAny works completely offline after initial setup. No internet connection is required for core functionality.

## AI Features and Privacy

### Local AI Processing
- **Semantic Search**: Uses Transformers.js to run embedding models locally. No text leaves your device.
- **Vectorization**: Creates local embedding indexes stored only on your device.

### Cloud AI Providers
When using cloud-based AI providers (OpenAI, Anthropic, Google, DeepSeek):
- Only the text you explicitly send to AI chat is transmitted
- Your API keys are stored locally and never sent to ReadAny servers
- Book content is only shared when you actively use AI features
- Consider using local AI (Ollama) for maximum privacy

### Recommended Privacy Settings
For maximum privacy when using AI:
1. Use Ollama for local AI processing
2. Review what text you're sending to cloud AI providers
3. Use providers with strong privacy policies
4. Regularly rotate API keys

## WebDAV Sync Security

When using WebDAV sync:
- Data is transmitted over HTTPS (ensure your WebDAV server supports it)
- Credentials are stored securely in your system's keychain
- Only reading progress and annotations are synced (not book files)
- Consider using app-specific passwords for services that support them

### Secure WebDAV Setup
1. Always use HTTPS URLs for WebDAV servers
2. Use strong, unique passwords
3. Enable two-factor authentication on your WebDAV service if available
4. Regularly review connected devices/services

## File Permissions

ReadAny requests minimal permissions:
- **File System Access**: Only to read imported books and save settings
- **Network Access**: Only for AI features and WebDAV sync (optional)
- **No Camera/Microphone**: ReadAny doesn't require these permissions

## Third-Party Services

### AI Providers
ReadAny connects to third-party AI providers only when you:
- Explicitly configure an API key
- Actively use AI chat or semantic search features
- Choose which provider to use

We don't collect usage statistics or send telemetry data.

### Updates
Auto-updates connect to GitHub releases to check for new versions. You can disable auto-updates in Settings if preferred.

## Security Best Practices

### Protecting Your Library
1. **Backup regularly**: Your annotations and progress are valuable
2. **Use strong passwords**: For WebDAV sync and AI provider accounts
3. **Keep ReadAny updated**: Security improvements are included in updates
4. **Review AI usage**: Be mindful of what text you send to cloud AI

### Device Security
Since all data is local:
- Encrypt your device's storage if possible
- Use device passwords/biometric locks
- Be cautious when sharing your device
- Clear ReadAny data before selling/giving away devices

## Data Export and Deletion

### Exporting Your Data
You can export:
- Annotations and notes (multiple formats)
- Reading statistics
- Library metadata

See [Export Notes](/ReadAny/support/sync/export-notes/) for details.

### Deleting Your Data
To completely remove ReadAny data:
1. Uninstall the application
2. Delete the data directory:
   - **Windows:** `%APPDATA%\ReadAny`
   - **macOS:** `~/Library/Application Support/ReadAny`
   - **Linux:** `~/.config/ReadAny`
3. Remove any manually imported book files if desired

## Reporting Security Issues

If you discover a security vulnerability, please report it responsibly:
1. Email us at [security contact]
2. Include detailed steps to reproduce
3. Allow reasonable time for response before public disclosure

We take security seriously and will address issues promptly.

## Privacy Policy Summary

- ✅ No telemetry or usage tracking
- ✅ No mandatory account creation
- ✅ No cloud storage requirement
- ✅ Local-first data storage
- ✅ Transparent AI provider integration
- ✅ Open source code (auditable)
- ❌ No data selling or advertising
- ❌ No hidden data collection
